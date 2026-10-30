import * as THREE from 'three';
import { buildModel } from './models.js?v=11';
import { waveHeight, MAP_HALF } from './world.js?v=11';
import { clamp, angleDiff, elevationFor, rand } from './util.js?v=11';

const MG = (rate, mounts) => ({ name: 'MG 7,9 mm', rate, dmg: 10, speed: 950, spread: 0.005, range: 900, heat: 0.012, size: 1, mounts });
const CANNON = (name, rate, dmg, speed, size, mounts) => ({ name, rate, dmg, speed, spread: 0.004, range: 850, heat: 0.03, size, mounts });

// unlock: nötige Abschuss-Serie (0 = von Anfang an frei)
export const DEFS = {
  // ---------- Flugzeuge ----------
  sperber: {
    id: 'sperber', kind: 'plane', name: 'Sperber', klasse: 'Leichter Jäger', unlock: 0,
    desc: 'Das wendigste Flugzeug. Drei MGs, kaum Panzerung.',
    hp: 140, maxSpeed: 160, minSpeed: 46, thrust: 30, pitchRate: 2.0, rollRate: 4.3, yawRate: 0.55, hitR: 6,
    guns: [MG(26, [[1.8, -0.35, -1.6], [-1.8, -0.35, -1.6], [0, 0.55, -2.6]])],
    secondary: null,
    stats: { tempo: 0.88, panzer: 0.2, feuer: 0.35, wendig: 1 },
  },
  falke: {
    id: 'falke', kind: 'plane', name: 'Falke', klasse: 'Jäger', unlock: 0,
    desc: 'Leicht, schnell, dreht eng. Zwei MGs. Hält wenig aus.',
    hp: 170, maxSpeed: 168, minSpeed: 52, thrust: 31, pitchRate: 1.75, rollRate: 3.6, yawRate: 0.5, hitR: 6.5,
    guns: [MG(20, [[2.1, -0.45, -1.9], [-2.1, -0.45, -1.9]])],
    secondary: null,
    stats: { tempo: 0.95, panzer: 0.3, feuer: 0.4, wendig: 0.95 },
  },
  specht: {
    id: 'specht', kind: 'plane', name: 'Specht', klasse: 'Schlachtflugzeug', unlock: 3,
    desc: 'Gepanzerter Tiefflieger. Zwei Kanonen und acht Raketen gegen Schiffe.',
    hp: 310, maxSpeed: 145, minSpeed: 50, thrust: 25, pitchRate: 1.4, rollRate: 2.6, yawRate: 0.45, hitR: 7.5,
    guns: [CANNON('Kanone 20 mm', 8, 28, 820, 1.5, [[2.2, -0.5, -2.0], [-2.2, -0.5, -2.0]])],
    secondary: { type: 'rocket', name: 'Raketen', count: 8, rearm: 6, dmg: 300, splash: 14 },
    stats: { tempo: 0.75, panzer: 0.7, feuer: 0.8, wendig: 0.6 },
  },
  habicht: {
    id: 'habicht', kind: 'plane', name: 'Habicht', klasse: 'Zerstörerflugzeug', unlock: 3,
    desc: 'Zweimotorig. Zwei Kanonen in der Nase und sechs Raketen gegen Schiffe.',
    hp: 290, maxSpeed: 155, minSpeed: 58, thrust: 27, pitchRate: 1.3, rollRate: 2.4, yawRate: 0.4, hitR: 8,
    guns: [CANNON('Kanone 20 mm', 8, 30, 820, 1.6, [[0.45, -0.5, -5.6], [-0.45, -0.5, -5.6]])],
    secondary: { type: 'rocket', name: 'Raketen', count: 6, rearm: 7, dmg: 280, splash: 14 },
    stats: { tempo: 0.8, panzer: 0.55, feuer: 0.75, wendig: 0.6 },
  },
  uhu: {
    id: 'uhu', kind: 'plane', name: 'Uhu', klasse: 'Schwerer Jäger', unlock: 4,
    desc: 'Zwei 30-mm-Kanonen und zwei MGs. Wenige Treffer reichen.',
    hp: 340, maxSpeed: 160, minSpeed: 60, thrust: 29, pitchRate: 1.25, rollRate: 2.2, yawRate: 0.4, hitR: 8.5,
    guns: [
      CANNON('Kanone 30 mm', 5, 55, 700, 2, [[0.5, -0.6, -6.0], [-0.5, -0.6, -6.0]]),
      MG(16, [[0.3, 0.2, -6.2], [-0.3, 0.2, -6.2]]),
    ],
    secondary: null,
    stats: { tempo: 0.85, panzer: 0.65, feuer: 0.9, wendig: 0.5 },
  },
  moewe: {
    id: 'moewe', kind: 'plane', name: 'Möwe', klasse: 'Torpedoflugzeug', unlock: 4,
    desc: 'Wasserflugzeug mit Lufttorpedo. Tief anfliegen, abwerfen, abdrehen.',
    hp: 300, maxSpeed: 128, minSpeed: 44, thrust: 21, pitchRate: 1.15, rollRate: 1.9, yawRate: 0.42, hitR: 9,
    guns: [MG(14, [[2.6, -0.4, -1.6], [-2.6, -0.4, -1.6]])],
    secondary: { type: 'airtorp', name: 'Lufttorpedo', count: 1, rearm: 18, dmg: 1600, splash: 0 },
    tailGun: true,
    stats: { tempo: 0.55, panzer: 0.55, feuer: 0.9, wendig: 0.45 },
  },
  bussard: {
    id: 'bussard', kind: 'plane', name: 'Bussard', klasse: 'Sturzkampfbomber', unlock: 5,
    desc: 'Langsam, aber zwei schwere Bomben. Heckschütze schießt automatisch.',
    hp: 340, maxSpeed: 132, minSpeed: 48, thrust: 22, pitchRate: 1.15, rollRate: 2.0, yawRate: 0.4, hitR: 8.5,
    guns: [MG(14, [[2.4, -0.6, -1.8], [-2.4, -0.6, -1.8]])],
    secondary: { type: 'bomb', name: 'Bomben 500 kg', count: 2, rearm: 14, dmg: 1300, splash: 32 },
    tailGun: true,
    stats: { tempo: 0.6, panzer: 0.65, feuer: 0.95, wendig: 0.4 },
  },
  kondor: {
    id: 'kondor', kind: 'plane', name: 'Kondor', klasse: 'Schwerer Bomber', unlock: 6,
    desc: 'Vier Motoren, vier Bomben, zwei Bordschützen. Träge, aber zäh.',
    hp: 760, maxSpeed: 122, minSpeed: 50, thrust: 19, pitchRate: 0.8, rollRate: 1.15, yawRate: 0.3, hitR: 14,
    guns: [MG(12, [[0, -0.6, -8.6]])],
    secondary: { type: 'bomb', name: 'Bomben 500 kg', count: 4, rearm: 11, dmg: 1300, splash: 32 },
    tailGun: true,
    stats: { tempo: 0.5, panzer: 1, feuer: 1, wendig: 0.2 },
  },
  milan: {
    id: 'milan', kind: 'plane', name: 'Milan', klasse: 'Strahljäger', unlock: 7,
    desc: 'Düsenantrieb. Viel schneller als alles andere, dreht aber weit.',
    hp: 230, maxSpeed: 235, minSpeed: 80, thrust: 42, pitchRate: 1.45, rollRate: 2.9, yawRate: 0.35, hitR: 7.5,
    guns: [CANNON('Kanone 30 mm', 9, 42, 760, 1.8, [[0.35, -0.3, -5.2], [-0.35, -0.3, -5.2], [0.35, 0.2, -5.2], [-0.35, 0.2, -5.2]])],
    secondary: null,
    stats: { tempo: 1, panzer: 0.45, feuer: 0.95, wendig: 0.45 },
  },

  // ---------- Schiffe ----------
  schnellboot: {
    id: 'schnellboot', kind: 'ship', name: 'Schnellboot', klasse: 'Torpedoboot', unlock: 0,
    desc: 'Klein und schnell. Zwei Torpedos können einen Kreuzer versenken.',
    hp: 950, maxSpeed: 30, accel: 5, turn: 0.38, len: 32, beam: 5.6, top: 7, draft: 1.3, camDist: 48,
    torpedo: { count: 2, rearm: 22, dmg: 1500, speed: 40 },
    aa: [[0, 3, 5]],
    stats: { tempo: 1, panzer: 0.25, feuer: 0.55, wendig: 0.95 },
  },
  zerstoerer: {
    id: 'zerstoerer', kind: 'ship', name: 'Zerstörer', klasse: 'Zerstörer', unlock: 3,
    desc: 'Vier 12-cm-Geschütze, Torpedos und Flak. Der Allrounder.',
    hp: 2700, maxSpeed: 21, accel: 2.6, turn: 0.17, len: 100, beam: 10.5, top: 14, draft: 3.2, camDist: 120,
    torpedo: { count: 3, rearm: 35, dmg: 1500, speed: 36 },
    aa: [[4.2, 4.4, 4], [-4.2, 4.4, 4]],
    stats: { tempo: 0.7, panzer: 0.55, feuer: 0.7, wendig: 0.6 },
  },
  kreuzer: {
    id: 'kreuzer', kind: 'ship', name: 'Kreuzer', klasse: 'Schwerer Kreuzer', unlock: 5,
    desc: 'Zwölf 20,3-cm-Rohre und viel Panzerung. Dreht langsam.',
    hp: 5400, maxSpeed: 17, accel: 1.6, turn: 0.1, len: 160, beam: 17, top: 22, draft: 5.5, camDist: 190,
    torpedo: null,
    aa: [[7, 7, -2], [-7, 7, -2], [7, 7, 8], [-7, 7, 8]],
    stats: { tempo: 0.5, panzer: 1, feuer: 1, wendig: 0.3 },
  },

  // ---------- Panzer ----------
  dachs: {
    id: 'dachs', kind: 'tank', name: 'Dachs', klasse: 'Leichter Panzer', unlock: 0,
    desc: 'Schnell und wendig. Die 5-cm-Kanone lädt zügig nach.',
    hp: 620, maxSpeed: 16, accel: 7, turn: 1.25, traverse: 1.4, len: 6.2, beam: 3.0, top: 2.6, draft: 0, camDist: 15, armor: 0.9,
    gun: { name: '5-cm-Kanone', dmg: 140, speed: 830, reload: 2.2, size: 0.35, range: 900 },
    stats: { tempo: 1, panzer: 0.35, feuer: 0.45, wendig: 1 },
  },
  keiler: {
    id: 'keiler', kind: 'tank', name: 'Keiler', klasse: 'Mittlerer Panzer', unlock: 3,
    desc: 'Schräge Panzerung und eine 7,5-cm-Kanone. Gutes Mittelmaß.',
    hp: 950, maxSpeed: 13, accel: 5, turn: 0.95, traverse: 1.0, len: 7.0, beam: 3.3, top: 2.8, draft: 0, camDist: 17, armor: 0.7,
    gun: { name: '7,5-cm-Kanone', dmg: 230, speed: 820, reload: 3.4, size: 0.45, range: 1000 },
    stats: { tempo: 0.75, panzer: 0.65, feuer: 0.7, wendig: 0.7 },
  },
  wisent: {
    id: 'wisent', kind: 'tank', name: 'Wisent', klasse: 'Schwerer Panzer', unlock: 5,
    desc: 'Dicke Panzerung, 8,8-cm-Kanone. Langsam, Turm dreht träge.',
    hp: 1450, maxSpeed: 9.5, accel: 3, turn: 0.6, traverse: 0.6, len: 8.0, beam: 3.7, top: 3.1, draft: 0, camDist: 19, armor: 0.5,
    gun: { name: '8,8-cm-Kanone', dmg: 360, speed: 880, reload: 5.4, size: 0.55, range: 1200 },
    stats: { tempo: 0.45, panzer: 1, feuer: 1, wendig: 0.4 },
  },
};

export const CALIBERS = {
  '40': { name: '4-cm-Kanone', dmg: 55, speed: 760, reload: 0.55, range: 1900, size: 0.35, traverse: 1.6, splash: 0, spread: 0.004 },
  '120': { name: '12-cm-Geschütz', dmg: 190, speed: 620, reload: 3.6, range: 3400, size: 0.6, traverse: 0.55, splash: 8, spread: 0.003 },
  '203': { name: '20,3-cm-Geschütz', dmg: 430, speed: 680, reload: 7.5, range: 4600, size: 0.9, traverse: 0.32, splash: 12, spread: 0.0025 },
};

export const PLANES = Object.keys(DEFS).filter((id) => DEFS[id].kind === 'plane');
export const SHIPS = Object.keys(DEFS).filter((id) => DEFS[id].kind === 'ship');
export const TANKS = Object.keys(DEFS).filter((id) => DEFS[id].kind === 'tank');
export const START_UNLOCKS = Object.keys(DEFS).filter((id) => DEFS[id].unlock === 0);

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _dq = new THREE.Quaternion();

let nextId = 1;

class Unit {
  constructor(game, def, team, name, isPlayer) {
    this.id = nextId++;
    this.game = game;
    this.def = def;
    this.kind = def.kind;
    this.team = team;
    this.name = name;
    this.isPlayer = isPlayer;
    this.hp = def.hp;
    this.alive = true;
    this.removed = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.root = new THREE.Group();
    this.lastAttacker = null;
    this.lastHit = -99;
    this.deathTime = 0;
    this.burnAcc = 0;
    this.kills = 0;
    this.streak = 0;
    this.ai = null;
    game.scene.add(this.root);
  }

  get hpFrac() { return this.hp / this.def.hp; }

  dispose() {
    this.game.scene.remove(this.root);
  }
}

export class Plane extends Unit {
  constructor(game, def, team, name, isPlayer) {
    super(game, def, team, name, isPlayer);
    const model = buildModel(def.id, team);
    this.root.add(model.mesh);
    this.props = model.props;
    this.speed = 0;
    this.sink = 0;
    this.ctrl = { pitch: 0, roll: 0, yaw: 0, throttle: 1, fire: false, fire2: false };
    this.heat = 0;
    this.overheated = false;
    this.gunCd = def.guns.map(() => 0);
    this.gunIdx = 0;
    this.ammo2 = def.secondary ? def.secondary.count : 0;
    this.rearm = 0;
    this.fire2Cd = 0;
    this.tailCd = 0;
    this.spin = 0;
    this.bounds = false;
  }

  spawn(pos, heading) {
    this.pos.copy(pos);
    this.root.position.copy(pos);
    this.root.quaternion.setFromEuler(new THREE.Euler(0, heading, 0, 'YXZ'));
    this.speed = this.def.maxSpeed * 0.8;
    this.updateFwd();
    this.vel.copy(this.fwd).multiplyScalar(this.speed);
  }

  updateFwd() {
    this.fwd.set(0, 0, -1).applyQuaternion(this.root.quaternion);
  }

  // Steuert das Flugzeug in Richtung dir (Weltkoordinaten). Wird von Spieler (Mausziel) und KI genutzt.
  steer(dir) {
    const q = this.root.quaternion;
    _q.copy(q).invert();
    const l = _v.copy(dir).normalize().applyQuaternion(_q);
    const ahead = -l.z;
    const off = Math.acos(clamp(ahead, -1, 1));
    const right = _v2.copy(X).applyQuaternion(q);
    const up = _v3.copy(Y).applyQuaternion(q);
    const levelErr = Math.atan2(right.y, up.y);
    let rollErr = Math.atan2(l.x, l.y);
    const push = l.y < 0 && off < 0.3;
    if (push) rollErr = angleDiff(0, rollErr - Math.PI);
    const w = clamp((off - 0.03) / 0.22, 0, 1);
    const roll = clamp((w * rollErr + (1 - w) * levelErr) * 2.6, -1, 1);
    let pitch = clamp(Math.atan2(l.y, Math.max(ahead, 0.04)) * 4.5, -1, 1);
    if (w > 0.5) pitch *= clamp(1.3 - Math.abs(rollErr) / 1.2, 0.15, 1);
    if (!push && pitch < 0) pitch *= 0.5;
    const yaw = clamp(Math.atan2(l.x, Math.max(ahead, 0.1)) * 3.5, -1, 1) * (1 - w * 0.8);
    this.ctrl.pitch = pitch; this.ctrl.roll = roll; this.ctrl.yaw = yaw;
  }

  update(dt) {
    const def = this.def, q = this.root.quaternion, game = this.game, c = this.ctrl;
    if (!this.alive) {
      c.pitch = -0.25; c.roll = 0; c.yaw = 0; c.throttle = 0; c.fire = c.fire2 = false;
      this.spin += dt * 1.5;
      _dq.setFromAxisAngle(Z, -this.spin * dt * 2.5);
      q.multiply(_dq);
    }

    const eff = clamp((this.speed - 25) / (def.minSpeed + 15), 0.25, 1);
    _dq.setFromAxisAngle(X, c.pitch * def.pitchRate * eff * dt); q.multiply(_dq);
    _dq.setFromAxisAngle(Z, -c.roll * def.rollRate * eff * dt); q.multiply(_dq);
    _dq.setFromAxisAngle(Y, -c.yaw * def.yawRate * eff * dt); q.multiply(_dq);

    this.updateFwd();
    const fwd = this.fwd;
    const altFactor = this.pos.y > 2600 ? 0.6 : 1;
    const thrust = def.thrust * c.throttle * altFactor;
    const drag = def.thrust * (this.speed / def.maxSpeed) ** 2;
    this.speed += (thrust - drag - 9.81 * fwd.y - Math.abs(c.pitch) * eff * 5) * dt;
    this.speed = Math.max(this.speed, 18);

    if (this.speed < def.minSpeed) {
      const s = 1 - this.speed / def.minSpeed;
      this.sink = Math.min(this.sink + 9.81 * s * 2 * dt, 45);
      // Nase sackt durch
      _v.set(0, -1, 0).cross(fwd);
      if (_v.lengthSq() > 1e-4) {
        _dq.setFromAxisAngle(_v.normalize(), -s * 1.2 * dt);
        q.premultiply(_dq);
      }
    } else {
      this.sink = Math.max(0, this.sink - 20 * dt);
    }

    this.vel.copy(fwd).multiplyScalar(this.speed);
    this.vel.y -= this.sink;
    this.pos.addScaledVector(this.vel, dt);
    this.root.position.copy(this.pos);
    q.normalize();
    this.root.updateMatrixWorld(true);

    const r = Math.hypot(this.pos.x, this.pos.z);
    this.bounds = r > MAP_HALF - 300;
    // Außerhalb des Gebiets nimmt das Flugzeug Schaden
    if (this.alive && r > MAP_HALF + 400) game.applyDamage(this, def.hp * 0.08 * dt, null);

    if (this.alive) this.weapons(dt);

    // Boden / Wasser
    const ground = game.world.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < ground + 1.5) {
      if (this.alive) game.kill(this, game.recentAttacker(this), 'crash');
      game.blast(this.pos, 2.2, ground <= 0.5 ? 3.5 : 0, 1.5);
      this.removed = true;
      this.root.visible = false;
      return;
    }
    this.fx(dt);
  }

  // Nur Darstellung: Propeller, Brand, Rauch. Läuft auch auf Clients im Mehrspieler.
  fx(dt) {
    const game = this.game, fwd = this.fwd;
    for (const p of this.props) p.rotation.z += dt * (20 + 40 * (this.alive ? this.ctrl.throttle : 0.2));
    const f = this.hpFrac;
    if (!this.alive || f < 0.5) {
      this.burnAcc += dt * (this.alive ? (f < 0.25 ? 30 : 14) : 40);
      while (this.burnAcc > 1) {
        this.burnAcc -= 1;
        _v.copy(fwd).multiplyScalar(-3).add(this.pos);
        if (!this.alive || f < 0.25) game.effects.burn(_v, 1.6, null);
        else game.effects.trail(_v, true, 1.2);
      }
    }
  }

  weapons(dt) {
    const def = this.def, game = this.game, c = this.ctrl;
    this.heat = Math.max(0, this.heat - dt * 0.22);
    if (this.overheated && this.heat < 0.35) this.overheated = false;
    for (let g = 0; g < def.guns.length; g++) {
      const gun = def.guns[g];
      this.gunCd[g] -= dt;
      if (c.fire && !this.overheated && this.gunCd[g] <= 0) {
        this.gunCd[g] = 1 / gun.rate;
        const m = gun.mounts[this.gunIdx++ % gun.mounts.length];
        const mp = _v.set(m[0], m[1], m[2]).applyMatrix4(this.root.matrixWorld);
        const dir = _v2.copy(this.fwd);
        dir.x += rand(-gun.spread, gun.spread); dir.y += rand(-gun.spread, gun.spread); dir.z += rand(-gun.spread, gun.spread);
        dir.normalize();
        game.projectiles.fire('bullet', mp, _v3.copy(dir).multiplyScalar(gun.speed).add(this.vel), this,
          { dmg: gun.dmg, life: gun.range / gun.speed, size: gun.size });
        game.effects.muzzle(mp, dir, gun.size);
        game.audio.shot(gun.size > 1.2 ? 'cannon' : 'mg', mp, this.isPlayer);
        this.heat += gun.heat;
        if (this.heat >= 1) { this.heat = 1; this.overheated = true; }
      }
    }

    const sec = def.secondary;
    if (sec) {
      this.fire2Cd -= dt;
      if (this.ammo2 < sec.count) {
        this.rearm += dt;
        if (this.rearm >= sec.rearm) { this.rearm = 0; this.ammo2++; }
      }
      if (c.fire2 && this.fire2Cd <= 0 && this.ammo2 > 0) {
        this.ammo2--;
        if (sec.type === 'bomb' || sec.type === 'airtorp') {
          this.fire2Cd = 0.6;
          const p = _v.set(0, -1.6, -0.4).applyMatrix4(this.root.matrixWorld);
          game.projectiles.fire('bomb', p, this.vel, this, { dmg: sec.dmg, splash: sec.splash, life: 30, size: 1, torp: sec.type === 'airtorp' });
          game.audio.shot('drop', p, this.isPlayer);
        } else {
          this.fire2Cd = 0.25;
          const side = this.ammo2 % 2 ? 1 : -1;
          const p = _v.set(side * 4.5, -0.8, -1.5).applyMatrix4(this.root.matrixWorld);
          const v = _v2.copy(this.fwd).multiplyScalar(this.speed + 300);
          game.projectiles.fire('rocket', p, v, this, { dmg: sec.dmg, splash: sec.splash, life: 4, size: 1 });
          game.audio.shot('rocket', p, this.isPlayer);
        }
      }
    }

    if (def.tailGun) {
      this.tailCd -= dt;
      if (this.tailCd <= 0) {
        this.tailCd = 0.15;
        const t = game.nearestEnemy(this, 'plane', 550, (u) => _v.subVectors(u.pos, this.pos).normalize().dot(this.fwd) < 0.1);
        if (t) {
          const from = _v.set(0, 1.25, 2.4).applyMatrix4(this.root.matrixWorld);
          const dist = from.distanceTo(t.pos);
          const aim = _v2.copy(t.vel).multiplyScalar(dist / 900).add(t.pos).sub(from).normalize();
          aim.x += rand(-0.03, 0.03); aim.y += rand(-0.03, 0.03); aim.z += rand(-0.03, 0.03);
          game.projectiles.fire('bullet', from, aim.normalize().multiplyScalar(900).add(this.vel), this, { dmg: 7, life: 0.7, size: 0.9 });
          game.audio.shot('mg', from, false);
        }
      }
    }
  }
}

export class Ship extends Unit {
  constructor(game, def, team, name, isPlayer) {
    super(game, def, team, name, isPlayer);
    const model = buildModel(def.id, team);
    this.root.add(model.mesh);
    this.root.rotation.order = 'YXZ';
    this.turrets = model.turrets;
    this.cal = CALIBERS[this.turrets[0].cal];
    this.heading = 0;
    this.speed = 0;
    this.ctrl = { throttle: 0, rudder: 0, aimPoint: null, fire: false, torp: false };
    this.torps = def.torpedo ? def.torpedo.count : 0;
    this.torpRearm = 0;
    this.torpCd = 0;
    this.aaCd = def.aa.map(() => Math.random());
    this.sinkT = 0;
    this.wakeAcc = 0;
    this.half = new THREE.Vector3(def.beam / 2, (def.top + def.draft) / 2, def.len / 2);
    this.boxCenterY = (def.top - def.draft) / 2;
    this.inv = new THREE.Matrix4();
    this.bounds = false;
  }

  spawn(pos, heading) {
    this.pos.set(pos.x, 0, pos.z);
    this.heading = heading;
    this.speed = this.def.maxSpeed * 0.5;
    this.ctrl.throttle = 0.5;
    this.place(0);
  }

  place(t) {
    const def = this.def;
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    this.fwd.set(fx, 0, fz);
    const s = 18 / (def.len + 10);
    const h = waveHeight(this.pos.x, this.pos.z, t);
    const hb = waveHeight(this.pos.x + fx * def.len * 0.4, this.pos.z + fz * def.len * 0.4, t);
    const hs = waveHeight(this.pos.x - fx * def.len * 0.4, this.pos.z - fz * def.len * 0.4, t);
    const hr = waveHeight(this.pos.x - fz * def.beam, this.pos.z + fx * def.beam, t);
    const pitch = Math.atan2(hb - hs, def.len * 0.8) * 0.6;
    const roll = (hr - h) * s * 0.12 + this.ctrl.rudder * (this.speed / def.maxSpeed) * 0.05;
    this.pos.y = h * Math.min(1, s * 2) * 0.7;
    if (!this.alive) {
      this.pos.y -= this.sinkT * this.sinkT * 0.12;
    }
    this.root.position.copy(this.pos);
    this.root.rotation.set(pitch + (this.alive ? 0 : this.sinkT * 0.012), this.heading, roll + (this.alive ? 0 : this.sinkT * 0.035));
    this.root.updateMatrixWorld(true);
    this.inv.copy(this.root.matrixWorld).invert();
    this.vel.copy(this.fwd).multiplyScalar(this.speed);
  }

  update(dt) {
    const def = this.def, c = this.ctrl, game = this.game;
    if (this.alive) {
      const target = clamp(c.throttle, -0.25, 1) * def.maxSpeed;
      const a = def.accel * dt;
      this.speed += clamp(target - this.speed, -a * 1.4, a);
      const steer = clamp(Math.abs(this.speed) / (def.maxSpeed * 0.25), 0, 1) * Math.sign(this.speed || 1);
      this.heading -= c.rudder * def.turn * steer * dt;
    } else {
      this.sinkT += dt;
      this.speed *= 1 - dt * 0.4;
      if (this.sinkT > 14) { this.removed = true; this.root.visible = false; return; }
    }

    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;

    // Inseln: Bug und Heck prüfen
    const w = game.world;
    for (const k of [0.5, 0.25, -0.45]) {
      const bx = this.pos.x + fx * def.len * k, bz = this.pos.z + fz * def.len * k;
      if (w.heightAt(bx, bz) > -def.draft) {
        this.pos.x -= fx * this.speed * dt * 1.6;
        this.pos.z -= fz * this.speed * dt * 1.6;
        if (Math.abs(this.speed) > 4 && this.alive) game.applyDamage(this, Math.abs(this.speed) * dt * 8, null);
        this.speed *= 0.6;
        break;
      }
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    this.bounds = r > MAP_HALF - 400;
    if (r > MAP_HALF) { this.pos.x *= MAP_HALF / r; this.pos.z *= MAP_HALF / r; }

    this.place(game.world.time);

    if (this.alive) {
      this.updateTurrets(dt);
      this.updateAA(dt);
      this.updateTorpedoes(dt);
    }
    this.fx(dt);
  }

  // Nur Darstellung: Kielwasser und Brand. Läuft auch auf Clients im Mehrspieler.
  fx(dt) {
    const def = this.def, game = this.game;
    const fx = this.fwd.x, fz = this.fwd.z;
    const sp = Math.abs(this.speed);
    this.wakeAcc += dt * sp * 0.35 * game.effects.density;
    while (this.wakeAcc > 1) {
      this.wakeAcc -= 1;
      const k = Math.random() > 0.5 ? 0.5 : -0.5;
      _v.set(this.pos.x + fx * def.len * k, 0, this.pos.z + fz * def.len * k);
      game.effects.wake(_v, def.beam * 0.35);
    }

    const f = this.hpFrac;
    if (!this.alive || f < 0.5) {
      this.burnAcc += dt * (this.alive ? (f < 0.25 ? 12 : 5) : 18);
      while (this.burnAcc > 1) {
        this.burnAcc -= 1;
        _v.set(rand(-0.3, 0.3) * def.beam, def.top * 0.4, rand(-0.35, 0.35) * def.len).applyMatrix4(this.root.matrixWorld);
        game.effects.burn(_v, 1.5 + def.beam * 0.18, this.vel);
      }
    }
  }

  turretWorld(t, out) {
    return t.pitchObj.getWorldPosition(out);
  }

  updateTurrets(dt) {
    const c = this.ctrl, game = this.game;
    const cal = this.cal;
    for (const t of this.turrets) {
      t.reload -= dt;
      let wantYaw = t.yaw, wantPitch = 0, inArc = false, inRange = false;
      if (c.aimPoint) {
        const wp = this.turretWorld(t, _v);
        const dx = c.aimPoint.x - wp.x, dz = c.aimPoint.z - wp.z;
        const dist = Math.hypot(dx, dz);
        const worldYaw = Math.atan2(-dx, -dz);
        let rel = angleDiff(0, worldYaw - this.heading);
        const fromRest = angleDiff(t.rest, rel);
        inArc = Math.abs(fromRest) <= t.arc;
        if (!inArc) rel = t.rest + Math.sign(fromRest) * t.arc;
        wantYaw = rel;
        const e = elevationFor(dist, c.aimPoint.y - wp.y, cal.speed);
        inRange = e !== null && dist <= cal.range;
        wantPitch = e === null ? 0.5 : clamp(e, -0.05, 0.6);
      } else {
        wantYaw = t.rest;
      }
      const step = cal.traverse * dt;
      const dy = angleDiff(t.yaw, wantYaw);
      // Nicht durch den Totwinkel hinter dem Turm drehen
      const nextYaw = t.yaw + clamp(dy, -step, step);
      if (Math.abs(angleDiff(t.rest, nextYaw)) <= t.arc + 0.01) t.yaw = nextYaw;
      else t.yaw = t.yaw - clamp(dy, -step, step);
      t.pitch += clamp(wantPitch - t.pitch, -step * 1.5, step * 1.5);
      t.yawObj.rotation.y = t.yaw;
      t.pitchObj.rotation.x = t.pitch;
      const aligned = Math.abs(angleDiff(t.yaw, wantYaw)) < 0.015 && Math.abs(wantPitch - t.pitch) < 0.01;
      t.ready = t.reload <= 0 && aligned && inArc && inRange;
      if (c.fire && t.ready) this.fireTurret(t);
    }
  }

  fireTurret(t) {
    const game = this.game, cal = this.cal;
    t.reload = cal.reload * (this.isPlayer ? 1 : rand(1, 1.25));
    const yawW = this.heading + t.yaw;
    t.pitchObj.updateMatrixWorld(true);
    for (let i = 0; i < t.barrels; i++) {
      const x = (i - (t.barrels - 1) / 2) * t.spacing;
      const muzzle = _v.set(x, 0, -t.barrelLen).applyMatrix4(t.pitchObj.matrixWorld);
      const ce = Math.cos(t.pitch);
      const dir = _v2.set(-Math.sin(yawW) * ce, Math.sin(t.pitch), -Math.cos(yawW) * ce);
      const sp = cal.spread * (this.isPlayer ? 1 : 1.4);
      dir.x += rand(-sp, sp); dir.y += rand(-sp, sp) * 0.6; dir.z += rand(-sp, sp);
      dir.normalize();
      game.projectiles.fire('shell', muzzle, _v3.copy(dir).multiplyScalar(cal.speed), this,
        { dmg: cal.dmg, splash: cal.splash, life: 14, size: cal.size });
      game.effects.cannonBlast(muzzle, dir, cal.size * 1.6);
    }
    game.audio.shot(this.turrets[0].cal === '40' ? 'cannon' : 'big', this.pos, this.isPlayer);
    if (this.isPlayer && game.hooks.recoil) game.hooks.recoil(cal.size);
  }

  updateAA(dt) {
    const game = this.game;
    const skill = this.isPlayer ? 0.7 : game.skill;
    for (let i = 0; i < this.def.aa.length; i++) {
      this.aaCd[i] -= dt;
      if (this.aaCd[i] > 0) continue;
      this.aaCd[i] = 0.14;
      const from = _v.fromArray(this.def.aa[i]).applyMatrix4(this.root.matrixWorld);
      const t = game.nearestEnemyFrom(from, this.team, 'plane', 1100);
      if (!t) { this.aaCd[i] = 0.5; continue; }
      const dist = from.distanceTo(t.pos);
      const aim = _v2.copy(t.vel).multiplyScalar(dist / 800).add(t.pos).sub(from).normalize();
      const err = 0.035 * (1.4 - skill);
      aim.x += rand(-err, err); aim.y += rand(-err, err); aim.z += rand(-err, err);
      game.projectiles.fire('bullet', from, aim.normalize().multiplyScalar(800), this, { dmg: 9, life: 1.4, size: 1.2, flak: true });
      game.audio.shot('mg', from, false);
    }
  }

  updateTorpedoes(dt) {
    const def = this.def, c = this.ctrl, game = this.game;
    if (!def.torpedo) return;
    this.torpCd -= dt;
    if (this.torps < def.torpedo.count) {
      this.torpRearm += dt;
      if (this.torpRearm >= def.torpedo.rearm) { this.torpRearm = 0; this.torps++; }
    }
    if (c.torp && this.torps > 0 && this.torpCd <= 0 && c.aimPoint) {
      c.torp = false;
      this.torpCd = 1.2;
      const n = this.torps;
      const dx = c.aimPoint.x - this.pos.x, dz = c.aimPoint.z - this.pos.z;
      const base = Math.atan2(-dx, -dz);
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.05;
        const dir = _v2.set(-Math.sin(a), 0, -Math.cos(a));
        const side = Math.sign(dir.x * -this.fwd.z + dir.z * this.fwd.x) || 1;
        const start = _v.set(this.pos.x - this.fwd.z * side * def.beam * 0.6, -1.2, this.pos.z + this.fwd.x * side * def.beam * 0.6);
        game.projectiles.fire('torpedo', start, _v3.copy(dir).multiplyScalar(def.torpedo.speed), this, { dmg: def.torpedo.dmg, life: 2400 / def.torpedo.speed, size: 1 });
      }
      this.torps = 0;
      game.audio.shot('torp', this.pos, this.isPlayer);
    }
    c.torp = false;
  }
}

export class Tank extends Unit {
  constructor(game, def, team, name, isPlayer) {
    super(game, def, team, name, isPlayer);
    const model = buildModel(def.id, team);
    this.root.add(model.mesh);
    this.root.rotation.order = 'YXZ';
    this.turrets = model.turrets;
    this.turret = this.turrets[0];
    this.cal = { ...def.gun, traverse: def.traverse };
    this.heading = 0;
    this.speed = 0;
    this.ctrl = { throttle: 0, steer: 0, aimPoint: null, fire: false };
    this.half = new THREE.Vector3(def.beam / 2, def.top / 2, def.len / 2);
    this.boxCenterY = def.top / 2;
    this.inv = new THREE.Matrix4();
    this.dustAcc = 0;
    this.deadT = 0;
    this.bounds = false;
  }

  spawn(pos, heading) {
    this.pos.set(pos.x, 0, pos.z);
    this.heading = heading;
    this.speed = 0;
    this.turret.yaw = 0;
    this.place();
  }

  place() {
    this.fwd.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    // leichtes Nicken beim Anfahren/Bremsen
    const pitch = clamp(-(this.ctrl.throttle * this.def.maxSpeed - this.speed) * 0.004, -0.04, 0.04);
    this.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.root.rotation.set(this.alive ? pitch : 0.05, this.heading, this.alive ? 0 : 0.06);
    this.root.updateMatrixWorld(true);
    this.inv.copy(this.root.matrixWorld).invert();
    this.vel.copy(this.fwd).multiplyScalar(this.speed);
  }

  blocked(x, z) {
    const def = this.def, w = this.game.world;
    const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading);
    const rx = -fz, rz = fx;
    for (const [a, b] of [[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5], [0.5, 0]]) {
      const px = x + fx * def.len * a + rx * def.beam * b, pz = z + fz * def.len * a + rz * def.beam * b;
      if (w.heightAt(px, pz) > 0.6 || Math.abs(px) > w.half || Math.abs(pz) > w.half) return true;
    }
    return false;
  }

  update(dt) {
    const def = this.def, c = this.ctrl, game = this.game;
    if (this.alive) {
      const target = clamp(c.throttle, -0.5, 1) * def.maxSpeed;
      const a = def.accel * dt;
      this.speed += clamp(target - this.speed, -a * 1.6, a);
      // Ketten: dreht auch im Stand, rückwärts wird die Lenkung gespiegelt
      this.heading -= c.steer * def.turn * dt * (this.speed < -0.5 ? -1 : 1) * (1 - Math.min(Math.abs(this.speed) / def.maxSpeed, 1) * 0.35);
      const nx = this.pos.x + -Math.sin(this.heading) * this.speed * dt;
      const nz = this.pos.z + -Math.cos(this.heading) * this.speed * dt;
      if (!this.blocked(nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
      else if (!this.blocked(nx, this.pos.z)) { this.pos.x = nx; this.speed *= 0.9; }
      else if (!this.blocked(this.pos.x, nz)) { this.pos.z = nz; this.speed *= 0.9; }
      else this.speed *= -0.15;
      // Panzer schieben sich gegenseitig
      for (const o of game.units) {
        if (o === this || o.kind !== 'tank' || o.removed) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz), min = (def.len + o.def.len) * 0.42;
        if (d > 0.01 && d < min) {
          const push = (min - d) * 0.5;
          const px = this.pos.x + dx / d * push, pz = this.pos.z + dz / d * push;
          if (!this.blocked(px, pz)) { this.pos.x = px; this.pos.z = pz; }
        }
      }
      this.bounds = Math.max(Math.abs(this.pos.x), Math.abs(this.pos.z)) > game.world.half - 60;
    } else {
      this.deadT += dt;
      this.speed *= 1 - dt * 3;
      if (this.deadT > 15) { this.removed = true; this.root.visible = false; return; }
    }
    this.place();
    if (this.alive) this.updateTurret(dt);
    this.fx(dt);
  }

  updateTurret(dt) {
    const t = this.turret, c = this.ctrl, cal = this.cal;
    t.reload -= dt;
    let wantYaw = t.yaw, wantPitch = 0, inRange = false;
    if (c.aimPoint) {
      const wp = t.pitchObj.getWorldPosition(_v);
      const dx = c.aimPoint.x - wp.x, dz = c.aimPoint.z - wp.z;
      const dist = Math.hypot(dx, dz);
      wantYaw = angleDiff(0, Math.atan2(-dx, -dz) - this.heading);
      const e = elevationFor(dist, c.aimPoint.y - wp.y, cal.speed);
      inRange = e !== null && dist <= cal.range * 1.3;
      wantPitch = e === null ? 0.3 : clamp(e, -0.15, 0.35);
    }
    const step = cal.traverse * dt;
    t.yaw += clamp(angleDiff(t.yaw, wantYaw), -step, step);
    t.pitch += clamp(wantPitch - t.pitch, -step, step);
    t.yawObj.rotation.y = t.yaw;
    t.pitchObj.rotation.x = t.pitch;
    t.ready = t.reload <= 0 && Math.abs(angleDiff(t.yaw, wantYaw)) < 0.02 && Math.abs(wantPitch - t.pitch) < 0.015 && inRange;
    if (c.fire && t.reload <= 0 && Math.abs(angleDiff(t.yaw, wantYaw)) < 0.05) this.fireGun();
  }

  fireGun() {
    const t = this.turret, cal = this.cal, game = this.game;
    t.reload = cal.reload * (this.isPlayer || this.remote ? 1 : rand(1, 1.3));
    t.pitchObj.updateMatrixWorld(true);
    const muzzle = _v.set(0, 0, -t.barrelLen).applyMatrix4(t.pitchObj.matrixWorld);
    const yawW = this.heading + t.yaw, ce = Math.cos(t.pitch);
    const dir = _v2.set(-Math.sin(yawW) * ce, Math.sin(t.pitch), -Math.cos(yawW) * ce);
    const sp = this.isPlayer || this.remote ? 0.0015 : 0.004;
    dir.x += rand(-sp, sp); dir.y += rand(-sp, sp); dir.z += rand(-sp, sp);
    dir.normalize();
    game.projectiles.fire('shell', muzzle, _v3.copy(dir).multiplyScalar(cal.speed), this, { dmg: cal.dmg, splash: 4, life: 3, size: cal.size });
    game.effects.cannonBlast(muzzle, dir, cal.size * 2.2);
    game.audio.shot(cal.size > 0.5 ? 'big' : 'cannon', muzzle, this.isPlayer);
    if (this.isPlayer && game.hooks.recoil) game.hooks.recoil(cal.size * 0.8);
  }

  fx(dt) {
    const def = this.def, game = this.game;
    const sp = Math.abs(this.speed);
    this.dustAcc += dt * sp * 0.6 * game.effects.density;
    while (this.dustAcc > 1) {
      this.dustAcc -= 1;
      const side = Math.random() > 0.5 ? 1 : -1;
      _v.set(side * def.beam * 0.4, 0.3, def.len * 0.45).applyMatrix4(this.root.matrixWorld);
      game.effects.dust(_v, 0.8);
    }
    const f = this.hpFrac;
    if (!this.alive || f < 0.5) {
      this.burnAcc += dt * (this.alive ? (f < 0.25 ? 10 : 4) : 12);
      while (this.burnAcc > 1) {
        this.burnAcc -= 1;
        _v.set(rand(-0.3, 0.3) * def.beam, def.top, rand(-0.3, 0.3) * def.len).applyMatrix4(this.root.matrixWorld);
        game.effects.burn(_v, 0.8, null);
      }
    }
  }
}

export function createUnit(game, defId, team, name, isPlayer) {
  const def = DEFS[defId];
  if (def.kind === 'plane') return new Plane(game, def, team, name, isPlayer);
  if (def.kind === 'tank') return new Tank(game, def, team, name, isPlayer);
  return new Ship(game, def, team, name, isPlayer);
}
