import * as THREE from 'three';
import { World, waveHeight } from './world.js?v=9';
import { Effects } from './effects.js?v=9';
import { Sound } from './audio.js?v=9';
import { Game, TEAM_NAMES, STREAKS, PER_TEAM } from './game.js?v=9';
import { DEFS, CALIBERS, PLANES, SHIPS } from './vehicles.js?v=9';
import { buildModel } from './models.js?v=9';
import { Hud, vehicleCardHtml, vehicleDetailsHtml, esc } from './hud.js?v=9';
import { clamp, elevationFor, fmtTime } from './util.js?v=9';
import { createPipeline } from './render.js?v=9';
import { NetHost, NetClient, ClientGame, findRandom, makeCode, normalizeCode } from './net.js?v=9';
import { splitLogo, screenIn, cardsIn, detailsIn, countUp, resultIn, hudIn, bindUiSounds, camoTransition } from './ui.js?v=9';

const $ = (id) => document.getElementById(id);

// ---------- Einstellungen, Freischaltungen, Dienstakte ----------
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
const career = { matches: 0, wins: 0, kills: 0, best: 0, ...load('sturmflut.career', {}) };

const UNLOCK_TEXT = {};
for (const s of STREAKS) if (s.unlock) for (const id of s.unlock) UNLOCK_TEXT[id] = `${s.n}er-Serie`;

const RANKS = [[0, 'Rekrut'], [10, 'Gefreiter'], [30, 'Unteroffizier'], [75, 'Feldwebel'], [150, 'Leutnant'], [300, 'Hauptmann'], [600, 'Major']];
const rankFor = (k) => RANKS.filter(([n]) => k >= n).pop()[1];

// ---------- Renderer ----------
const canvas = $('game');
const quality = settings.quality;
// Kantenglättung übernimmt SMAA in der Nachbearbeitung
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
const pixelRatio = { niedrig: 0.75, mittel: 1, hoch: 1.5 }[quality] ?? 1;
renderer.setPixelRatio(Math.min(2, Math.min(window.devicePixelRatio || 1, 2) * pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = quality !== 'niedrig';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 16000);
camera.rotation.order = 'YXZ';

const pipeline = createPipeline(renderer, scene, camera, quality);
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  pipeline.setSize(innerWidth, innerHeight);
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
  if (e.code === 'Tab') e.preventDefault();
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
function releaseLock() {
  wasLocked = false;
  if (document.pointerLockElement) document.exitPointerLock();
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  ignoreMouseUntil = performance.now() + 150;
  if (locked) wasLocked = true;
  else if (wasLocked && state === 'playing') pause();
});

// ---------- Zustand ----------
// state: menu | playing | dead | deploy | waiting | paused | result
let state = 'loading';
let mode = 'solo'; // solo | host | client
let net = null;
let game = null;
let tab = 'plane';
let selected = 'falke';
let respawnAt = 0;
let deadTimer = 0;
let showcase = null;
let menuAngle = 0;
let torpSeq = 0;
let inLobby = false;
let connectSeq = 0; // verwirft Verbindungen, die nach "Abbrechen" noch ankommen

const view = {
  yaw: 0, pitch: 0, zoom: 1, freeYaw: 0, freePitch: 0, lead: null, dist: 1,
  camPos: new THREE.Vector3(), aim: new THREE.Vector3(), aimDir: new THREE.Vector3(0, 0, -1), leadVec: new THREE.Vector3(),
};

const screens = ['loading', 'menu', 'hangar', 'controls', 'settings', 'pause', 'result', 'join', 'connecting', 'lobby'];
let backTarget = 'menu';
function showScreen(name) {
  for (const s of screens) {
    const el = $(s);
    const show = s === name;
    if (show && el.hidden) { el.hidden = false; screenIn(el); }
    else el.hidden = !show;
  }
}
const currentScreen = () => screens.find((s) => !$(s).hidden) || null;

document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
  audio.init();
  const go = b.dataset.go;
  if (go === 'training') camoTransition(() => openHangar('training'), 'Training');
  else if (go === 'host') hostRoom(false);
  else if (go === 'join') { $('joinError').hidden = true; showScreen('join'); setTimeout(() => $('joinCode').focus(), 50); }
  else if (go === 'random') playRandom();
  else if (go === 'menu') { leaveAll(); toMenu(); }
  else if (go === 'controls-ingame') { backTarget = 'pause'; showScreen('controls'); }
  else if (go === 'controls') { backTarget = 'menu'; showScreen('controls'); }
  else if (go === 'back') showScreen(backTarget);
  else if (go === 'settings') { fillSettings(); showScreen('settings'); }
}));

function toMenu() {
  state = 'menu';
  hud.show(false);
  audio.engine(null);
  showScreen('menu');
  renderProfile();
  setShowcase(selected);
}

function renderProfile() {
  $('profName').textContent = settings.name;
  $('profRank').textContent = rankFor(career.kills);
  $('profUnlocks').textContent = `${unlocks.size}/6 Fahrzeuge`;
  $('carMatches').textContent = career.matches;
  $('carWins').textContent = career.wins;
  $('carKills').textContent = career.kills;
  $('carStreak').textContent = career.best;
}

// ---------- Hangar ----------
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  tab = t.dataset.tab;
  const list = tab === 'plane' ? PLANES : SHIPS;
  if (!list.includes(selected)) selected = list.find((id) => unlocks.has(id)) || list[0];
  renderHangar();
}));

// kind: training (vor dem Solo-Gefecht) | deploy (Einstieg ins laufende Gefecht) | respawn
let hangarKind = 'training';
function openHangar(kind) {
  hangarKind = kind;
  showScreen('hangar');
  const titles = { training: ['Training', 'Fahrzeug wählen'], deploy: [modeLabel(), 'Einsatz wählen'], respawn: [modeLabel(), 'Wieder einsteigen'] };
  $('hangarKicker').textContent = titles[kind][0];
  $('hangarTitle').textContent = titles[kind][1];
  $('hangarBack').textContent = kind === 'training' ? 'Zurück' : 'Gefecht verlassen';
  tab = DEFS[selected].kind;
  if (!unlocks.has(selected)) selected = tab === 'plane' ? 'falke' : 'schnellboot';
  if (kind === 'training') { state = 'menu'; setShowcase(selected); }
  renderHangar();
}

function modeLabel() {
  if (mode === 'solo') return 'Training';
  return net && net.code && net.code.startsWith('PUB') ? 'Schnelles Gefecht' : `Raum ${net ? net.code : ''}`;
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
  detailsIn($('details'));
  if (cards.dataset.tab !== tab) { cards.dataset.tab = tab; cardsIn(cards); }
  updateDeployButton();
}

function updateDeployButton() {
  const btn = $('deploy');
  const isLocked = !unlocks.has(selected);
  const wait = state === 'dead' ? Math.max(0, respawnAt - performance.now() / 1000) : 0;
  btn.disabled = isLocked || wait > 0 || state === 'waiting';
  btn.textContent = isLocked ? `Gesperrt · ${UNLOCK_TEXT[selected]}` : state === 'waiting' ? 'Wird verlegt …' : wait > 0 ? `Bereit in ${Math.ceil(wait)} s` : 'Ins Gefecht';
  $('respawnTimer').textContent = game ? `Blau ${Math.ceil(game.tickets[0])} · Rot ${Math.ceil(game.tickets[1])} · ${fmtTime(game.duration - game.time)}` : '';
}

$('deploy').addEventListener('click', () => {
  audio.init();
  if (!unlocks.has(selected)) return;
  if (hangarKind === 'training') { startSolo(); return; }
  if (!game || state === 'waiting') return;
  if (state === 'dead' && performance.now() / 1000 < respawnAt) return;
  if (mode === 'client') {
    game.respawnPlayer(selected);
    state = 'waiting';
    updateDeployButton();
    return;
  }
  game.respawnPlayer(selected);
  state = 'entering';
  camoTransition(() => beginControl(), 'Einsatz');
});

$('hangarBack').addEventListener('click', () => {
  if (hangarKind === 'training') { toMenu(); return; }
  camoTransition(() => { leaveAll(); toMenu(); });
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
  renderProfile();
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
  renderProfile();
});

// ---------- Ausstellungsstück im Menü ----------
function setShowcase(id) {
  if (showcase) scene.remove(showcase.mesh);
  const m = buildModel(id, 0);
  showcase = { id, mesh: m.mesh, props: m.props, def: DEFS[id] };
  scene.add(m.mesh);
}
function hideShowcase() {
  if (showcase) { scene.remove(showcase.mesh); showcase = null; }
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
  camera.rotateY(shift * 0.6);
  world.update(dt, s.mesh.position, camera);
}

// ---------- Spiel-Hooks ----------
function makeHooks() {
  return {
    hit: (kill) => { hud.hit(kill); audio.hit(kill); },
    hurt: (f, from) => { hud.hurt(f, from); audio.clank(); shake(Math.min(0.6, f * 6)); },
    kill: (victim, streak) => hud.kill(victim, streak),
    feed: (k, v, how) => hud.feed(k, v, how, game && game.player),
    notice: (text) => hud.notice(text),
    recoil: (size) => shake(size * 0.35),
    reward: (label, text) => { hud.toast(label, text); audio.uiToast(); },
    unlocked: (ids) => {
      ids.forEach((id) => unlocks.add(id));
      saveUnlocks();
      hud.toast('Freigeschaltet', ids.map((id) => DEFS[id].name).join(' und '), 4500);
      audio.uiUnlock();
    },
    playerDied: (killer) => {
      state = 'dead';
      deadTimer = 3;
      respawnAt = performance.now() / 1000 + 6;
      hud.death('Abgeschossen', killer ? `von ${esc(killer.name)} (${killer.def.name})` : '');
    },
    zone: (z, team) => {
      const ours = team === game.myTeam;
      hud.toast(`Zone ${z.name}`, ours ? 'eingenommen' : `an ${TEAM_NAMES[team]} verloren`, 2500);
    },
    end: (winner) => setTimeout(() => showResult(winner), 2500),
  };
}

function newLocalGame(difficulty) {
  return new Game({ scene, world, effects, audio, settings: { ...settings, difficulty }, unlocks, hooks: makeHooks() });
}

function prepareMatch() {
  if (game) disposeGame();
  hideShowcase();
  effects.clear();
}

// ---------- Training ----------
function startSolo() {
  camoTransition(() => {
    mode = 'solo';
    prepareMatch();
    game = newLocalGame(settings.difficulty);
    game.start(selected);
    hud.setup(game, world);
    beginControl();
  }, 'Einsatz');
}

// ---------- Mehrspieler ----------
const NET_ERRORS = {
  'peer-unavailable': 'Kein Raum mit diesem Code gefunden.',
  'unavailable-id': 'Dieser Code ist schon vergeben.',
  'browser-incompatible': 'Dieser Browser unterstützt kein WebRTC.',
  'full': 'Der Raum ist voll.',
  'no-lib': 'Mehrspieler-Bibliothek konnte nicht geladen werden.',
};
function netError(e) {
  return NET_ERRORS[e && e.type] || 'Keine Verbindung zum Vermittlungsserver. Möglicherweise blockiert das Netzwerk WebRTC.';
}

function showConnecting(title, text) {
  $('connTitle').textContent = title;
  $('connText').textContent = text || '';
  $('connecting').querySelector('.radar').hidden = false;
  showScreen('connecting');
}
function showNetError(e) {
  leaveAll();
  $('connTitle').textContent = 'Verbindung fehlgeschlagen';
  $('connText').textContent = typeof e === 'string' ? e : netError(e);
  $('connecting').querySelector('.radar').hidden = true;
  state = 'menu';
  hud.show(false);
  showScreen('connecting');
  if (!showcase) setShowcase(selected);
}

async function hostRoom(isPublic) {
  const seq = ++connectSeq;
  showConnecting('Raum wird erstellt …', 'Verbinde mit dem Vermittlungsserver');
  for (let i = 0; i < 4; i++) {
    try {
      const h = await NetHost.create(makeCode(), { name: settings.name, isPublic });
      if (seq !== connectSeq) { h.close(); return; }
      net = h;
      break;
    } catch (e) {
      if (seq !== connectSeq) return;
      if (e.type !== 'unavailable-id') { showNetError(e); return; }
    }
  }
  if (!net) { showNetError('Kein freier Code gefunden.'); return; }
  mode = 'host';
  net.settings.difficulty = settings.difficulty;
  wireHost();
  inLobby = true;
  showScreen('lobby');
  net.broadcastLobby();
}

function wireHost() {
  net.onChange = (st) => renderLobby(st, true);
  net.onError = (e) => { if (e.type === 'network' || e.type === 'server-error') hud.notice('Vermittlungsserver getrennt, laufende Verbindungen bleiben bestehen'); };
}

async function joinRoom(code) {
  code = normalizeCode(code);
  if (code.length < 4) { $('joinError').textContent = 'Der Code hat 5 Zeichen.'; $('joinError').hidden = false; return; }
  const seq = ++connectSeq;
  showConnecting(`Raum ${code}`, 'Verbinde …');
  try {
    const c = await NetClient.connect(code, { name: settings.name, unlocks });
    if (seq !== connectSeq) { c.close(); return; }
    net = c;
  } catch (e) {
    if (seq === connectSeq) showNetError(e);
    return;
  }
  mode = 'client';
  wireClient();
}

function wireClient() {
  net.onLobby = (st) => {
    if (st.started) return; // Einstieg läuft über 'start'
    if (game) { disposeGame(); hud.show(false); }
    inLobby = true;
    state = 'menu';
    showScreen('lobby');
    renderLobby(st, false);
  };
  net.onStart = (m) => camoTransition(() => startClientMatch(m), 'Einsatz');
  net.onFull = () => showNetError({ type: 'full' });
  net.onClose = () => { if (net) showNetError('Die Verbindung zum Host wurde getrennt.'); };
}

async function playRandom() {
  const seq = ++connectSeq;
  showConnecting('Suche Gefecht …', 'Prüfe öffentliche Räume');
  let r;
  try {
    r = await findRandom({ name: settings.name, unlocks });
  } catch (e) {
    if (seq === connectSeq) showNetError(e);
    return;
  }
  if (seq !== connectSeq) { (r.host || r.client).close(); return; }
  if (r.host) {
    net = r.host;
    mode = 'host';
    wireHost();
    startHostMatch();
  } else {
    net = r.client;
    mode = 'client';
    wireClient();
    $('connText').textContent = 'Raum gefunden, warte auf Freigabe …';
  }
}

$('joinGo').addEventListener('click', () => joinRoom($('joinCode').value));
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('joinCode').value); });
$('joinCode').addEventListener('input', (e) => { e.target.value = normalizeCode(e.target.value); });

function renderLobby(st, isHost) {
  if (!inLobby) return;
  $('lobbyCode').textContent = st.code;
  $('lobbyKicker').textContent = st.isPublic ? 'Öffentlicher Raum' : isHost ? 'Du bist Host' : 'Mitspieler';
  const myKey = isHost ? 'host' : net.id;
  for (const [team, el] of [[0, $('teamBlue')], [1, $('teamRed')]]) {
    const players = st.players.filter((p) => p.team === team);
    const ai = Math.max(0, PER_TEAM - players.length);
    el.innerHTML = players.map((p) => `<li>${esc(p.name)}${p.host ? ' <em>Host</em>' : ''}${p.key === myKey ? ' <em>Du</em>' : ''}</li>`).join('')
      + (ai ? `<li class="ai">KI × ${ai}</li>` : '');
  }
  $('lobbyOpts').hidden = !isHost;
  $('optMode').value = st.settings.mode;
  $('optDiff').value = st.settings.difficulty;
  $('lobbyStart').hidden = !isHost;
  $('lobbyTeam').hidden = st.settings.mode !== 'versus';
  $('lobbyNote').textContent = isHost
    ? `${st.players.length} Spieler im Raum. Freie Plätze füllt die KI. Wer später kommt, steigt direkt ins Gefecht ein.`
    : 'Warte, bis der Host das Gefecht startet …';
}

$('optMode').addEventListener('change', (e) => { if (mode === 'host') net.setSettings({ mode: e.target.value }); });
$('optDiff').addEventListener('change', (e) => { if (mode === 'host') net.setSettings({ difficulty: e.target.value }); });
$('lobbyTeam').addEventListener('click', () => {
  if (mode === 'host') { net.hostTeam = net.hostTeam ? 0 : 1; net.broadcastLobby(); }
  else if (net) {
    const st = net.lastLobby;
    const me = st && st.players.find((p) => p.key === net.id);
    net.setTeam(me && me.team === 0 ? 1 : 0);
  }
});
$('lobbyStart').addEventListener('click', () => { if (mode === 'host') startHostMatch(); });
$('lobbyLeave').addEventListener('click', () => { leaveAll(); toMenu(); });
$('copyCode').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?raum=${net.code}`;
  try { await navigator.clipboard.writeText(link); $('copyCode').textContent = 'Link kopiert'; }
  catch { $('copyCode').textContent = net.code; }
  setTimeout(() => { $('copyCode').textContent = 'Kopieren'; }, 1800);
});

function startHostMatch() {
  camoTransition(() => {
    inLobby = false;
    prepareMatch();
    game = newLocalGame(net.settings.difficulty);
    net.attach(game);
    game.start(null, net.hostTeam);
    net.startGame();
    hud.setup(game, world);
    enterDeploy();
  }, 'Einsatz');
}

function startClientMatch(m) {
  inLobby = false;
  prepareMatch();
  game = new ClientGame({ scene, world, effects, audio, settings, unlocks, hooks: makeHooks(), net });
  game.myTeam = m.team;
  net.game = game;
  hud.setup(game, world);
  enterDeploy();
}

function enterDeploy() {
  state = 'deploy';
  hud.death(null);
  hud.show(false);
  releaseLock();
  openHangar('deploy');
}

function disposeGame() {
  if (!game) return;
  game.dispose();
  if (net) net.game = null;
  game = null;
  effects.clear();
}

function leaveAll() {
  connectSeq++;
  disposeGame();
  hud.show(false);
  audio.engine(null);
  releaseLock();
  inLobby = false;
  if (net) { const n = net; net = null; n.close(); }
  mode = 'solo';
}

// ---------- Steuerung übernehmen ----------
function beginControl() {
  const p = game.player;
  state = 'playing';
  hud.death(null);
  hud.show(true);
  hudIn($('hud'));
  showScreen(null);
  view.yaw = Math.atan2(-p.fwd.x, -p.fwd.z);
  view.pitch = p.kind === 'plane' ? 0 : -0.08;
  view.freeYaw = view.freePitch = 0;
  view.zoom = 1;
  if (p.kind === 'ship') { p.throttleStep = 2; p.ctrl.throttle = 0.5; }
  view.camPos.copy(p.pos);
  mouse.dx = mouse.dy = 0;
  $('netinfo').hidden = mode === 'solo';
  $('netinfo').textContent = mode === 'solo' ? '' : `${modeLabel()} · ${mode === 'host' ? 'Host' : 'verbunden'}`;
  requestLock();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  $('pauseKicker').textContent = mode === 'solo' ? 'Gefecht angehalten' : 'Gefecht läuft weiter';
  showScreen('pause');
  audio.engine(null);
}
$('resume').addEventListener('click', () => {
  state = 'playing';
  showScreen(null);
  requestLock();
});
$('quit').addEventListener('click', () => camoTransition(() => { leaveAll(); toMenu(); }));
$('again').addEventListener('click', () => {
  if (mode === 'solo') { camoTransition(() => { disposeGame(); openHangar('training'); }); return; }
  if (mode === 'host') {
    if (net.isPublic) { startHostMatch(); return; }
    camoTransition(() => {
      disposeGame();
      inLobby = true;
      state = 'menu';
      setShowcase(selected);
      showScreen('lobby');
      net.broadcastLobby();
    });
  }
});

function showResult(winner) {
  if (!game) return;
  state = 'result';
  releaseLock();
  audio.engine(null);
  const s = game.stats;
  const my = game.myTeam;
  const won = winner === my;
  $('resultTitle').textContent = winner === -1 ? 'Unentschieden' : won ? 'Sieg' : 'Niederlage';
  $('resultSub').textContent = `Blau ${Math.ceil(game.tickets[0])} : ${Math.ceil(game.tickets[1])} Rot · ${fmtTime(game.time)} gespielt`;
  $('resultStats').innerHTML = [
    ['Abschüsse', s.kills], ['Abgeschossen', s.deaths], ['Beste Serie', s.bestStreak],
    ['Zonen eingenommen', s.caps], ['Schaden', Math.round(s.damage)],
  ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  const again = $('again');
  again.hidden = mode === 'client';
  again.textContent = mode === 'host' && !net.isPublic ? 'Zurück zur Lobby' : 'Noch ein Gefecht';
  camoTransition(() => {
    hud.show(false);
    showScreen('result');
    resultIn($('result'));
    $('resultStats').querySelectorAll('td:last-child').forEach((td, i) => countUp(td, Number(td.textContent), 0.4 + i * 0.08));
  }, won ? 'Sieg' : 'Gefechtsende');

  career.matches++;
  if (won) career.wins++;
  career.kills += s.kills;
  career.best = Math.max(career.best, s.bestStreak);
  save('sturmflut.career', career);
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
    if (code === 'Space' || code === 'Mouse2') { p.ctrl.torp = true; torpSeq++; }
  }
}

// ---------- Spielersteuerung & Kamera ----------
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _t = new THREE.Vector3();

function dirFrom(yaw, pitch, out) {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

function controlPlayer(dt) {
  const p = game.player;
  if (!p) return;
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
  if (mouse.wheel) { view.dist = clamp(view.dist + mouse.wheel * 0.12, 0.5, 2.2); mouse.wheel = 0; }

  if (!p.alive) return;
  const c = p.ctrl;
  if (p.kind === 'plane') {
    dirFrom(view.yaw, view.pitch, view.aimDir);
    p.steer(view.aimDir);
    if (keys.has('KeyA')) c.roll = -1;
    if (keys.has('KeyD')) c.roll = 1;
    if (keys.has('KeyW')) c.throttle = Math.min(1, c.throttle + dt * 0.7);
    if (keys.has('KeyS')) c.throttle = Math.max(0, c.throttle - dt * 0.7);
    c.fire = mouse.left;
    c.fire2 = mouse.right || keys.has('Space');
  } else {
    c.rudder = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    c.fire = mouse.left;
    c.aimPoint = view.aim;
  }

  if (mode === 'client') {
    const r1 = (v) => Math.round(v * 100) / 100;
    if (p.kind === 'plane') {
      const roll = keys.has('KeyA') ? -1 : keys.has('KeyD') ? 1 : 0;
      net.sendInput({ a: [r1(view.aimDir.x), r1(view.aimDir.y), r1(view.aimDir.z)], r: roll, th: r1(c.throttle), f1: c.fire ? 1 : 0, f2: c.fire2 ? 1 : 0 }, performance.now());
    } else {
      const th = p.throttleStep === -1 ? -0.25 : (p.throttleStep ?? 2) / 4;
      net.sendInput({ th, st: p.throttleStep, ru: c.rudder, ap: [Math.round(view.aim.x), Math.round(view.aim.y), Math.round(view.aim.z)], f1: c.fire ? 1 : 0, tq: torpSeq }, performance.now());
    }
  }
}

function updateCamera(dt) {
  const p = game.player;
  const distMul = view.dist;
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
    camera.position.copy(view.camPos).add(shakeOffset(dt));
    camera.rotation.set(pitch, yaw, 0);
    view.aim.copy(dir).multiplyScalar(1500).add(camera.position);
    if (view.aim.y < 0) {
      const t = -camera.position.y / dir.y;
      view.aim.copy(camera.position).addScaledVector(dir, t);
    }
    // Vorhalt für das Ziel nahe der Nase
    if (p.alive) {
      const gun = p.def.guns[0];
      let best = null, bestA = 0.25;
      for (const u of game.units) {
        if (!u.alive || u.team === p.team || u.kind !== 'plane') continue;
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
    camera.position.copy(view.camPos).add(shakeOffset(dt));
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
        if (!u.alive || u.team === p.team || u.kind !== 'ship') continue;
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

// Zuschauerkamera, solange man kein Fahrzeug hat
let specAngle = 0;
const specFocus = new THREE.Vector3(0, 0, 0);
function spectatorCamera(dt) {
  specAngle += dt * 0.04;
  if (Math.abs(camera.fov - 55) > 0.1) { camera.fov = 55; camera.updateProjectionMatrix(); }
  camera.position.set(Math.sin(specAngle) * 2600, 750, Math.cos(specAngle) * 2600);
  camera.lookAt(specFocus);
}

// ---------- Kamerawackeln & Vorbeiflug ----------
let shakeAmt = 0;
const _shake = new THREE.Vector3();
function shake(a) { shakeAmt = Math.min(1.2, shakeAmt + a); }
function shakeOffset(dt) {
  shakeAmt = Math.max(0, shakeAmt - dt * 2.2);
  const a = shakeAmt * shakeAmt * 2.2;
  return _shake.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
}
effects.onBlast = (p, size) => {
  if (state !== 'playing') return;
  const d = camera.position.distanceTo(p);
  if (d < 400) shake(size * 0.5 * (1 - d / 400));
};

const flybyCd = new Map();
function flybys() {
  for (const u of game.units) {
    if (u.kind !== 'plane' || !u.alive || u === game.player) continue;
    const d = u.pos.distanceTo(camera.position);
    if (d < 90 && u.speed > 70 && (flybyCd.get(u.id) || 0) < game.time) {
      flybyCd.set(u.id, game.time + 4);
      audio.flyby(u.pos);
    }
  }
}

// ---------- Hauptschleife ----------
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!game) {
    updateMenu(dt);
    effects.update(dt);
  } else {
    // Im Mehrspieler läuft das Gefecht auch während Pause und Auswertung weiter
    const frozen = mode === 'solo' && (state === 'paused' || state === 'result');
    if (state === 'playing') controlPlayer(dt);
    if (!frozen) {
      game.update(dt);
      effects.update(dt);
      if (mode === 'host' && net) net.tick(dt);
    }
    const p = game.player;
    if (state === 'waiting' && p && p.alive) { state = 'entering'; camoTransition(() => beginControl(), 'Einsatz'); }
    const controlled = p && (state === 'playing' || state === 'dead' || state === 'paused' || state === 'result');
    if (controlled) updateCamera(dt);
    else spectatorCamera(dt);
    world.update(frozen ? dt * 0.3 : dt, controlled ? p.pos : specFocus, camera);
    audio.setListener(camera);
    if (p && p.alive && state === 'playing') {
      audio.engine(p.kind, p.kind === 'plane' ? p.ctrl.throttle : Math.abs(p.ctrl.throttle), p.kind === 'plane' ? p.speed / p.def.maxSpeed : 0);
      if (p.hpFrac < 0.25) audio.alarm();
    } else audio.engine(null);
    flybys();
    pipeline.setHurt(hud.hurtT);
    if (state === 'playing' || state === 'dead') {
      hud.scoreboard(game, keys.has('Tab'));
      hud.update(dt, game, camera, view);
    }
    if (state === 'dead') {
      deadTimer -= dt;
      if (deadTimer <= 0 && $('hangar').hidden) {
        hud.death(null);
        hud.show(false);
        releaseLock();
        openHangar('respawn');
      }
    }
    if (!$('hangar').hidden) updateDeployButton();
  }
  pipeline.render(dt);
}

// Testzugang für automatisierte Tests: index.html?debug
if (new URLSearchParams(location.search).has('debug')) {
  window.__dbg = {
    view, camera, mouse, get game() { return game; }, get state() { return state; }, get net() { return net; },
    step(n, dt = 1 / 30) {
      for (let i = 0; i < n; i++) {
        if (state === 'playing') controlPlayer(dt);
        game.update(dt); effects.update(dt);
        if (mode === 'host' && net) net.tick(dt);
        if (game.player && state === 'playing') updateCamera(dt);
      }
    },
  };
}

// Start
splitLogo();
bindUiSounds(audio);
renderProfile();
showScreen('menu');
state = 'menu';
setShowcase(selected);
requestAnimationFrame(frame);

// Einladungslink: ?raum=CODE öffnet direkt das Beitreten-Fenster
const invite = normalizeCode(new URLSearchParams(location.search).get('raum'));
if (invite) { $('joinCode').value = invite; $('joinError').hidden = true; showScreen('join'); }
