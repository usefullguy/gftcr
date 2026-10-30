import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _v = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const Zp = new THREE.Vector3(0, 0, 1);

function segSphere(a, b, c, r) {
  _d.subVectors(b, a);
  const len2 = _d.lengthSq();
  let t = len2 > 0 ? _v.subVectors(c, a).dot(_d) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _v.copy(a).addScaledVector(_d, t);
  return _v.distanceToSquared(c) <= r * r;
}

// Segment gegen achsenparallele Box (lokal), Box zentriert bei (0, cy, 0)
function segBox(a, b, h, cy) {
  let t0 = 0, t1 = 1;
  const ax = [a.x, a.y - cy, a.z], d = [b.x - a.x, b.y - a.y, b.z - a.z], hh = [h.x, h.y, h.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (ax[i] < -hh[i] || ax[i] > hh[i]) return false;
    } else {
      let u0 = (-hh[i] - ax[i]) / d[i], u1 = (hh[i] - ax[i]) / d[i];
      if (u0 > u1) { const t = u0; u0 = u1; u1 = t; }
      t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
      if (t0 > t1) return false;
    }
  }
  return true;
}

// Abstand eines Punkts zur Rumpf-Box eines Schiffs
export function shipDistance(ship, p) {
  _a.copy(p).applyMatrix4(ship.inv);
  const h = ship.half;
  const dx = Math.max(0, Math.abs(_a.x) - h.x);
  const dy = Math.max(0, Math.abs(_a.y - ship.boxCenterY) - h.y);
  const dz = Math.max(0, Math.abs(_a.z) - h.z);
  return Math.hypot(dx, dy, dz);
}

export class Projectiles {
  constructor(scene) {
    this.list = [];
    this.free = [];
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.tracers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), tracerMat, 1500);
    this.tracers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1500 * 3), 3);
    this.bombs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x3a3d36, flatShading: true }), 60);
    this.torps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x40464a, flatShading: true }), 60);
    for (const m of [this.tracers, this.bombs, this.torps]) {
      m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m);
    }
    this.cBullet = new THREE.Color(0xffd27a).multiplyScalar(4);
    this.cFlak = new THREE.Color(0xff9a5a).multiplyScalar(3.5);
    this.cShell = new THREE.Color(0xffb347).multiplyScalar(5);
    this.cRocket = new THREE.Color(0xfff0c0).multiplyScalar(6);
  }

  fire(type, pos, vel, owner, o) {
    const p = this.free.pop() || { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3() };
    p.type = type;
    p.pos.copy(pos); p.prev.copy(pos); p.vel.copy(vel);
    p.owner = owner; p.team = owner.team;
    p.dmg = o.dmg; p.splash = o.splash || 0; p.life = o.life; p.size = o.size || 1; p.flak = !!o.flak;
    p.travel = 0; p.dead = false;
    this.list.push(p);
    return p;
  }

  clear() {
    for (const p of this.list) this.free.push(p);
    this.list.length = 0;
  }

  update(dt, game) {
    const fx = game.effects;
    for (const p of this.list) {
      p.prev.copy(p.pos);
      if (p.type === 'shell' || p.type === 'bomb') p.vel.y -= 9.81 * dt;
      else if (p.type === 'rocket') { p.vel.y -= 3 * dt; if (Math.random() < 0.6) fx.trail(p.pos, false, 0.8); }
      else if (p.type === 'bullet') p.vel.y -= 2 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.travel += p.vel.length() * dt;
      p.life -= dt;

      if (p.type === 'torpedo') {
        p.pos.y = -1.2;
        if (Math.random() < 0.5) fx.wake(p.pos, 0.9);
        const hit = p.travel > 60 && this.hitShips(p, game, true);
        if (hit) {
          game.applyDamage(hit, p.dmg, p.owner, 'torpedo');
          fx.explosion(_v.set(p.pos.x, 2, p.pos.z), 3); fx.splash(p.pos, 4);
          game.audio.boom(2.2, p.pos);
          p.dead = true;
        } else if (game.world.heightAt(p.pos.x, p.pos.z) > -1.5) {
          fx.splash(p.pos, 2); p.dead = true;
        }
        if (p.life <= 0) p.dead = true;
        continue;
      }

      const hit = this.hitUnits(p, game);
      if (hit) {
        game.applyDamage(hit, p.dmg, p.owner, p.type);
        if (p.type === 'bullet') fx.impact(p.pos, p.size * 0.8);
        else { fx.explosion(p.pos, p.type === 'shell' ? p.size * 1.6 : 1.6); game.audio.boom(p.size, p.pos); }
        if (p.splash) this.splashDamage(p, game, hit);
        p.dead = true;
        continue;
      }

      const ground = game.world.heightAt(p.pos.x, p.pos.z);
      if (p.pos.y <= 0 && ground < 0) {
        if (p.type === 'bullet') { if (Math.random() < 0.35) fx.smallSplash(p.pos); }
        else {
          fx.splash(p.pos, p.type === 'bomb' ? 4 : p.type === 'shell' ? 0.8 + p.size * 1.6 : 1.4);
          if (p.type === 'bomb') { fx.explosion(_v.set(p.pos.x, 1, p.pos.z), 2); game.audio.boom(2, p.pos); }
          else game.audio.splash(p.pos);
          this.splashDamage(p, game, null);
        }
        p.dead = true;
      } else if (p.pos.y <= ground) {
        fx.impact(p.pos, p.type === 'bullet' ? 1 : 3);
        if (p.type !== 'bullet') { fx.explosion(p.pos, p.type === 'bomb' ? 2.5 : 1); game.audio.boom(1, p.pos); }
        p.dead = true;
      } else if (p.life <= 0) {
        if (p.flak) fx.trail(p.pos, true, 2.2);
        p.dead = true;
      }
    }

    let j = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (p.dead) this.free.push(p); else this.list[j++] = p;
    }
    this.list.length = j;
    this.render();
  }

  hitUnits(p, game) {
    const segLen = p.prev.distanceTo(p.pos);
    for (const u of game.units) {
      if (!u.alive || u.team === p.team || u.removed) continue;
      if (u.kind === 'plane') {
        const r = u.def.hitR + (p.type === 'bullet' ? 0 : 2);
        if (u.pos.distanceToSquared(p.pos) > (segLen + r) ** 2) continue;
        if (segSphere(p.prev, p.pos, u.pos, r)) return u;
      } else {
        const r = u.def.len * 0.55;
        if (u.pos.distanceToSquared(p.pos) > (segLen + r) ** 2) continue;
        _a.copy(p.prev).applyMatrix4(u.inv);
        _b.copy(p.pos).applyMatrix4(u.inv);
        if (segBox(_a, _b, u.half, u.boxCenterY)) return u;
      }
    }
    return null;
  }

  hitShips(p, game) {
    for (const u of game.units) {
      if (!u.alive || u.team === p.team || u.kind !== 'ship') continue;
      _a.copy(p.pos).applyMatrix4(u.inv);
      if (Math.abs(_a.x) < u.half.x + 0.6 && Math.abs(_a.z) < u.half.z) return u;
    }
    return null;
  }

  splashDamage(p, game, direct) {
    if (!p.splash) return;
    for (const u of game.units) {
      if (!u.alive || u.team === p.team || u === direct) continue;
      const d = u.kind === 'ship' ? shipDistance(u, p.pos) : u.pos.distanceTo(p.pos);
      if (d < p.splash) game.applyDamage(u, p.dmg * 0.6 * (1 - d / p.splash), p.owner, p.type);
    }
  }

  render() {
    let nt = 0, nb = 0, nt2 = 0;
    for (const p of this.list) {
      _d.copy(p.vel).normalize();
      _q.setFromUnitVectors(Zp, _d);
      if (p.type === 'bomb') {
        if (nb >= 60) continue;
        _m.compose(p.pos, _q, _s.set(1, 1, 1));
        this.bombs.setMatrixAt(nb++, _m);
      } else if (p.type === 'torpedo') {
        if (nt2 >= 60) continue;
        _m.compose(_v.set(p.pos.x, -0.2, p.pos.z), _q, _s.set(1, 1, 1));
        this.torps.setMatrixAt(nt2++, _m);
      } else {
        if (nt >= 1500) continue;
        let w, len, c;
        if (p.type === 'shell') { w = p.size * 0.9; len = 4 + p.size * 8; c = this.cShell; }
        else if (p.type === 'rocket') { w = 0.5; len = 2.5; c = this.cRocket; }
        else { w = 0.16 * p.size; len = 5 * p.size; c = p.flak ? this.cFlak : this.cBullet; }
        _m.compose(p.pos, _q, _s.set(w, w, len));
        this.tracers.setMatrixAt(nt, _m);
        this.tracers.setColorAt(nt, c);
        nt++;
      }
    }
    this.tracers.count = nt; this.bombs.count = nb; this.torps.count = nt2;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
    this.bombs.instanceMatrix.needsUpdate = true;
    this.torps.instanceMatrix.needsUpdate = true;
  }
}
