import * as THREE from 'three';
import { createUnit, PLANES, SHIPS, TANKS, DEFS } from './vehicles.js?v=11';
import { PlaneAI, ShipAI, TankAI } from './ai.js?v=11';
import { CITY_ZONES } from './city.js?v=11';
import { Projectiles } from './weapons.js?v=11';
import { rand, pick, clamp } from './util.js?v=11';

const NAMES = ['Krause', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Wolf', 'Neumann', 'Schwarz',
  'Zimmermann', 'Braun', 'Hartmann', 'Lange', 'Werner', 'Lehmann', 'Köhler', 'Vogel', 'Frank', 'Berger',
  'Kaiser', 'Fuchs', 'Peters', 'Jung', 'Möller', 'Weiß', 'Scholz', 'Huber', 'Roth', 'Beck', 'Brandt', 'Haas'];

export const SKILL = { leicht: 0.35, normal: 0.6, schwer: 0.85 };
export const TEAM_NAMES = ['Blau', 'Rot'];
export const PER_TEAM = 7;

// Serien-Belohnungen. Fahrzeuge werden über DEFS[id].unlock freigeschaltet.
export const STREAKS = [
  { n: 2, id: 'repair', label: 'Feldreparatur', text: '50 % Zustand wiederhergestellt' },
  { n: 4, id: 'escort', label: 'Begleitschutz', text: 'Zwei Begleiter an deiner Seite' },
  { n: 7, id: 'barrage', label: 'Sperrfeuer', text: 'F drücken: Artillerie auf das Ziel' },
];

export const MAPS = {
  sea: { name: 'Inselmeer', kinds: ['plane', 'ship'] },
  city: { name: 'Stadt', kinds: ['tank'] },
};

const makeAI = (u, game) => (u.kind === 'plane' ? new PlaneAI(u, game) : u.kind === 'tank' ? new TankAI(u, game) : new ShipAI(u, game));

const newStats = () => ({ kills: 0, deaths: 0, caps: 0, bestStreak: 0, damage: 0 });

// Steuert eine Einheit nach den Eingaben eines Mitspielers (nur beim Host).
class RemoteCtrl {
  constructor(unit) {
    this.u = unit;
    this.input = null;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.aim = new THREE.Vector3();
    this.torpSeq = 0;
  }

  update() {
    const u = this.u, i = this.input, c = u.ctrl;
    if (!i) return;
    if (u.kind === 'plane') {
      if (i.a) { this.dir.fromArray(i.a); u.steer(this.dir); }
      if (i.r) c.roll = i.r;
      c.throttle = clamp(i.th ?? 1, 0, 1);
      c.fire = !!i.f1;
      c.fire2 = !!i.f2;
    } else if (u.kind === 'tank') {
      c.throttle = clamp(i.th || 0, -0.5, 1);
      c.steer = clamp(i.ru || 0, -1, 1);
      c.aimPoint = i.ap ? this.aim.fromArray(i.ap) : null;
      c.fire = !!i.f1;
    } else {
      c.throttle = clamp(i.th ?? 0.5, -0.25, 1);
      u.throttleStep = i.st;
      c.rudder = clamp(i.ru || 0, -1, 1);
      c.aimPoint = i.ap ? this.aim.fromArray(i.ap) : null;
      c.fire = !!i.f1;
      if (i.tq !== undefined && i.tq !== this.torpSeq) { this.torpSeq = i.tq; c.torp = true; }
    }
  }
}

export function zonesFor(map) {
  const src = map === 'city' ? CITY_ZONES : [
    { name: 'A', x: -1600, z: 0, r: 330 }, { name: 'B', x: 0, z: 0, r: 330 }, { name: 'C', x: 1600, z: 0, r: 330 },
  ];
  return src.map((z) => ({ ...z, v: 0, owner: -1, inside: [0, 0] }));
}

export class Game {
  constructor({ scene, world, effects, audio, settings, unlocks, hooks, map = 'sea' }) {
    this.map = map;
    world.setMap(map);
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.settings = settings;
    this.hooks = hooks;
    this.skill = SKILL[settings.difficulty] ?? 0.6;
    this.projectiles = new Projectiles(scene);
    this.units = [];
    this.time = 0;
    this.duration = 15 * 60;
    this.tickets = [800, 800];
    this.maxTickets = 800;
    this.zones = zonesFor(map);
    this.respawnQueue = [];
    this.barrages = [];
    this.over = false;
    this.winner = -1;
    this.usedNames = new Set();
    this.net = null; // NetHost, falls Mehrspieler

    // Menschliche Spieler: 'local' plus Mitspieler (Schlüssel = Peer-ID)
    this.humans = new Map();
    this.local = { key: 'local', name: settings.name || 'Spieler', team: 0, unit: null, stats: newStats(), unlocks, hooks };
    this.humans.set('local', this.local);
  }

  get player() { return this.local.unit; }
  get myTeam() { return this.local.team; }
  get stats() { return this.local.stats; }
  get barrageReady() { return !!(this.player && this.player.barrageReady); }

  emit(ev) { if (this.net) this.net.event(ev); }

  botName() {
    const free = NAMES.filter((n) => !this.usedNames.has(n));
    const n = free.length ? pick(free) : pick(NAMES) + ' ' + ((Math.random() * 9) | 0);
    this.usedNames.add(n);
    return n;
  }

  humansOn(team) {
    let n = 0;
    for (const h of this.humans.values()) if (h.team === team) n++;
    return n;
  }

  // Startet das Gefecht. playerDef = null: Spieler wählt erst danach (Mehrspieler-Host).
  start(playerDef, localTeam = 0) {
    this.local.team = localTeam;
    if (playerDef) this.spawnHuman(this.local, playerDef);
    for (let team = 0; team < 2; team++) {
      const n = Math.max(0, PER_TEAM - this.humansOn(team));
      if (this.map === 'city') {
        for (let i = 0; i < n; i++) this.spawnBot(team, 'tank', this.botName());
        continue;
      }
      let planes = Math.round(n * 0.5);
      if (playerDef && team === localTeam) planes += DEFS[playerDef].kind === 'plane' ? -1 : 1;
      planes = clamp(planes, 0, n);
      for (let i = 0; i < n; i++) this.spawnBot(team, i < planes ? 'plane' : 'ship', this.botName());
    }
  }

  spawnPoint(team, kind) {
    const s = team === 0 ? 1 : -1;
    if (kind === 'tank') {
      for (let tries = 0; tries < 40; tries++) {
        const pos = new THREE.Vector3(Math.round(rand(-5, 5)) * 130 + rand(-40, 40), 0, s * (1170 + rand(-15, 15)));
        if (this.world.heightAt(pos.x, pos.z) > 0.5) continue;
        if (this.units.some((u) => u.kind === 'tank' && u.alive && u.pos.distanceTo(pos) < 16)) continue;
        return { pos, heading: team === 0 ? 0 : Math.PI };
      }
      return { pos: new THREE.Vector3(rand(-600, 600), 0, s * 1220), heading: team === 0 ? 0 : Math.PI };
    }
    if (kind === 'plane') {
      return { pos: new THREE.Vector3(rand(-1400, 1400), rand(550, 800), s * rand(3100, 3350)), heading: team === 0 ? 0 : Math.PI };
    }
    // Schiffe: freie Stelle auf der eigenen Seite suchen
    for (let tries = 0; tries < 30; tries++) {
      const pos = new THREE.Vector3(rand(-1600, 1600), 0, s * rand(1900, 2300));
      if (this.world.heightAt(pos.x, pos.z) > -20) continue;
      if (this.units.some((u) => u.kind === 'ship' && u.alive && u.pos.distanceTo(pos) < 220)) continue;
      return { pos, heading: team === 0 ? 0 : Math.PI };
    }
    return { pos: new THREE.Vector3(rand(-300, 300), 0, s * 2600), heading: team === 0 ? 0 : Math.PI };
  }

  botDef(kind) {
    const list = kind === 'plane' ? PLANES : kind === 'tank' ? TANKS : SHIPS;
    // Leichte Fahrzeuge häufiger als schwere
    const w = list.map((id) => 1 / (1 + DEFS[id].unlock * 0.35));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[0];
  }

  spawnBot(team, kind, name, defId = null, escortOf = null) {
    const id = defId || this.botDef(kind);
    const u = createUnit(this, id, team, name, false);
    u.ai = makeAI(u, this);
    if (escortOf) {
      u.ai.escortOf = escortOf;
      u.escort = true;
      if (u.kind === 'tank') {
        const sp = this.spawnPoint(team, 'tank');
        u.spawn(sp.pos, sp.heading);
      } else {
        const p = escortOf.pos.clone().add(new THREE.Vector3(rand(-80, 80), 40, rand(60, 120)));
        p.y = Math.max(p.y, 300);
        u.spawn(p, escortOf.kind === 'plane' ? Math.atan2(-escortOf.fwd.x, -escortOf.fwd.z) : 0);
      }
    } else {
      const sp = this.spawnPoint(team, u.kind);
      u.spawn(sp.pos, sp.heading);
    }
    this.units.push(u);
    return u;
  }

  spawnHuman(h, defId) {
    const old = h.unit;
    if (old) {
      old.dispose();
      const i = this.units.indexOf(old);
      if (i >= 0) this.units.splice(i, 1);
    }
    const u = createUnit(this, defId, h.team, h.name, h.key === 'local');
    u.human = h;
    if (h.key !== 'local') { u.ai = new RemoteCtrl(u); u.remote = h.key; }
    const sp = this.spawnPoint(h.team, u.kind);
    u.spawn(sp.pos, sp.heading);
    this.units.push(u);
    h.unit = u;
    return u;
  }

  respawnPlayer(defId) {
    return this.spawnHuman(this.local, defId);
  }

  // Mitspieler kommt dazu: ein Bot seines Teams macht Platz
  addHuman(h) {
    h.stats = newStats();
    this.humans.set(h.key, h);
    const q = this.respawnQueue.findIndex((r) => r.team === h.team);
    if (q >= 0) { this.respawnQueue.splice(q, 1); return; }
    const bot = this.units.find((u) => u.team === h.team && !u.human && !u.escort && u.alive);
    if (bot) { bot.dispose(); this.units.splice(this.units.indexOf(bot), 1); }
  }

  // Mitspieler geht: seine Einheit fliegt/fährt als Bot weiter
  removeHuman(key) {
    const h = this.humans.get(key);
    if (!h) return;
    this.humans.delete(key);
    const u = h.unit;
    if (u && u.alive) {
      u.human = null; u.remote = null;
      u.ai = makeAI(u, this);
    } else {
      if (u) { u.dispose(); this.units.splice(this.units.indexOf(u), 1); }
      const kind = this.map === 'city' ? 'tank' : Math.random() < 0.5 ? 'plane' : 'ship';
      this.respawnQueue.push({ t: this.time + 3, team: h.team, kind, name: this.botName() });
    }
  }

  nearestEnemy(u, kind, maxDist, filter) {
    return this.nearestEnemyFrom(u.pos, u.team, kind, maxDist, filter);
  }

  nearestEnemyFrom(pos, team, kind, maxDist, filter) {
    let best = null, bd = maxDist * maxDist;
    for (const e of this.units) {
      if (!e.alive || e.removed || e.team === team || (kind && e.kind !== kind)) continue;
      const d = e.pos.distanceToSquared(pos);
      if (d < bd && (!filter || filter(e))) { bd = d; best = e; }
    }
    return best;
  }

  recentAttacker(u) {
    return u.lastAttacker && this.time - u.lastHit < 12 ? u.lastAttacker : null;
  }

  applyDamage(u, amount, attacker, type) {
    if (!u.alive || this.over) return;
    if (attacker && attacker.team === u.team) return;
    // Schiffe sind gegen MG-Feuer gepanzert
    if (u.kind === 'ship' && type === 'bullet') amount *= u.def.id === 'schnellboot' ? 0.6 : 0.2;
    if (u.kind === 'tank') amount *= type === 'bullet' ? 0.1 : u.def.armor;
    const dealt = Math.min(amount, u.hp);
    u.hp -= amount;
    if (attacker) { u.lastAttacker = attacker; u.lastHit = this.time; }
    if (attacker && attacker.human) {
      attacker.human.stats.damage += dealt;
      attacker.human.hooks.hit(u.hp <= 0);
    }
    if (u.human) u.human.hooks.hurt(amount / u.def.hp, attacker ? attacker.pos : null);
    if (u.hp <= 0) { u.hp = 0; this.kill(u, attacker, type); }
  }

  blast(pos, size, splash = 0, boom = size) {
    if (splash) this.effects.splash(pos, splash);
    this.effects.explosion(pos, size);
    this.audio.boom(boom, pos);
    this.emit(['x', +pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1), size, splash, boom]);
  }

  kill(u, killer, how) {
    if (!u.alive) return;
    u.alive = false;
    u.deathTime = this.time;
    if (u.kind === 'ship') this.blast(u.pos.clone().setY(u.def.top * 0.6), 3 + u.def.beam * 0.2, 0, 3);
    else if (u.kind === 'tank') this.blast(u.pos.clone().setY(1.5), 2, 0, 2);
    else this.blast(u.pos, 1.5);
    this.tickets[u.team] = Math.max(0, this.tickets[u.team] - (u.kind === 'ship' ? 15 : u.kind === 'tank' ? 12 : 6));
    const credited = killer && killer !== u && killer.team !== u.team;
    if (credited) {
      killer.kills++;
      killer.streak++;
      const h = killer.human;
      if (h) {
        h.stats.kills++;
        h.stats.bestStreak = Math.max(h.stats.bestStreak, killer.streak);
        h.hooks.kill(u, killer.streak);
        this.streakReward(killer);
      }
    }
    this.hooks.feed(credited ? killer : null, u, how);
    this.emit(['k', credited ? killer.id : 0, u.id, how || '']);
    u.streak = 0;
    if (u.human) {
      u.human.stats.deaths++;
      u.barrageReady = false;
      u.human.hooks.playerDied(credited ? killer : null);
    } else if (!u.escort) {
      this.respawnQueue.push({ t: this.time + 9, team: u.team, kind: u.kind, name: u.name });
    }
  }

  streakReward(p) {
    const h = p.human;
    const fresh = Object.keys(DEFS).filter((id) => DEFS[id].unlock > 0 && DEFS[id].unlock <= p.streak && !h.unlocks.has(id));
    if (fresh.length) {
      fresh.forEach((id) => h.unlocks.add(id));
      h.hooks.unlocked(fresh);
    }
    for (const s of STREAKS) {
      if (s.n !== p.streak) continue;
      if (s.id === 'repair') {
        p.hp = Math.min(p.def.hp, p.hp + p.def.hp * 0.5);
        h.hooks.reward(s.label, s.text);
      } else if (s.id === 'escort') {
        const kind = p.kind === 'tank' ? 'tank' : 'plane';
        for (let i = 0; i < 2; i++) this.spawnBot(p.team, kind, 'Rotte ' + (i + 1), kind === 'tank' ? 'dachs' : 'falke', p);
        h.hooks.reward(s.label, s.text);
      } else if (s.id === 'barrage') {
        p.barrageReady = true;
        h.hooks.reward(s.label, s.text);
      }
    }
  }

  callBarrage(point, unit = this.player) {
    if (!unit || !unit.barrageReady) return false;
    unit.barrageReady = false;
    for (let i = 0; i < 18; i++) {
      this.barrages.push({ t: this.time + 2.5 + i * 0.22, x: point.x + rand(-70, 70), z: point.z + rand(-70, 70), owner: unit });
    }
    return true;
  }

  update(dt) {
    if (this.over) return;
    this.time += dt;

    for (const u of this.units) if (u.ai && u.alive) u.ai.update(dt);
    for (const u of this.units) if (!u.removed) u.update(dt);
    this.projectiles.update(dt, this);

    // Abgeschossene Einheiten aufräumen (menschliche räumt spawnHuman ab)
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.removed && !u.human && this.time - u.deathTime > 2) {
        u.dispose();
        this.units.splice(i, 1);
      }
    }
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const r = this.respawnQueue[i];
      if (this.time >= r.t && this.tickets[r.team] > 0) {
        this.respawnQueue.splice(i, 1);
        this.spawnBot(r.team, r.kind, r.name);
      }
    }
    for (let i = this.barrages.length - 1; i >= 0; i--) {
      const b = this.barrages[i];
      if (this.time >= b.t) {
        this.barrages.splice(i, 1);
        const p = new THREE.Vector3(b.x, 900, b.z);
        this.projectiles.fire('shell', p, new THREE.Vector3(rand(-5, 5), -420, rand(-5, 5)), b.owner, { dmg: 650, splash: 30, life: 6, size: 1.2 });
      }
    }

    this.updateZones(dt);

    if (this.tickets[0] <= 0 || this.tickets[1] <= 0 || this.time >= this.duration) {
      this.over = true;
      this.winner = this.tickets[0] === this.tickets[1] ? -1 : this.tickets[0] > this.tickets[1] ? 0 : 1;
      this.hooks.end(this.winner);
      if (this.net) this.net.end(this.winner);
    }
  }

  updateZones(dt) {
    const owned = [0, 0];
    for (const z of this.zones) {
      const n = [0, 0];
      for (const u of this.units) {
        if ((u.kind !== 'ship' && u.kind !== 'tank') || !u.alive) continue;
        if (Math.hypot(u.pos.x - z.x, u.pos.z - z.z) < z.r) n[u.team]++;
      }
      z.inside = n;
      const diff = clamp(n[0] - n[1], -2, 2);
      if (diff !== 0) {
        const before = z.v;
        z.v = clamp(z.v + diff * 0.06 * dt, -1, 1);
        if (z.v >= 1 && z.owner !== 0) this.capture(z, 0);
        else if (z.v <= -1 && z.owner !== 1) this.capture(z, 1);
        else if (z.owner === 0 && z.v < 0 && before >= 0) z.owner = -1;
        else if (z.owner === 1 && z.v > 0 && before <= 0) z.owner = -1;
      }
      if (z.owner >= 0) owned[z.owner]++;
    }
    if (owned[0] !== owned[1]) {
      const loser = owned[0] > owned[1] ? 1 : 0;
      this.tickets[loser] = Math.max(0, this.tickets[loser] - Math.abs(owned[0] - owned[1]) * 1.6 * dt);
    }
  }

  capture(z, team) {
    z.owner = team;
    for (const h of this.humans.values()) {
      const p = h.unit;
      if (p && p.alive && p.team === team && p.kind !== 'plane' && Math.hypot(p.pos.x - z.x, p.pos.z - z.z) < z.r) h.stats.caps++;
    }
    this.hooks.zone(z, team);
    this.emit(['z', this.zones.indexOf(z), team]);
  }

  dispose() {
    for (const u of this.units) u.dispose();
    this.units.length = 0;
    this.projectiles.clear();
    for (const m of [this.projectiles.tracers, this.projectiles.bombs, this.projectiles.torps]) this.scene.remove(m);
  }
}
