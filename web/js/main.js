import * as THREE from 'three';
import { World, waveHeight } from './world.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Game, TEAM_NAMES, STREAKS } from './game.js';
import { DEFS, CALIBERS, PLANES, SHIPS } from './vehicles.js';
import { buildModel } from './models.js';
import { Hud, vehicleCardHtml, vehicleDetailsHtml, esc } from './hud.js';
import { clamp, elevationFor, fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);

// ---------- Einstellungen & Freischaltungen ----------
const DEFAULT_SETTINGS = { name: 'Spieler', difficulty: 'normal', quality: 'mittel', sens: 1, invert: false, volume: 0.6 };
const START_UNLOCKS = ['falke', 'schnellboot'];

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* privater Modus */ }
}

const settings = { ...DEFAULT_SETTINGS, ...load('sturmflut.settings', {}) };
const unlocks = new Set([...START_UNLOCKS, ...load('sturmflut.unlocks', [])]);
const saveUnlocks = () => save('sturmflut.unlocks', [...unlocks]);

const UNLOCK_TEXT = {};
for (const s of STREAKS) if (s.unlock) for (const id of s.unlock) UNLOCK_TEXT[id] = `${s.n}er-Serie`;

// ---------- Renderer ----------
const canvas = $('game');
const quality = settings.quality;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'niedrig', powerPreference: 'high-performance' });
const pixelRatio = { niedrig: 0.75, mittel: 1, hoch: 1.5 }[quality] ?? 1;
renderer.setPixelRatio(Math.min(2, Math.min(window.devicePixelRatio || 1, 2) * pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = quality !== 'niedrig';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 16000);
camera.rotation.order = 'YXZ';

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const world = new World(scene, quality);
const effects = new Effects(scene, quality);
const audio = new Sound();
audio.setVolume(settings.volume);
const hud = new Hud();

// ---------- Eingabe ----------
const keys = new Set();
const mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
let locked = false;
let wasLocked = false;
let ignoreMouseUntil = 0;

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Tab') { e.preventDefault(); }
  if (e.code === 'Space' && state === 'playing') e.preventDefault();
  if (!keys.has(e.code)) onKeyPress(e.code);
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; });
addEventListener('mousemove', (e) => {
  if (state !== 'playing' && state !== 'dead') return;
  if (!locked && !mouse.left && !mouse.right) return;
  // Direkt nach dem Einrasten liefern manche Browser einen großen Sprung
  if (performance.now() < ignoreMouseUntil) return;
  const dx = e.movementX || 0, dy = e.movementY || 0;
  if (Math.abs(dx) > 300 || Math.abs(dy) > 300) return;
  mouse.dx += dx; mouse.dy += dy;
});
canvas.addEventListener('mousedown', (e) => {
  audio.init();
  if (state === 'playing' && !locked) requestLock();
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) { mouse.right = true; onKeyPress('Mouse2'); }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (state === 'playing') mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

function requestLock() {
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch { /* nicht unterstützt */ }
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  ignoreMouseUntil = performance.now() + 150;
  if (locked) wasLocked = true;
  else if (wasLocked && state === 'playing') pause();
});

// ---------- Zustand ----------
let state = 'loading';
let game = null;
let tab = 'plane';
let selected = 'falke';
let respawnAt = 0;
let deadTimer = 0;
let showcase = null;
let menuAngle = 0;

const view = {
  yaw: 0, pitch: 0, zoom: 1, freeYaw: 0, freePitch: 0, lead: null,
  camPos: new THREE.Vector3(), aim: new THREE.Vector3(), leadVec: new THREE.Vector3(),
};

const screens = ['loading', 'menu', 'hangar', 'controls', 'settings', 'pause', 'result'];
let controlsReturn = 'menu';
function showScreen(name) {
  for (const s of screens) $(s).hidden = s !== name;
}

document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
  audio.init();
  const go = b.dataset.go;
  if (go === 'hangar') openHangar(false);
  else if (go === 'menu') { if (game) endGame(); toMenu(); }
  else if (go === 'controls-ingame') { controlsReturn = 'pause'; showScreen('controls'); }
  else if (go === 'controls') { controlsReturn = 'menu'; showScreen('controls'); }
  else if (go === 'settings') { fillSettings(); showScreen('settings'); }
}));
// "Zurück" in der Steuerung führt dorthin, wo man herkam
$('controls').querySelector('[data-go="menu"]').addEventListener('click', (e) => {
  if (controlsReturn === 'pause') { e.stopImmediatePropagation(); showScreen('pause'); }
}, true);

function toMenu() {
  state = 'menu';
  hud.show(false);
  audio.engine(null);
  showScreen('menu');
  setShowcase(selected);
}

// ---------- Hangar ----------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  tab = t.dataset.tab;
  const list = tab === 'plane' ? PLANES : SHIPS;
  if (!list.includes(selected)) selected = list.find((id) => unlocks.has(id)) || list[0];
  renderHangar();
}));

function openHangar(respawn) {
  showScreen('hangar');
  $('hangarTitle').textContent = respawn ? 'Wieder einsteigen' : 'Fahrzeug wählen';
  $('hangarBack').textContent = respawn ? 'Gefecht verlassen' : 'Zurück';
  tab = DEFS[selected].kind;
  if (!unlocks.has(selected)) selected = tab === 'plane' ? 'falke' : 'schnellboot';
  if (!respawn) { state = 'menu'; setShowcase(selected); }
  renderHangar();
}

function renderHangar() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  const list = tab === 'plane' ? PLANES : SHIPS;
  const cards = $('cards');
  cards.innerHTML = '';
  for (const id of list) {
    const def = DEFS[id];
    const b = document.createElement('button');
    const isLocked = !unlocks.has(id);
    b.className = 'card' + (id === selected ? ' sel' : '') + (isLocked ? ' locked' : '');
    b.innerHTML = vehicleCardHtml(def, isLocked, UNLOCK_TEXT[id]);
    b.addEventListener('click', () => { selected = id; if (state === 'menu') setShowcase(id); renderHangar(); });
    cards.appendChild(b);
  }
  $('details').innerHTML = vehicleDetailsHtml(DEFS[selected], CALIBERS);
  updateDeployButton();
}

function updateDeployButton() {
  const btn = $('deploy');
  const isLocked = !unlocks.has(selected);
  const wait = state === 'dead' ? Math.max(0, respawnAt - performance.now() / 1000) : 0;
  btn.disabled = isLocked || wait > 0;
  btn.textContent = isLocked ? `Gesperrt · ${UNLOCK_TEXT[selected]}` : wait > 0 ? `Bereit in ${Math.ceil(wait)} s` : 'Ins Gefecht';
  $('respawnTimer').textContent = game && state === 'dead' ? `Blau ${Math.ceil(game.tickets[0])} · Rot ${Math.ceil(game.tickets[1])} · ${fmtTime(game.duration - game.time)}` : '';
}

$('deploy').addEventListener('click', () => {
  audio.init();
  if (!unlocks.has(selected)) return;
  if (state === 'dead' && game) {
    if (performance.now() / 1000 < respawnAt) return;
    game.respawnPlayer(selected);
    beginControl();
  } else {
    startGame();
  }
});

$('hangarBack').addEventListener('click', () => {
  if (game) endGame();
  toMenu();
});

// ---------- Einstellungen ----------
function fillSettings() {
  $('setName').value = settings.name;
  $('setDifficulty').value = settings.difficulty;
  $('setQuality').value = settings.quality;
  $('setSens').value = settings.sens;
  $('setInvert').checked = settings.invert;
  $('setVolume').value = settings.volume;
  $('qualityNote').hidden = settings.quality === quality;
}
const bindSetting = (id, key, conv) => $(id).addEventListener('input', (e) => {
  const el = e.target;
  settings[key] = conv(el.type === 'checkbox' ? el.checked : el.value);
  save('sturmflut.settings', settings);
  if (key === 'volume') audio.setVolume(settings.volume);
  $('qualityNote').hidden = settings.quality === quality;
});
bindSetting('setName', 'name', (v) => v.trim().slice(0, 16) || 'Spieler');
bindSetting('setDifficulty', 'difficulty', String);
bindSetting('setQuality', 'quality', String);
bindSetting('setSens', 'sens', Number);
bindSetting('setInvert', 'invert', Boolean);
bindSetting('setVolume', 'volume', Number);
$('resetUnlocks').addEventListener('click', () => {
  if (!confirm('Alle Freischaltungen zurücksetzen?')) return;
  unlocks.clear();
  START_UNLOCKS.forEach((id) => unlocks.add(id));
  saveUnlocks();
  selected = 'falke';
});

// ---------- Ausstellungsstück im Menü ----------
function setShowcase(id) {
  if (showcase) scene.remove(showcase.mesh);
  const m = buildModel(id, 0);
  showcase = { id, mesh: m.mesh, props: m.props, def: DEFS[id] };
  scene.add(m.mesh);
}

function updateMenu(dt) {
  menuAngle += dt * 0.12;
  const s = showcase;
  const t = world.time;
  if (!s) return;
  const isPlane = s.def.kind === 'plane';
  const size = isPlane ? 14 : s.def.len;
  if (isPlane) {
    s.mesh.position.set(0, 30 + Math.sin(t * 0.8) * 1.2, 0);
    s.mesh.rotation.set(Math.sin(t * 0.6) * 0.04, 0, Math.sin(t * 0.5) * 0.08);
    for (const p of s.props) p.rotation.z += dt * 40;
  } else {
    s.mesh.position.set(0, waveHeight(0, 0, t) * 0.5, 0);
    s.mesh.rotation.set(Math.sin(t * 0.7) * 0.01, 0, Math.sin(t * 0.5) * 0.02);
  }
  const d = size * (isPlane ? 1.5 : 1.0) + 8;
  const shift = innerWidth > 820 ? 0.28 : 0;
  camera.fov = 50; camera.updateProjectionMatrix();
  camera.position.set(Math.sin(menuAngle) * d, s.mesh.position.y + size * 0.28 + 2, Math.cos(menuAngle) * d);
  camera.lookAt(s.mesh.position.x, s.mesh.position.y + (isPlane ? 0 : s.def.top * 0.3), s.mesh.position.z);
  camera.rotateY(-shift * 0.5);
  world.update(dt, s.mesh.position, camera);
}

// ---------- Spielablauf ----------
function startGame() {
  if (game) endGame();
  if (showcase) { scene.remove(showcase.mesh); showcase = null; }
  effects.clear();
  game = new Game({
    scene, world, effects, audio, settings, unlocks,
    hooks: {
      hit: (kill) => { hud.hit(kill); audio.hit(kill); },
      hurt: (f) => hud.hurt(f),
      feed: (k, v, how) => hud.feed(k, v, how, game.player),
      reward: (label, text) => hud.toast(label, text),
      unlocked: (ids) => {
        saveUnlocks();
        hud.toast('Freigeschaltet', ids.map((id) => DEFS[id].name).join(' und '), 4500);
      },
      playerDied: (killer) => {
        state = 'dead';
        deadTimer = 3;
        respawnAt = performance.now() / 1000 + 6;
        hud.death('Abgeschossen', killer ? `von ${esc(killer.name)} (${killer.def.name})` : '');
      },
      zone: (z, team) => {
        const ours = team === 0;
        hud.toast(`Zone ${z.name}`, ours ? 'eingenommen' : `an ${TEAM_NAMES[team]} verloren`, 2500);
      },
      end: (winner) => {
        setTimeout(() => showResult(winner), 2500);
      },
    },
  });
  game.start(selected);
  hud.setup(game, world);
  beginControl();
}

function beginControl() {
  const p = game.player;
  state = 'playing';
  hud.death(null);
  hud.show(true);
  showScreen(null);
  view.yaw = Math.atan2(-p.fwd.x, -p.fwd.z);
  view.pitch = p.kind === 'plane' ? 0 : -0.08;
  view.freeYaw = view.freePitch = 0;
  view.zoom = 1;
  if (p.kind === 'ship') { p.throttleStep = 2; p.ctrl.throttle = 0.5; }
  view.camPos.copy(p.pos);
  mouse.dx = mouse.dy = 0;
  requestLock();
}

function endGame() {
  if (!game) return;
  game.dispose();
  game = null;
  effects.clear();
  hud.show(false);
  audio.engine(null);
  if (document.pointerLockElement) document.exitPointerLock();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  showScreen('pause');
  audio.engine(null);
}
$('resume').addEventListener('click', () => {
  state = 'playing';
  showScreen(null);
  requestLock();
});
$('quit').addEventListener('click', () => { endGame(); toMenu(); });
$('again').addEventListener('click', () => { endGame(); openHangar(false); });

function showResult(winner) {
  if (!game) return;
  state = 'result';
  if (document.pointerLockElement) document.exitPointerLock();
  audio.engine(null);
  const s = game.stats;
  $('resultTitle').textContent = winner === 0 ? 'Sieg' : winner === 1 ? 'Niederlage' : 'Unentschieden';
  $('resultSub').textContent = `Blau ${Math.ceil(game.tickets[0])} : ${Math.ceil(game.tickets[1])} Rot · ${fmtTime(game.time)} gespielt`;
  $('resultStats').innerHTML = [
    ['Abschüsse', s.kills], ['Abgeschossen', s.deaths], ['Beste Serie', s.bestStreak],
    ['Zonen eingenommen', s.caps], ['Schaden', Math.round(s.damage)],
  ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  showScreen('result');
  hud.show(false);
}

function onKeyPress(code) {
  if (!game || state !== 'playing') return;
  const p = game.player;
  if (code === 'KeyF' && game.barrageReady) {
    if (game.callBarrage(view.aim)) hud.toast('Sperrfeuer', 'Einschlag in 3 Sekunden', 2000);
  }
  if (code === 'Escape') pause();
  if (!p || !p.alive) return;
  if (p.kind === 'ship') {
    if (code === 'KeyW') p.throttleStep = Math.min(4, (p.throttleStep ?? 2) + 1);
    if (code === 'KeyS') p.throttleStep = Math.max(-1, (p.throttleStep ?? 2) - 1);
    p.ctrl.throttle = p.throttleStep === -1 ? -0.25 : p.throttleStep / 4;
    if (code === 'Space' || code === 'Mouse2') p.ctrl.torp = true;
  }
}

// ---------- Spielersteuerung & Kamera ----------
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();

function dirFrom(yaw, pitch, out) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

function controlPlayer(dt) {
  const p = game.player;
  const sens = 0.0022 * settings.sens * view.zoom;
  const inv = settings.invert ? -1 : 1;
  const free = keys.has('KeyC');
  if (free) {
    view.freeYaw -= mouse.dx * sens; view.freePitch = clamp(view.freePitch - mouse.dy * sens * inv, -1.2, 1.2);
  } else {
    view.yaw -= mouse.dx * sens;
    view.pitch = clamp(view.pitch - mouse.dy * sens * inv, p.kind === 'plane' ? -1.45 : -0.6, p.kind === 'plane' ? 1.45 : 0.35);
    view.freeYaw *= 0.85; view.freePitch *= 0.85;
  }
  mouse.dx = mouse.dy = 0;
  const zoomKey = keys.has('ShiftLeft') || keys.has('ShiftRight');
  view.zoom += ((zoomKey ? 0.35 : 1) - view.zoom) * Math.min(1, dt * 10);
  if (mouse.wheel) { view.dist = clamp((view.dist || 1) + mouse.wheel * 0.12, 0.5, 2.2); mouse.wheel = 0; }

  if (!p.alive) return;
  if (p.kind === 'plane') {
    const c = p.ctrl;
    const aimDir = dirFrom(view.yaw, view.pitch, _f);
    p.steer(aimDir);
    if (keys.has('KeyA')) c.roll = -1;
    if (keys.has('KeyD')) c.roll = 1;
    if (keys.has('KeyW')) c.throttle = Math.min(1, c.throttle + dt * 0.7);
    if (keys.has('KeyS')) c.throttle = Math.max(0, c.throttle - dt * 0.7);
    c.fire = mouse.left;
    c.fire2 = mouse.right || keys.has('Space');
  } else {
    const c = p.ctrl;
    c.rudder = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    c.fire = mouse.left;
    c.aimPoint = view.aim;
  }
}

function updateCamera(dt) {
  const p = game.player;
  const distMul = view.dist || 1;
  view.lead = null;
  if (p.kind === 'plane') {
    const fov = 70 * view.zoom;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const yaw = view.yaw + view.freeYaw, pitch = clamp(view.pitch + view.freePitch, -1.5, 1.5);
    const dir = dirFrom(yaw, pitch, _f);
    const d = p.def.hitR * 3.4 * distMul;
    _t.copy(p.pos).addScaledVector(dir, -d);
    _t.y += d * 0.2;
    view.camPos.lerp(_t, p.alive ? Math.min(1, dt * 18) : Math.min(1, dt * 3));
    camera.position.copy(view.camPos);
    camera.rotation.set(pitch, yaw, 0);
    view.aim.copy(dir).multiplyScalar(1500).add(camera.position);
    if (view.aim.y < 0) {
      // Sperrfeuer/Ziel auf Wasserhöhe
      const t = -camera.position.y / dir.y;
      view.aim.copy(camera.position).addScaledVector(dir, t);
    }
    // Vorhalt für das Ziel nahe der Nase
    if (p.alive) {
      const gun = p.def.guns[0];
      let best = null, bestA = 0.25;
      for (const u of game.units) {
        if (!u.alive || u.team === 0 || u.kind !== 'plane') continue;
        const dist = u.pos.distanceTo(p.pos);
        if (dist > 1500) continue;
        _u.subVectors(u.pos, camera.position).normalize();
        const a = Math.acos(clamp(_u.dot(dir), -1, 1));
        if (a < bestA) { bestA = a; best = u; }
      }
      if (best) {
        const dist = best.pos.distanceTo(p.pos);
        // Geschosse erben das eigene Tempo, also zählt die Relativbewegung
        const t = dist / gun.speed;
        view.leadVec.copy(best.vel).sub(p.vel).multiplyScalar(t).add(best.pos);
        view.lead = view.leadVec;
      }
    }
  } else {
    const fov = 60 * view.zoom;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const yaw = view.yaw + view.freeYaw, pitch = view.pitch + view.freePitch;
    const dir = dirFrom(yaw, pitch, _f);
    const pivot = _u.copy(p.pos); pivot.y += p.def.top * 0.9;
    const d = p.def.camDist * distMul * (view.zoom < 0.9 ? 0.6 : 1);
    _t.copy(pivot).addScaledVector(dir, -d);
    _t.y += d * 0.18;
    _t.y = Math.max(_t.y, 4);
    view.camPos.lerp(_t, Math.min(1, dt * 12));
    camera.position.copy(view.camPos);
    camera.rotation.set(pitch, yaw, 0);
    const cf = dirFrom(yaw, pitch, _t);
    const range = p.cal.range;
    let tHit = cf.y < -0.0005 ? -camera.position.y / cf.y : Infinity;
    const horiz = Math.hypot(cf.x, cf.z);
    const maxT = (range * 1.1 + d) / Math.max(horiz, 0.01);
    if (tHit > maxT) tHit = maxT;
    view.aim.copy(camera.position).addScaledVector(cf, tHit);
    view.aim.y = Math.max(0, view.aim.y);
    game.aimDist = Math.hypot(view.aim.x - p.pos.x, view.aim.z - p.pos.z);
    // Vorhalt-Raute für das Schiff nahe dem Fadenkreuz
    if (p.alive) {
      let best = null, bestA = 0.12;
      for (const u of game.units) {
        if (!u.alive || u.team === 0 || u.kind !== 'ship') continue;
        _u.subVectors(u.pos, camera.position).normalize();
        const a = Math.acos(clamp(_u.dot(cf), -1, 1));
        if (a < bestA && u.pos.distanceTo(p.pos) < range * 1.1) { bestA = a; best = u; }
      }
      if (best) {
        const lv = view.leadVec.copy(best.pos);
        for (let i = 0; i < 3; i++) {
          const dx = Math.hypot(lv.x - p.pos.x, lv.z - p.pos.z);
          const e = elevationFor(dx, 0, p.cal.speed) || 0.4;
          const tof = dx / (p.cal.speed * Math.cos(e));
          lv.copy(best.vel).multiplyScalar(tof).add(best.pos);
        }
        lv.y = 2;
        view.lead = lv;
      }
    }
  }
}

// ---------- Hauptschleife ----------
let last = performance.now();
let fpsAcc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'menu' || state === 'loading') {
    updateMenu(dt);
    effects.update(dt);
  } else if (game && (state === 'playing' || state === 'dead')) {
    controlPlayer(dt);
    game.update(dt);
    effects.update(dt);
    const p = game.player;
    updateCamera(dt);
    world.update(dt, p.pos, camera);
    audio.setListener(camera.position);
    if (p.alive) audio.engine(p.kind, p.kind === 'plane' ? p.ctrl.throttle : Math.abs(p.ctrl.throttle));
    else audio.engine(null);
    hud.scoreboard(game, keys.has('Tab'));
    hud.update(dt, game, camera, view);
    if (state === 'dead') {
      deadTimer -= dt;
      if (deadTimer <= 0 && $('hangar').hidden) {
        hud.death(null);
        if (document.pointerLockElement) document.exitPointerLock();
        wasLocked = false;
        openHangar(true);
      }
      if (!$('hangar').hidden) updateDeployButton();
    }
  } else if (game && (state === 'paused' || state === 'result')) {
    // Standbild, aber Wasser bewegt sich weiter
    world.update(dt * 0.3, game.player.pos, camera);
  }
  renderer.render(scene, camera);
}

// Start
showScreen('menu');
state = 'menu';
setShowcase(selected);
requestAnimationFrame(frame);
