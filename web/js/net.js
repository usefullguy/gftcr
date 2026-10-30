import * as THREE from 'three';
import { createUnit, DEFS } from './vehicles.js';
import { Projectiles } from './weapons.js';
import { PER_TEAM } from './game.js';

// Mehrspieler über WebRTC (PeerJS). Der Host rechnet das Spiel, Clients senden Eingaben
// und bekommen ~15-mal pro Sekunde den Spielstand.

const PREFIX = 'sturmflut-v1-';
const DEF_IDS = Object.keys(DEFS);
const PTYPES = ['bullet', 'shell', 'bomb', 'rocket', 'torpedo'];
const SNAP_RATE = 1 / 15;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PUBLIC_SLOTS = 4;

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

// Signalisierungsserver: öffentlich (0.peerjs.com) oder per ?peer=host:port für eigene/Test-Server
function peerOptions() {
  const p = new URLSearchParams(location.search).get('peer');
  if (!p) return { debug: 0 };
  const [host, port] = p.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 0 };
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    if (!window.Peer) { reject({ type: 'no-lib', message: 'PeerJS nicht geladen' }); return; }
    const peer = id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions());
    const t = setTimeout(() => { peer.destroy(); reject({ type: 'timeout', message: 'Server nicht erreichbar' }); }, 9000);
    peer.once('open', () => { clearTimeout(t); resolve(peer); });
    peer.once('error', (e) => { clearTimeout(t); peer.destroy(); reject(e); });
  });
}

// ---------------------------------------------------------------- Host

export class NetHost {
  static async create(code, { name, isPublic = false } = {}) {
    const peer = await openPeer(PREFIX + code);
    return new NetHost(peer, code, name, isPublic);
  }

  constructor(peer, code, name, isPublic) {
    this.peer = peer;
    this.code = code;
    this.isPublic = isPublic;
    this.peers = new Map(); // peerId -> { conn, name, team, unlocks, out }
    this.settings = { mode: isPublic ? 'versus' : 'coop', difficulty: 'normal' };
    this.hostName = name;
    this.hostTeam = 0;
    this.game = null;
    this.outbox = [];
    this.acc = 0;
    this.onChange = null;
    this.onError = null;
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('error', (e) => { if (this.onError) this.onError(e); });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  accept(conn) {
    conn.on('open', () => {
      const total = this.peers.size + 1;
      const max = this.settings.mode === 'coop' ? PER_TEAM : PER_TEAM * 2;
      if (total >= max) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
      this.peers.set(conn.peer, { conn, name: 'Spieler', team: this.pickTeam(), unlocks: new Set(), out: [] });
    });
    conn.on('data', (m) => this.handle(conn.peer, m));
    conn.on('close', () => this.drop(conn.peer));
    conn.on('error', () => this.drop(conn.peer));
  }

  pickTeam() {
    if (this.settings.mode === 'coop') return 0;
    const n = [this.hostTeam === 0 ? 1 : 0, this.hostTeam === 1 ? 1 : 0];
    for (const p of this.peers.values()) n[p.team]++;
    return n[0] <= n[1] ? 0 : 1;
  }

  drop(id) {
    if (!this.peers.has(id)) return;
    const p = this.peers.get(id);
    this.peers.delete(id);
    if (this.game) {
      this.game.removeHuman(id);
      this.game.hooks.notice(`${p.name} hat das Gefecht verlassen`);
    }
    this.broadcastLobby();
  }

  handle(id, m) {
    const p = this.peers.get(id);
    if (!p || !m || typeof m !== 'object') return;
    switch (m.t) {
      case 'hello': {
        p.name = String(m.name || 'Spieler').slice(0, 16);
        p.unlocks = new Set(Array.isArray(m.unlocks) ? m.unlocks.filter((x) => DEFS[x]) : []);
        if (this.game) {
          // Einstieg in ein laufendes Gefecht
          const h = this.humanFor(id, p);
          this.game.addHuman(h);
          p.conn.send({ t: 'start', you: id, team: p.team, code: this.code });
          this.game.hooks.notice(`${p.name} ist beigetreten`);
        }
        this.broadcastLobby();
        break;
      }
      case 'team':
        if (!this.game && this.settings.mode === 'versus') { p.team = m.team ? 1 : 0; this.broadcastLobby(); }
        break;
      case 'in': {
        const h = this.game && this.game.humans.get(id);
        if (h && h.unit && h.unit.ai && h.unit.remote === id) h.unit.ai.input = m;
        break;
      }
      case 'spawn': {
        const h = this.game && this.game.humans.get(id);
        if (!h || !DEFS[m.def] || this.game.over) break;
        if (h.unit && h.unit.alive) break;
        if (!h.unlocks.has(m.def)) break;
        this.game.spawnHuman(h, m.def);
        break;
      }
      case 'barrage': {
        const h = this.game && this.game.humans.get(id);
        if (h && h.unit && Array.isArray(m.p)) this.game.callBarrage(new THREE.Vector3().fromArray(m.p), h.unit);
        break;
      }
    }
  }

  setSettings(s) {
    Object.assign(this.settings, s);
    if (s.mode === 'coop') { this.hostTeam = 0; for (const p of this.peers.values()) p.team = 0; }
    if (s.mode === 'versus') { let i = 1; for (const p of this.peers.values()) p.team = i++ % 2; }
    this.broadcastLobby();
  }

  lobbyState() {
    const players = [{ key: 'host', name: this.hostName, team: this.hostTeam, host: true }];
    for (const [key, p] of this.peers) players.push({ key, name: p.name, team: p.team });
    return { t: 'lobby', code: this.code, players, settings: this.settings, started: !!this.game, isPublic: this.isPublic };
  }

  broadcastLobby() {
    const st = this.lobbyState();
    for (const p of this.peers.values()) if (p.conn.open) p.conn.send(st);
    if (this.onChange) this.onChange(st);
  }

  humanFor(id, p) {
    const out = p.out;
    const hooks = {
      hit: (kill) => out.push(['hit', kill ? 1 : 0]),
      hurt: (f, pos) => out.push(['hurt', r3(f), pos ? r1(pos.x) : 0, pos ? r1(pos.y) : 0, pos ? r1(pos.z) : 0, pos ? 1 : 0]),
      kill: (v, streak) => out.push(['kill', v.id, streak]),
      reward: (l, t) => out.push(['reward', l, t]),
      unlocked: (ids) => out.push(['unlocked', ids]),
      playerDied: (k) => out.push(['died', k ? k.id : 0]),
    };
    return { key: id, name: p.name, team: p.team, unit: null, unlocks: p.unlocks, hooks };
  }

  // Vor game.start(): Mitspieler eintragen, damit die Bot-Anzahl stimmt
  attach(game) {
    this.game = game;
    game.net = this;
    game.local.team = this.hostTeam;
    for (const [id, p] of this.peers) {
      const h = this.humanFor(id, p);
      h.stats = { kills: 0, deaths: 0, caps: 0, bestStreak: 0, damage: 0 };
      game.humans.set(id, h);
    }
    const proj = game.projectiles;
    const fire = proj.fire.bind(proj);
    proj.fire = (type, pos, vel, owner, o) => {
      this.outbox.push(['p', PTYPES.indexOf(type), r1(pos.x), r1(pos.y), r1(pos.z), r1(vel.x), r1(vel.y), r1(vel.z),
        owner.team, o.size || 1, r1(o.life), o.flak ? 1 : 0, owner.id || 0]);
      return fire(type, pos, vel, owner, o);
    };
  }

  startGame() {
    for (const [id, p] of this.peers) if (p.conn.open) p.conn.send({ t: 'start', you: id, team: p.team, code: this.code });
    this.broadcastLobby();
  }

  event(ev) { this.outbox.push(ev); }

  end(winner) {
    for (const [id, p] of this.peers) {
      const h = this.game.humans.get(id);
      p.out.push(['end', winner, h ? h.stats : null]);
    }
    this.flush();
  }

  tick(dt) {
    if (!this.game) return;
    this.acc += dt;
    if (this.acc < SNAP_RATE) return;
    this.acc = 0;
    this.flush();
  }

  flush() {
    const g = this.game;
    const units = [];
    for (const u of g.units) {
      if (u.removed && !u.human) continue;
      const q = u.root.quaternion;
      const ap = u.kind === 'ship' && u.ctrl.aimPoint ? [r1(u.ctrl.aimPoint.x), r1(u.ctrl.aimPoint.y), r1(u.ctrl.aimPoint.z)] : 0;
      units.push([
        u.id, DEF_IDS.indexOf(u.def.id), u.team, u.remote || (u.isPlayer ? 'host' : ''), u.name,
        r1(u.pos.x), r1(u.pos.y), r1(u.pos.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w),
        Math.round(u.hp), (u.alive ? 1 : 0) | (u.removed ? 2 : 0) | (u.escort ? 4 : 0),
        r1(u.speed || 0), r1(u.vel.x), r1(u.vel.y), r1(u.vel.z), ap,
        r3(u.ctrl.throttle || 0), u.kills,
      ]);
    }
    const base = {
      t: 's', tm: r1(g.time), tk: [r1(g.tickets[0]), r1(g.tickets[1])],
      z: g.zones.map((z) => [r3(z.v), z.owner, z.inside ? z.inside[0] : 0, z.inside ? z.inside[1] : 0]),
      u: units, ev: this.outbox,
    };
    for (const [id, p] of this.peers) {
      if (!p.conn.open) continue;
      const h = g.humans.get(id);
      const u = h && h.unit;
      let me = null;
      if (u) {
        me = { id: u.id, br: u.barrageReady ? 1 : 0 };
        if (u.kind === 'plane') Object.assign(me, { heat: r3(u.heat), oh: u.overheated ? 1 : 0, a2: u.ammo2, re: r1(u.rearm) });
        else Object.assign(me, { tp: u.torps, tr: r1(u.torpRearm), rel: u.turrets.map((t) => r1(Math.max(0, t.reload))), st: u.throttleStep });
      }
      p.conn.send({ ...base, me, y: p.out.length ? p.out.splice(0) : undefined });
    }
    this.outbox = [];
  }

  close() {
    for (const p of this.peers.values()) { try { p.conn.send({ t: 'bye' }); p.conn.close(); } catch { /* egal */ } }
    this.peer.destroy();
  }
}

// ---------------------------------------------------------------- Client

export class NetClient {
  static async connect(code, { name, unlocks }) {
    const peer = await openPeer(null);
    return new Promise((resolve, reject) => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      const t = setTimeout(() => { peer.destroy(); reject({ type: 'timeout', message: 'Raum antwortet nicht' }); }, 8000);
      peer.once('error', (e) => { clearTimeout(t); peer.destroy(); reject(e); });
      conn.once('open', () => {
        clearTimeout(t);
        const c = new NetClient(peer, conn, code);
        conn.send({ t: 'hello', name, unlocks: [...unlocks] });
        resolve(c);
      });
    });
  }

  constructor(peer, conn, code) {
    this.peer = peer;
    this.conn = conn;
    this.code = code;
    this.id = peer.id;
    this.game = null;
    this.onLobby = null;
    this.onStart = null;
    this.onClose = null;
    this.onFull = null;
    this.lastInput = 0;
    conn.on('data', (m) => this.handle(m));
    conn.on('close', () => { if (this.onClose) this.onClose(); });
    peer.on('error', () => { if (this.onClose && !conn.open) this.onClose(); });
  }

  handle(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'lobby') { this.lastLobby = m; if (this.onLobby) this.onLobby(m); }
    else if (m.t === 'start' && this.onStart) this.onStart(m);
    else if (m.t === 's' && this.game) this.game.applySnapshot(m);
    else if (m.t === 'full' && this.onFull) this.onFull();
    else if (m.t === 'bye' && this.onClose) this.onClose();
  }

  send(m) { if (this.conn.open) this.conn.send(m); }

  sendInput(input, now) {
    if (now - this.lastInput < 1000 / 30) return;
    this.lastInput = now;
    this.send({ t: 'in', ...input });
  }

  setTeam(team) { this.send({ t: 'team', team }); }

  close() {
    try { this.conn.close(); } catch { /* egal */ }
    this.peer.destroy();
  }
}

// Zufälliges Gefecht: öffentliche Räume der Reihe nach probieren, sonst selbst einen eröffnen
export async function findRandom({ name, unlocks }) {
  for (let i = 1; i <= PUBLIC_SLOTS; i++) {
    const code = 'PUB' + i;
    try {
      return { client: await NetClient.connect(code, { name, unlocks }) };
    } catch (e) {
      if (e.type !== 'peer-unavailable' && e.type !== 'timeout') throw e;
      try {
        return { host: await NetHost.create(code, { name, isPublic: true }) };
      } catch (e2) {
        if (e2.type !== 'unavailable-id') throw e2;
      }
    }
  }
  throw { type: 'full', message: 'Alle öffentlichen Räume sind belegt' };
}

// ---------------------------------------------------------------- Spiegelbild beim Client

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();

export class ClientGame {
  constructor({ scene, world, effects, audio, settings, unlocks, hooks, net }) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.hooks = hooks;
    this.net = net;
    this.isClient = true;
    this.skill = 0.6;
    this.projectiles = new Projectiles(scene);
    this.units = [];
    this.byId = new Map();
    this.time = 0;
    this.duration = 15 * 60;
    this.tickets = [800, 800];
    this.maxTickets = 800;
    this.zones = [
      { name: 'A', x: -1600, z: 0, r: 330, v: 0, owner: -1, inside: [0, 0] },
      { name: 'B', x: 0, z: 0, r: 330, v: 0, owner: -1, inside: [0, 0] },
      { name: 'C', x: 1600, z: 0, r: 330, v: 0, owner: -1, inside: [0, 0] },
    ];
    this.over = false;
    this.winner = -1;
    this.me = null;
    this.player = null;
    this.stats = { kills: 0, deaths: 0, caps: 0, bestStreak: 0, damage: 0 };
    this.local = { unlocks, name: settings.name };
    this.myTeam = 0;
    this.lastSnap = 0;
    this.names = new Map();
  }

  get barrageReady() { return !!(this.me && this.me.br); }

  // Wird von Projectiles beim Client aufgerufen: keine Wirkung, nur Darstellung
  applyDamage() {}
  kill() {}
  blast(pos, size, splash, boom) {
    if (splash) this.effects.splash(pos, splash);
    this.effects.explosion(pos, size);
    this.audio.boom(boom ?? size, pos);
  }

  respawnPlayer(def) {
    this.net.send({ t: 'spawn', def });
    return null;
  }

  callBarrage(point) {
    if (!this.barrageReady) return false;
    this.net.send({ t: 'barrage', p: [point.x, point.y, point.z] });
    this.me.br = 0;
    return true;
  }

  applySnapshot(m) {
    const now = performance.now();
    this.lastSnap = now;
    this.time = m.tm;
    this.tickets = m.tk;
    m.z.forEach((z, i) => {
      const zone = this.zones[i];
      zone.v = z[0]; zone.owner = z[1]; zone.inside = [z[2], z[3]];
    });
    const seen = new Set();
    for (const a of m.u) {
      const [id, di, team, owner, name, x, y, z, qx, qy, qz, qw, hp, flags, speed, vx, vy, vz, ap, th, kills] = a;
      seen.add(id);
      let u = this.byId.get(id);
      const defId = DEF_IDS[di];
      if (!u || u.def.id !== defId) {
        if (u) this.removeUnit(u);
        u = createUnit(this, defId, team, name, owner === this.net.id);
        u.id = id;
        u.root.position.set(x, y, z);
        u.root.quaternion.set(qx, qy, qz, qw);
        u.target = new THREE.Vector3(x, y, z);
        u.targetQ = new THREE.Quaternion(qx, qy, qz, qw);
        u.snapAt = now;
        if (u.kind === 'ship') { u.ctrl.aimPoint = null; u.apVec = new THREE.Vector3(); }
        this.byId.set(id, u);
        this.units.push(u);
      }
      u.owner = owner;
      u.name = name;
      this.names.set(id, { name, team, def: u.def, kind: u.kind, isPlayer: owner === this.net.id });
      u.target.set(x, y, z);
      u.targetQ.set(qx, qy, qz, qw);
      u.vel.set(vx, vy, vz);
      u.snapAt = now;
      u.hp = hp;
      u.alive = !!(flags & 1);
      u.removed = !!(flags & 2);
      u.escort = !!(flags & 4);
      u.speed = speed;
      u.kills = kills;
      u.root.visible = !u.removed;
      // Eigene Einheit: Schub und Zielpunkt kommen aus der lokalen Steuerung
      if (owner !== this.net.id) {
        u.ctrl.throttle = th;
        if (u.kind === 'ship') u.ctrl.aimPoint = ap ? u.apVec.fromArray(ap) : null;
      }
    }
    for (const u of [...this.units]) if (!seen.has(u.id)) this.removeUnit(u);

    this.me = m.me;
    const mine = m.me && this.byId.get(m.me.id);
    this.player = mine || null;
    if (mine) {
      mine.isPlayer = true;
      const me = m.me;
      if (mine.kind === 'plane') { mine.heat = me.heat; mine.overheated = !!me.oh; mine.ammo2 = me.a2; mine.rearm = me.re; }
      else {
        mine.torps = me.tp; mine.torpRearm = me.tr; mine.throttleStep = mine.throttleStep ?? me.st;
        if (me.rel) mine.turrets.forEach((t, i) => { t.reload = me.rel[i] ?? 0; });
      }
    }

    for (const ev of m.ev) this.applyEvent(ev);
    if (m.y) for (const ev of m.y) this.applyPersonal(ev);
  }

  info(id) {
    if (!id) return null;
    return this.byId.get(id) || this.names.get(id) || null;
  }

  applyEvent(ev) {
    switch (ev[0]) {
      case 'p': {
        const [, ti, x, y, z, vx, vy, vz, team, size, life, flak, ownerId] = ev;
        const type = PTYPES[ti];
        const owner = this.byId.get(ownerId) || { team, id: ownerId };
        const pos = _v.set(x, y, z);
        const vel = new THREE.Vector3(vx, vy, vz);
        this.projectiles.fire(type, pos, vel, owner, { dmg: 0, splash: 0, life, size, flak: !!flak });
        const dir = vel.clone().normalize();
        if (type === 'bullet') {
          this.effects.muzzle(pos, dir, size);
          this.audio.shot(flak ? 'mg' : size > 1.2 ? 'cannon' : 'mg', pos, owner === this.player);
        } else if (type === 'shell' && owner.kind === 'ship') {
          this.effects.cannonBlast(pos, dir, size * 1.6);
          this.audio.shot(size < 0.5 ? 'cannon' : 'big', pos, owner === this.player);
        } else if (type === 'rocket') this.audio.shot('rocket', pos, owner === this.player);
        else if (type === 'bomb') this.audio.shot('drop', pos, owner === this.player);
        else if (type === 'torpedo') this.audio.shot('torp', pos, owner === this.player);
        break;
      }
      case 'x': {
        const [, x, y, z, size, splash, boom] = ev;
        this.blast(new THREE.Vector3(x, y, z), size, splash, boom);
        break;
      }
      case 'k': {
        const [, kId, vId, how] = ev;
        const v = this.info(vId);
        if (v) this.hooks.feed(this.info(kId), v, how);
        break;
      }
      case 'z': this.hooks.zone(this.zones[ev[1]], ev[2]); break;
    }
  }

  applyPersonal(ev) {
    const h = this.hooks;
    switch (ev[0]) {
      case 'hit': h.hit(!!ev[1]); break;
      case 'hurt': h.hurt(ev[1], ev[5] ? new THREE.Vector3(ev[2], ev[3], ev[4]) : null); break;
      case 'kill': { const v = this.info(ev[1]); if (v) h.kill(v, ev[2]); break; }
      case 'reward': h.reward(ev[1], ev[2]); break;
      case 'unlocked': ev[1].forEach((id) => this.local.unlocks.add(id)); h.unlocked(ev[1]); break;
      case 'died': h.playerDied(this.info(ev[1])); break;
      case 'end':
        this.over = true;
        this.winner = ev[1];
        if (ev[2]) this.stats = ev[2];
        h.end(ev[1]);
        break;
    }
  }

  removeUnit(u) {
    u.dispose();
    this.byId.delete(u.id);
    const i = this.units.indexOf(u);
    if (i >= 0) this.units.splice(i, 1);
    if (this.player === u) this.player = null;
  }

  update(dt) {
    const now = performance.now();
    const k = 1 - Math.exp(-dt * 14);
    for (const u of this.units) {
      if (u.removed) continue;
      const age = Math.min(0.3, (now - u.snapAt) / 1000);
      _v.copy(u.vel).multiplyScalar(age).add(u.target);
      // Große Sprünge (Wiedereinstieg) direkt übernehmen
      if (u.root.position.distanceToSquared(_v) > 400 * 400) u.root.position.copy(_v);
      else u.root.position.lerp(_v, k);
      u.root.quaternion.slerp(u.targetQ, k);
      u.pos.copy(u.root.position);
      u.fwd.set(0, 0, -1).applyQuaternion(u.root.quaternion);
      u.root.updateMatrixWorld(true);
      if (u.kind === 'ship') {
        u.heading = Math.atan2(-u.fwd.x, -u.fwd.z);
        u.inv.copy(u.root.matrixWorld).invert();
        const fire = u.ctrl.fire;
        u.ctrl.fire = false;
        u.updateTurrets(dt);
        u.ctrl.fire = fire;
      } else {
        u.bounds = Math.hypot(u.pos.x, u.pos.z) > 3500;
      }
      u.fx(dt);
    }
    this.projectiles.update(dt, this);
  }

  // Wird von Projectiles/AI-Code erwartet, beim Client ohne Bedeutung
  nearestEnemy() { return null; }
  nearestEnemyFrom() { return null; }
  recentAttacker() { return null; }

  dispose() {
    for (const u of this.units) u.dispose();
    this.units.length = 0;
    this.byId.clear();
    this.projectiles.clear();
    for (const m of [this.projectiles.tracers, this.projectiles.bombs, this.projectiles.torps]) this.scene.remove(m);
  }
}
