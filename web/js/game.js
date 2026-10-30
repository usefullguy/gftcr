import * as THREE from 'three';
import { createUnit, PLANES, SHIPS, DEFS } from './vehicles.js';
import { PlaneAI, ShipAI } from './ai.js';
import { Projectiles } from './weapons.js';
import { rand, pick, clamp } from './util.js';

const NAMES = ['Krause', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Wolf', 'Neumann', 'Schwarz',
  'Zimmermann', 'Braun', 'Hartmann', 'Lange', 'Werner', 'Lehmann', 'Köhler', 'Vogel', 'Frank', 'Berger',
  'Kaiser', 'Fuchs', 'Peters', 'Jung', 'Möller', 'Weiß', 'Scholz', 'Huber', 'Roth', 'Beck', 'Brandt', 'Haas'];

export const SKILL = { leicht: 0.35, normal: 0.6, schwer: 0.85 };
export const TEAM_NAMES = ['Blau', 'Rot'];

// Serien-Belohnungen
export const STREAKS = [
  { n: 2, id: 'repair', label: 'Feldreparatur', text: '50 % Zustand wiederhergestellt' },
  { n: 3, id: 'unlock1', label: 'Freigeschaltet', unlock: ['habicht', 'zerstoerer'] },
  { n: 4, id: 'escort', label: 'Begleitschutz', text: 'Zwei Jäger fliegen mit dir' },
  { n: 5, id: 'unlock2', label: 'Freigeschaltet', unlock: ['bussard', 'kreuzer'] },
  { n: 7, id: 'barrage', label: 'Sperrfeuer', text: 'F drücken: Artillerie auf das Ziel' },
];

export class Game {
  constructor({ scene, world, effects, audio, settings, unlocks, hooks }) {
    this.scene = scene;
    this.world = world;
    this.effects = effects;
    this.audio = audio;
    this.settings = settings;
    this.unlocks = unlocks;
    this.hooks = hooks;
    this.skill = SKILL[settings.difficulty] ?? 0.6;
    this.projectiles = new Projectiles(scene);
    this.units = [];
    this.time = 0;
    this.duration = 15 * 60;
    this.tickets = [800, 800];
    this.maxTickets = 800;
    this.zones = [
      { name: 'A', x: -1600, z: 0, r: 330, v: 0, owner: -1 },
      { name: 'B', x: 0, z: 0, r: 330, v: 0, owner: -1 },
      { name: 'C', x: 1600, z: 0, r: 330, v: 0, owner: -1 },
    ];
    this.respawnQueue = [];
    this.barrages = [];
    this.player = null;
    this.over = false;
    this.winner = -1;
    this.stats = { kills: 0, deaths: 0, caps: 0, bestStreak: 0, damage: 0 };
    this.barrageReady = false;
    this.usedNames = new Set();
  }

  botName() {
    const free = NAMES.filter((n) => !this.usedNames.has(n));
    const n = free.length ? pick(free) : pick(NAMES) + ' ' + ((Math.random() * 9) | 0);
    this.usedNames.add(n);
    return n;
  }

  start(playerDef) {
    const perTeam = 7;
    this.player = this.spawnPlayer(playerDef);
    for (let team = 0; team < 2; team++) {
      const n = team === 0 ? perTeam - 1 : perTeam;
      let planes = Math.round(n * 0.5);
      if (team === 0 && DEFS[playerDef].kind === 'plane') planes--;
      if (team === 0 && DEFS[playerDef].kind === 'ship') planes++;
      for (let i = 0; i < n; i++) {
        const kind = i < planes ? 'plane' : 'ship';
        this.spawnBot(team, kind, this.botName());
      }
    }
  }

  spawnPoint(team, kind) {
    const s = team === 0 ? 1 : -1;
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
    const list = kind === 'plane' ? PLANES : SHIPS;
    const w = kind === 'plane' ? [0.45, 0.3, 0.25] : [0.35, 0.4, 0.25];
    let r = Math.random();
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[0];
  }

  spawnBot(team, kind, name, defId = null, escortOf = null) {
    const id = defId || this.botDef(kind);
    const u = createUnit(this, id, team, name, false);
    u.ai = u.kind === 'plane' ? new PlaneAI(u, this) : new ShipAI(u, this);
    if (escortOf) {
      u.ai.escortOf = escortOf;
      u.escort = true;
      const p = escortOf.pos.clone().add(new THREE.Vector3(rand(-80, 80), 40, rand(60, 120)));
      p.y = Math.max(p.y, 300);
      u.spawn(p, escortOf.kind === 'plane' ? Math.atan2(-escortOf.fwd.x, -escortOf.fwd.z) : 0);
    } else {
      const sp = this.spawnPoint(team, u.kind);
      u.spawn(sp.pos, sp.heading);
    }
    this.units.push(u);
    return u;
  }

  spawnPlayer(defId) {
    const u = createUnit(this, defId, 0, this.settings.name || 'Spieler', true);
    const sp = this.spawnPoint(0, u.kind);
    u.spawn(sp.pos, sp.heading);
    this.units.push(u);
    this.player = u;
    return u;
  }

  respawnPlayer(defId) {
    const old = this.player;
    if (old) {
      old.dispose();
      this.units.splice(this.units.indexOf(old), 1);
    }
    return this.spawnPlayer(defId);
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
    const dealt = Math.min(amount, u.hp);
    u.hp -= amount;
    if (attacker) { u.lastAttacker = attacker; u.lastHit = this.time; }
    if (attacker && attacker.isPlayer) {
      this.stats.damage += dealt;
      this.hooks.hit(u.hp <= 0);
    }
    if (u.isPlayer) this.hooks.hurt(amount / u.def.hp);
    if (u.hp <= 0) { u.hp = 0; this.kill(u, attacker, type); }
  }

  kill(u, killer, how) {
    if (!u.alive) return;
    u.alive = false;
    u.deathTime = this.time;
    if (u.kind === 'ship') this.effects.explosion(u.pos.clone().setY(u.def.top * 0.6), 3 + u.def.beam * 0.2);
    else this.effects.explosion(u.pos, 1.5);
    this.audio.boom(u.kind === 'ship' ? 3 : 1.5, u.pos);
    this.tickets[u.team] = Math.max(0, this.tickets[u.team] - (u.kind === 'ship' ? 15 : 6));
    if (killer && killer !== u && killer.team !== u.team) {
      killer.kills++;
      killer.streak++;
      if (killer.isPlayer) {
        this.stats.kills++;
        this.stats.bestStreak = Math.max(this.stats.bestStreak, killer.streak);
        this.streakReward(killer);
      }
      this.hooks.feed(killer, u, how);
    } else {
      this.hooks.feed(null, u, how);
    }
    u.streak = 0;
    if (u.isPlayer) {
      this.stats.deaths++;
      this.barrageReady = false;
      this.hooks.playerDied(killer);
    } else if (!u.escort) {
      this.respawnQueue.push({ t: this.time + 9, team: u.team, kind: u.kind, name: u.name, unit: u });
    }
  }

  streakReward(p) {
    for (const s of STREAKS) {
      if (s.n !== p.streak) continue;
      if (s.id === 'repair') {
        p.hp = Math.min(p.def.hp, p.hp + p.def.hp * 0.5);
        this.hooks.reward(s.label, s.text);
      } else if (s.unlock) {
        const fresh = s.unlock.filter((id) => !this.unlocks.has(id));
        if (fresh.length) {
          fresh.forEach((id) => this.unlocks.add(id));
          this.hooks.unlocked(fresh);
        }
      } else if (s.id === 'escort') {
        for (let i = 0; i < 2; i++) this.spawnBot(0, 'plane', 'Rotte ' + (i + 1), 'falke', p);
        this.hooks.reward(s.label, s.text);
      } else if (s.id === 'barrage') {
        this.barrageReady = true;
        this.hooks.reward(s.label, s.text);
      }
    }
  }

  callBarrage(point) {
    if (!this.barrageReady || !this.player) return false;
    this.barrageReady = false;
    for (let i = 0; i < 18; i++) {
      this.barrages.push({ t: this.time + 2.5 + i * 0.22, x: point.x + rand(-70, 70), z: point.z + rand(-70, 70) });
    }
    return true;
  }

  update(dt) {
    if (this.over) return;
    this.time += dt;

    for (const u of this.units) if (u.ai && u.alive) u.ai.update(dt);
    for (const u of this.units) if (!u.removed) u.update(dt);
    this.projectiles.update(dt, this);

    // Abgeschossene Einheiten aufräumen (außer Spieler, den räumt respawnPlayer ab)
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      if (u.removed && !u.isPlayer && this.time - u.deathTime > 2) {
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
        this.projectiles.fire('shell', p, new THREE.Vector3(rand(-5, 5), -420, rand(-5, 5)), this.player, { dmg: 650, splash: 30, life: 6, size: 1.2 });
      }
    }

    this.updateZones(dt);

    if (this.tickets[0] <= 0 || this.tickets[1] <= 0 || this.time >= this.duration) {
      this.over = true;
      this.winner = this.tickets[0] === this.tickets[1] ? -1 : this.tickets[0] > this.tickets[1] ? 0 : 1;
      this.hooks.end(this.winner);
    }
  }

  updateZones(dt) {
    const owned = [0, 0];
    for (const z of this.zones) {
      const n = [0, 0];
      for (const u of this.units) {
        if (u.kind !== 'ship' || !u.alive) continue;
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
    const p = this.player;
    if (p && p.alive && p.team === team && p.kind === 'ship' && Math.hypot(p.pos.x - z.x, p.pos.z - z.z) < z.r) {
      this.stats.caps++;
    }
    this.hooks.zone(z, team);
  }

  dispose() {
    for (const u of this.units) u.dispose();
    this.units.length = 0;
    this.projectiles.clear();
    for (const m of [this.projectiles.tracers, this.projectiles.bombs, this.projectiles.torps]) this.scene.remove(m);
  }
}
