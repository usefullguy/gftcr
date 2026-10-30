import * as THREE from 'three';
import { clamp, angleDiff, rand, elevationFor } from './util.js?v=11';
import { CALIBERS } from './vehicles.js?v=11';
import { MAP_HALF } from './world.js?v=11';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// Vorhalt: Wo ist das Ziel, wenn das Geschoss ankommt?
function lead(from, target, speed, out, iterations = 3) {
  out.copy(target.pos);
  for (let i = 0; i < iterations; i++) {
    const t = from.distanceTo(out) / speed;
    out.copy(target.vel).multiplyScalar(t).add(target.pos);
  }
  return out;
}

export class PlaneAI {
  constructor(unit, game) {
    this.u = unit;
    this.game = game;
    this.target = null;
    this.retarget = 0;
    this.evade = 0;
    this.evadeDir = new THREE.Vector3();
    this.egress = 0;
    this.wobble = rand(0, 100);
    this.patrol = new THREE.Vector3(rand(-1800, 1800), rand(500, 900), rand(-600, 600));
    this.escortOf = null;
  }

  pickTarget() {
    const u = this.u, g = this.game, role = u.def.id;
    let best = null, bestScore = Infinity;
    const anchor = this.escortOf && this.escortOf.alive ? this.escortOf.pos : u.pos;
    for (const e of g.units) {
      if (!e.alive || e.removed || e.team === u.team) continue;
      const d = anchor.distanceTo(e.pos);
      let score = d;
      if (e.kind === 'plane') {
        if (role === 'bussard' && u.ammo2 > 0) score += 4000;
        _v.subVectors(e.pos, u.pos).normalize();
        score += (1 - _v.dot(u.fwd)) * 400;
      } else {
        if (role === 'falke') score += 2500;
        else if (role === 'habicht') score += u.ammo2 > 0 ? 300 : 2500;
        else if (role === 'bussard') score += u.ammo2 > 0 ? -800 : 3000;
      }
      // nicht alle auf den Spieler
      if (e.isPlayer) score += g.skill > 0.7 ? -100 : 150;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  update(dt) {
    const u = this.u, g = this.game, c = u.ctrl;
    if (!u.alive) return;
    const skill = g.skill;
    this.retarget -= dt;
    this.wobble += dt;
    if (this.retarget <= 0 || !this.target || !this.target.alive) {
      this.target = this.pickTarget();
      this.retarget = rand(2, 4);
    }
    c.fire = false; c.fire2 = false; c.throttle = 1;
    const desired = _v3;
    const ground = g.world.groundAt(u.pos.x, u.pos.z);
    const look = Math.max(250, u.speed * 3.5);
    const aheadX = u.pos.x + u.fwd.x * look, aheadZ = u.pos.z + u.fwd.z * look;
    const groundAhead = g.world.groundAt(aheadX, aheadZ);
    const aheadY = u.pos.y + u.fwd.y * look;
    const minAlt = 90;

    // 1. Nicht abstürzen
    if (u.pos.y - ground < minAlt || aheadY - groundAhead < minAlt * 0.8 || (u.fwd.y < -0.5 && u.pos.y - ground < u.speed * 2.2)) {
      desired.set(u.fwd.x, 0, u.fwd.z).normalize();
      desired.y = 0.9;
      u.steer(desired.normalize());
      return;
    }
    // 2. Kartenrand
    if (Math.hypot(u.pos.x, u.pos.z) > MAP_HALF - 350) {
      desired.set(-u.pos.x, 600 - u.pos.y, -u.pos.z).normalize();
      u.steer(desired);
      return;
    }
    // 3. Dienstgipfelhöhe: Luftkämpfe sollen über den Schiffen stattfinden
    if (u.pos.y > 2100 && u.fwd.y > -0.2) {
      desired.set(u.fwd.x, 0, u.fwd.z).normalize();
      desired.y = -0.45;
      u.steer(desired.normalize());
      c.fire = false;
      return;
    }
    // 4. Ausweichen, wenn jemand hinten drauf sitzt
    if (this.evade > 0) {
      this.evade -= dt;
      u.steer(this.evadeDir);
      if (Math.random() < dt * 0.8) this.newEvade();
      return;
    }
    const chaser = g.nearestEnemy(u, 'plane', 500, (e) => {
      _v.subVectors(u.pos, e.pos).normalize();
      return _v.dot(e.fwd) > 0.95 && _v.dot(u.fwd) > 0.3;
    });
    if (chaser && Math.random() < dt * (0.4 + skill)) {
      this.evade = rand(1.5, 3);
      this.newEvade();
      return;
    }
    if (this.egress > 0) {
      this.egress -= dt;
      desired.set(u.fwd.x, 0.35, u.fwd.z).normalize();
      u.steer(desired);
      return;
    }

    const t = this.target;
    if (!t) {
      desired.subVectors(this.patrol, u.pos);
      if (desired.length() < 400) this.patrol.set(rand(-1800, 1800), rand(500, 900), rand(-800, 800));
      u.steer(desired.normalize());
      c.throttle = 0.85;
      return;
    }

    if (t.kind === 'plane') this.dogfight(t, dt, skill);
    else this.attackShip(t, dt, skill);
  }

  newEvade() {
    const u = this.u;
    const side = Math.random() < 0.5 ? -1 : 1;
    this.evadeDir.set(-u.fwd.z * side, rand(-0.4, 0.6), u.fwd.x * side).add(_v.copy(u.fwd).multiplyScalar(0.3)).normalize();
    if (u.pos.y < 250) this.evadeDir.y = Math.abs(this.evadeDir.y) + 0.2;
  }

  dogfight(t, dt, skill) {
    const u = this.u, c = u.ctrl;
    const gun = u.def.guns[0];
    const aim = lead(u.pos, t, gun.speed, _v2);
    const err = (1 - skill) * 0.06;
    aim.x += Math.sin(this.wobble * 1.7) * err * 100;
    aim.y += Math.cos(this.wobble * 2.3) * err * 100;
    const to = _v.subVectors(aim, u.pos);
    const dist = to.length();
    to.normalize();
    u.steer(to);
    const angle = Math.acos(clamp(to.dot(u.fwd), -1, 1));
    if (dist < gun.range * (0.6 + skill * 0.4) && angle < Math.atan2(12, dist) + 0.01) c.fire = !u.overheated && u.heat < 0.85;
    // Überschießen vermeiden
    if (dist < 220 && u.speed > t.vel.length() + 10 && angle < 0.5) c.throttle = 0.35;
    if (dist < 60) { this.egress = 1.5; }
  }

  attackShip(t, dt, skill) {
    const u = this.u, c = u.ctrl, g = this.game, role = u.def.id;
    if (role === 'bussard' && u.ammo2 > 0) {
      // Bombenwurf im flachen Anflug
      const alt = Math.max(160, 260 - skill * 60);
      const h = u.pos.y;
      const fall = Math.sqrt(2 * Math.max(h, 10) / 9.81);
      const impactX = u.pos.x + u.vel.x * fall, impactZ = u.pos.z + u.vel.z * fall;
      const tx = t.pos.x + t.vel.x * fall, tz = t.pos.z + t.vel.z * fall;
      const miss = Math.hypot(impactX - tx, impactZ - tz);
      const target = _v.set(tx - u.vel.x * fall * 0.9, alt, tz - u.vel.z * fall * 0.9);
      const to = _v2.subVectors(target, u.pos);
      const hd = Math.hypot(to.x, to.z);
      to.y = clamp((alt - u.pos.y) / Math.max(hd, 200), -0.4, 0.4) * hd;
      if (hd < 300 && miss > 120) {
        // vorbei: weiterfliegen, dann neu anfliegen
        this.egress = 5;
      }
      u.steer(to.normalize());
      if (miss < t.def.len * 0.35 + (1 - skill) * 20) {
        c.fire2 = true;
        this.egress = 6;
      }
      return;
    }
    // Tiefangriff mit Bordwaffen/Raketen
    const speed = role === 'habicht' && u.ammo2 > 0 ? u.speed + 300 : u.def.guns[0].speed;
    const aim = lead(u.pos, t, speed, _v2);
    aim.y += t.def.top * 0.3;
    const to = _v.subVectors(aim, u.pos);
    const dist = to.length();
    to.normalize();
    if (dist > 1600) {
      to.y = clamp((450 - u.pos.y) / dist, -0.3, 0.3);
      to.normalize();
    }
    u.steer(to);
    const angle = Math.acos(clamp(to.dot(u.fwd), -1, 1));
    if (angle < 0.05 + (1 - skill) * 0.03) {
      if (dist < 900) c.fire = u.heat < 0.85 && !u.overheated;
      if (role === 'habicht' && dist < 900 && dist > 250) c.fire2 = Math.random() < dt * 6;
    }
    if (dist < 230 || u.pos.y - g.world.groundAt(u.pos.x, u.pos.z) < 140) this.egress = 3;
  }
}

export class ShipAI {
  constructor(unit, game) {
    this.u = unit;
    this.game = game;
    this.zone = null;
    this.rezone = 0;
    this.offset = new THREE.Vector3(rand(-120, 120), 0, rand(-120, 120));
    this.target = null;
    this.retarget = 0;
    this.err = new THREE.Vector3();
    this.reerr = 0;
    this.aim = new THREE.Vector3();
    this.avoid = 0;
    this.avoidSide = 1;
  }

  pickZone() {
    const u = this.u, g = this.game;
    let best = null, bestScore = Infinity;
    for (const z of g.zones) {
      let score = Math.hypot(z.x - u.pos.x, z.z - u.pos.z);
      if (z.owner === u.team) score += 2500;
      const allies = g.units.filter((o) => o !== u && o.alive && o.team === u.team && o.ai && o.ai.zone === z).length;
      score += allies * 900;
      if (score < bestScore) { bestScore = score; best = z; }
    }
    return best;
  }

  update(dt) {
    const u = this.u, g = this.game, c = u.ctrl, def = u.def;
    if (!u.alive) return;
    const skill = g.skill;
    this.rezone -= dt;
    if (this.rezone <= 0) { this.zone = this.pickZone(); this.rezone = rand(6, 10); }

    // Ziel ansteuern
    let goalX, goalZ;
    const retreat = u.hpFrac < 0.2;
    if (retreat) { goalX = u.pos.x; goalZ = u.team === 0 ? 3000 : -3000; }
    else { goalX = this.zone.x + this.offset.x; goalZ = this.zone.z + this.offset.z; }
    const dGoal = Math.hypot(goalX - u.pos.x, goalZ - u.pos.z);
    let desired = Math.atan2(-(goalX - u.pos.x), -(goalZ - u.pos.z));
    c.throttle = 1;
    if (!retreat && dGoal < this.zone.r * 0.7) {
      desired = u.heading + 0.7;
      c.throttle = 0.55;
    }

    // Hindernisse
    const probe = (ang, dist) => {
      const x = u.pos.x - Math.sin(ang) * dist, z = u.pos.z - Math.cos(ang) * dist;
      return g.world.heightAt(x, z) > -def.draft - 2 || Math.hypot(x, z) > 3700;
    };
    const look = def.len * 0.6 + Math.max(120, u.speed * 12);
    if (this.avoid > 0) {
      this.avoid -= dt;
      desired = u.heading + this.avoidSide * 1.2;
    } else if (probe(u.heading, look) || probe(u.heading, look * 0.5)) {
      const left = probe(u.heading + 0.6, look), right = probe(u.heading - 0.6, look);
      this.avoidSide = left && !right ? -1 : !left && right ? 1 : (angleDiff(u.heading, desired) > 0 ? 1 : -1);
      this.avoid = 2.5;
      desired = u.heading + this.avoidSide * 1.2;
    }
    // andere Schiffe
    for (const o of g.units) {
      if (o === u || o.kind !== 'ship' || !o.alive) continue;
      const dx = o.pos.x - u.pos.x, dz = o.pos.z - u.pos.z;
      const d = Math.hypot(dx, dz);
      const minD = (def.len + o.def.len) * 0.55;
      if (d < minD) {
        const ahead = -(dx * Math.sin(u.heading) + dz * Math.cos(u.heading));
        if (ahead > 0) {
          const side = dx * -Math.cos(u.heading) + dz * Math.sin(u.heading);
          desired = u.heading + (side > 0 ? 0.9 : -0.9);
          c.throttle = Math.min(c.throttle, 0.4);
        }
      }
    }
    c.rudder = clamp(-angleDiff(u.heading, desired) * 2.2, -1, 1);

    // Zielauswahl
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || !this.target.alive) {
      this.target = g.nearestEnemy(u, 'ship', u.cal.range * 1.05);
      this.retarget = rand(1.5, 3);
    }
    const t = this.target;
    c.fire = false;
    if (!t) { c.aimPoint = null; return; }

    this.reerr -= dt;
    const dist = u.pos.distanceTo(t.pos);
    if (this.reerr <= 0) {
      const s = dist * 0.045 * (1.25 - skill);
      this.err.set(rand(-s, s), 0, rand(-s, s));
      this.reerr = u.cal.reload + rand(0, 1);
    }
    // Flugzeit iterativ schätzen
    const cal = u.cal;
    this.aim.copy(t.pos);
    for (let i = 0; i < 3; i++) {
      const dx = Math.hypot(this.aim.x - u.pos.x, this.aim.z - u.pos.z);
      const e = elevationFor(dx, 0, cal.speed) || 0.4;
      const tof = dx / (cal.speed * Math.cos(e));
      this.aim.copy(t.vel).multiplyScalar(tof * (0.6 + skill * 0.4)).add(t.pos);
    }
    this.aim.add(this.err);
    this.aim.y = 1.5;
    c.aimPoint = this.aim;
    c.fire = dist < cal.range;

    if (def.torpedo && u.torps === def.torpedo.count && dist < 1500 && dist > 250 && Math.random() < dt * 0.5) {
      const tof = dist / def.torpedo.speed;
      _v.copy(t.vel).multiplyScalar(tof).add(t.pos);
      c.aimPoint = _v.clone();
      c.torp = true;
    }
  }
}

export class TankAI {
  constructor(unit, game) {
    this.u = unit;
    this.game = game;
    this.zone = null;
    this.rezone = 0;
    this.target = null;
    this.retarget = 0;
    this.err = new THREE.Vector3();
    this.reerr = 0;
    this.aim = new THREE.Vector3();
    this.wp = null;
    this.stuckT = 0;
    this.reverseT = 0;
    this.reverseSteer = 1;
    this.offset = new THREE.Vector3(rand(-50, 50), 0, rand(-50, 50));
    this.escortOf = null;
  }

  pickZone() {
    const u = this.u, g = this.game;
    let best = null, bestScore = Infinity;
    for (const z of g.zones) {
      let score = Math.hypot(z.x - u.pos.x, z.z - u.pos.z);
      if (z.owner === u.team) score += 1200;
      score += g.units.filter((o) => o !== u && o.alive && o.team === u.team && o.ai && o.ai.zone === z).length * 500;
      if (score < bestScore) { bestScore = score; best = z; }
    }
    return best;
  }

  update(dt) {
    const u = this.u, g = this.game, c = u.ctrl, w = g.world;
    if (!u.alive) return;
    const skill = g.skill;
    const C = w.city ? 130 : 200;

    // Ziel suchen: nächster sichtbarer Gegner
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = rand(0.6, 1.2);
      const eye = _v.set(u.pos.x, 2.4, u.pos.z);
      let best = null, bd = 950 * 950;
      for (const e of g.units) {
        if (!e.alive || e.removed || e.team === u.team) continue;
        const d = e.pos.distanceToSquared(u.pos);
        if (d < bd && w.lineOfSight(eye, _v2.set(e.pos.x, 1.8, e.pos.z))) { bd = d; best = e; }
      }
      this.target = best;
    }

    c.fire = false;
    c.aimPoint = null;
    let engage = false;
    const t = this.target;
    if (t && t.alive) {
      const dist = u.pos.distanceTo(t.pos);
      this.reerr -= dt;
      if (this.reerr <= 0) {
        const s = 1.5 + dist * 0.012 * (1.2 - skill);
        this.err.set(rand(-s, s), rand(-0.6, 0.6), rand(-s, s));
        this.reerr = u.cal.reload * 0.8;
      }
      const tof = dist / u.cal.speed;
      this.aim.copy(t.vel).multiplyScalar(tof * (0.5 + skill * 0.5)).add(t.pos).add(this.err);
      this.aim.y = 1.4;
      c.aimPoint = this.aim;
      c.fire = u.turret.ready;
      engage = dist < 650;
    }

    // Wohin fahren?
    this.rezone -= dt;
    if (this.rezone <= 0 || !this.zone) { this.zone = this.pickZone(); this.rezone = rand(8, 14); }
    let gx = this.zone.x + this.offset.x, gz = this.zone.z + this.offset.z;
    if (this.escortOf && this.escortOf.alive) { gx = this.escortOf.pos.x; gz = this.escortOf.pos.z; }
    const dGoal = Math.hypot(gx - u.pos.x, gz - u.pos.z);

    let tx = gx, tz = gz;
    if (dGoal > C * 0.9) {
      // Über das Straßenraster: Kreuzung für Kreuzung
      const ix = Math.round(u.pos.x / C), iz = Math.round(u.pos.z / C);
      if (!this.wp || Math.hypot(this.wp.x - u.pos.x, this.wp.z - u.pos.z) < 12) {
        const near = Math.hypot(ix * C - u.pos.x, iz * C - u.pos.z) < 14;
        if (!near) this.wp = { x: ix * C, z: iz * C };
        else {
          const dx = Math.round(gx / C) - ix, dz = Math.round(gz / C) - iz;
          const stepX = Math.abs(dx) > Math.abs(dz) || (Math.abs(dx) === Math.abs(dz) && Math.random() < 0.5);
          this.wp = stepX ? { x: (ix + Math.sign(dx)) * C, z: iz * C } : { x: ix * C, z: (iz + Math.sign(dz)) * C };
        }
      }
      tx = this.wp.x; tz = this.wp.z;
    } else {
      this.wp = null;
    }

    const desired = Math.atan2(-(tx - u.pos.x), -(tz - u.pos.z));
    const diff = angleDiff(u.heading, desired);
    c.steer = clamp(-diff * 2.5, -1, 1);
    c.throttle = Math.abs(diff) > 0.9 ? 0.1 : Math.abs(diff) > 0.4 ? 0.5 : 1;
    if (dGoal < (this.zone.r || 100) * 0.5 && !this.escortOf) { c.throttle = 0; c.steer = 0; }
    if (this.escortOf && dGoal < 40) c.throttle = 0;
    if (engage) c.throttle = Math.min(c.throttle, 0.35);

    // Festgefahren? Kurz zurücksetzen
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      c.throttle = -0.7;
      c.steer = this.reverseSteer;
      this.wp = null;
    } else if (c.throttle > 0.3 && Math.abs(u.speed) < 0.8) {
      this.stuckT += dt;
      if (this.stuckT > 1.5) { this.stuckT = 0; this.reverseT = 1.4; this.reverseSteer = Math.random() < 0.5 ? -1 : 1; }
    } else {
      this.stuckT = 0;
    }
  }
}
