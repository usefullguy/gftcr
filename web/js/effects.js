import * as THREE from 'three';
import { rand } from './util.js?v=11';

const ROTS = Array.from({ length: 32 }, () =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3))));
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

class Pool {
  constructor(scene, geo, mat, max, yScale = 1) {
    this.max = max;
    this.yScale = yScale;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max * 2);
    this.col = new Float32Array(max * 6);
    this.phys = new Float32Array(max * 2); // drag, gravity
    this.rot = new Uint8Array(max);
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag = 0, grav = 0) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = life;
    this.size[i * 2] = s0; this.size[i * 2 + 1] = s1;
    this.col[i * 6] = c0.r; this.col[i * 6 + 1] = c0.g; this.col[i * 6 + 2] = c0.b;
    this.col[i * 6 + 3] = c1.r; this.col[i * 6 + 4] = c1.g; this.col[i * 6 + 5] = c1.b;
    this.phys[i * 2] = drag; this.phys[i * 2 + 1] = grav;
    this.rot[i] = (Math.random() * ROTS.length) | 0;
  }

  move(from, to) {
    this.pos.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.vel.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.size.copyWithin(to * 2, from * 2, from * 2 + 2);
    this.col.copyWithin(to * 6, from * 6, from * 6 + 6);
    this.phys.copyWithin(to * 2, from * 2, from * 2 + 2);
    this.rot[to] = this.rot[from];
  }

  update(dt) {
    let i = 0;
    const mesh = this.mesh;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.move(this.n - 1, i); this.n--; continue; }
      const k = i * 3;
      const drag = Math.max(0, 1 - this.phys[i * 2] * dt);
      this.vel[k] *= drag; this.vel[k + 1] = this.vel[k + 1] * drag - this.phys[i * 2 + 1] * dt; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const sc = this.size[i * 2] + (this.size[i * 2 + 1] - this.size[i * 2]) * t;
      _p.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]);
      _s.setScalar(Math.max(sc, 0.001));
      _s.y *= this.yScale;
      _m.compose(_p, ROTS[this.rot[i]], _s);
      mesh.setMatrixAt(i, _m);
      const c = i * 6;
      mesh.instanceColor.setXYZ(i,
        this.col[c] + (this.col[c + 3] - this.col[c]) * t,
        this.col[c + 1] + (this.col[c + 4] - this.col[c + 1]) * t,
        this.col[c + 2] + (this.col[c + 5] - this.col[c + 2]) * t);
      i++;
    }
    mesh.count = this.n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; }
}

const C = (h) => new THREE.Color(h);
// Feuerfarben liegen über 1.0, damit der Bloom-Effekt sie leuchten lässt
const FIRE_A = C(0xfff3b0).multiplyScalar(6), FIRE_B = C(0xff7a1a).multiplyScalar(3.2), FIRE_C = C(0xc0300c).multiplyScalar(1.4), EMBER = C(0xff6a20).multiplyScalar(2.2);
const SMOKE_D = C(0x2a2826), SMOKE_G = C(0x6e6a66), SMOKE_L = C(0xa8a6a2);
const DUST = C(0xa89c80), DUST2 = C(0x8b8470);
const WHITE = C(0xf4f8fb), FOAM = C(0xd9e8ef), SEA = C(0x8fb9cf);

export class Effects {
  constructor(scene, quality) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const scale = quality === 'niedrig' ? 0.5 : 1;
    this.fire = new Pool(scene, geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.round(2500 * scale));
    this.smoke = new Pool(scene, geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), Math.round(3500 * scale));
    this.spray = new Pool(scene, geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x334455 }), Math.round(3500 * scale));
    this.foam = new Pool(scene, geo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x2a3a48 }), Math.round(2500 * scale), 0.22);
    this.density = scale;

    // Kurze Lichtblitze bei Explosionen. Feste Anzahl, damit sich die Shader nicht neu kompilieren.
    this.lights = [];
    const nLights = quality === 'hoch' ? 3 : quality === 'mittel' ? 1 : 0;
    for (let i = 0; i < nLights; i++) {
      const l = new THREE.PointLight(0xffa860, 0, 100, 2);
      scene.add(l);
      this.lights.push({ l, t: 0, max: 1, i0: 0 });
    }

    // Druckwellen-Ringe auf dem Wasser
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, t: 0, max: 1, r: 1 });
    }
    this.ringIdx = 0;
  }

  flash(p, size) {
    if (!this.lights.length) return;
    let best = this.lights[0];
    for (const L of this.lights) if (L.t < best.t) best = L;
    best.l.position.set(p.x, p.y + 3, p.z);
    best.l.distance = 80 + 60 * size;
    best.i0 = 4000 * size;
    best.t = best.max = 0.25 + 0.12 * size;
  }

  ring(p, size, color = 0xffffff) {
    const R = this.rings[this.ringIdx++ % this.rings.length];
    R.m.position.set(p.x, 0.8, p.z);
    R.m.material.color.set(color);
    R.t = R.max = 0.9 + size * 0.15;
    R.r = 10 + size * 14;
    R.m.visible = true;
  }

  n(x) { return Math.max(1, Math.round(x * this.density)); }

  explosion(p, size = 1) {
    const s = size;
    this.flash(p, s);
    if (this.onBlast) this.onBlast(p, s);
    if (s >= 1.5 && p.y < 12) this.ring(p, s);
    for (let i = 0; i < this.n(14 * Math.sqrt(s)); i++) {
      const v = 18 * s;
      this.fire.spawn(p.x, p.y, p.z, rand(-v, v), rand(-v * 0.5, v), rand(-v, v), rand(0.35, 0.8), rand(1.5, 3) * s, 0.2, FIRE_A, FIRE_C, 3, -4);
    }
    for (let i = 0; i < this.n(12 * Math.sqrt(s)); i++) {
      const v = 9 * s;
      this.smoke.spawn(p.x, p.y, p.z, rand(-v, v), rand(0, v), rand(-v, v), rand(2, 4.5), rand(1.5, 3) * s, rand(4, 7) * s, SMOKE_D, SMOKE_G, 1.2, -2.5);
    }
    for (let i = 0; i < this.n(8 * Math.sqrt(s)); i++) {
      const v = 30 * s;
      this.fire.spawn(p.x, p.y, p.z, rand(-v, v), rand(5, v * 1.2), rand(-v, v), rand(0.8, 1.6), 0.4 * s, 0.25 * s, FIRE_B, EMBER, 0.3, 25);
    }
  }

  splash(p, size = 1) {
    if (size >= 2) this.ring(p, size * 0.5, 0xe8f4fa);
    for (let i = 0; i < this.n(10 * size); i++) {
      const v = 3.5 * size;
      this.spray.spawn(p.x + rand(-v, v), 0.3, p.z + rand(-v, v), rand(-v, v), rand(14, 26) * Math.sqrt(size), rand(-v, v),
        rand(1.0, 1.8), rand(1.0, 2.0) * size, 0.3 * size, WHITE, FOAM, 0.4, 22);
    }
    for (let i = 0; i < this.n(5 * size); i++) {
      this.foam.spawn(p.x + rand(-4, 4) * size, 0.3, p.z + rand(-4, 4) * size, rand(-3, 3), 0, rand(-3, 3),
        rand(2.5, 4), 2.0 * size, 4.5 * size, FOAM, SEA, 0.8, 0);
    }
  }

  smallSplash(p) {
    this.spray.spawn(p.x, 0.3, p.z, rand(-1, 1), rand(6, 10), rand(-1, 1), 0.7, 0.6, 0.2, WHITE, FOAM, 0.3, 20);
  }

  impact(p, size = 1) {
    for (let i = 0; i < this.n(4); i++) this.fire.spawn(p.x, p.y, p.z, rand(-8, 8), rand(-2, 10), rand(-8, 8), 0.25, 0.6 * size, 0.1, FIRE_A, FIRE_B, 2, 0);
    this.smoke.spawn(p.x, p.y, p.z, rand(-2, 2), rand(1, 3), rand(-2, 2), 1.2, 0.8 * size, 2.5 * size, SMOKE_G, SMOKE_L, 1, -1);
  }

  muzzle(p, dir, size = 1) {
    this.fire.spawn(p.x + dir.x * size, p.y + dir.y * size, p.z + dir.z * size, dir.x * 6, dir.y * 6, dir.z * 6, 0.07, 0.7 * size, 0.2 * size, FIRE_A, FIRE_B);
  }

  cannonBlast(p, dir, size) {
    for (let i = 0; i < 3; i++) {
      this.fire.spawn(p.x, p.y, p.z, dir.x * 25 * (i + 1) + rand(-3, 3), dir.y * 25 * (i + 1) + rand(-3, 3), dir.z * 25 * (i + 1) + rand(-3, 3), 0.15, 1.6 * size, 0.4 * size, FIRE_A, FIRE_B, 6);
    }
    for (let i = 0; i < this.n(4); i++) {
      this.smoke.spawn(p.x, p.y, p.z, dir.x * 15 + rand(-3, 3), dir.y * 15 + rand(0, 3), dir.z * 15 + rand(-3, 3), rand(1.5, 2.5), 1.5 * size, 5 * size, SMOKE_L, SMOKE_G, 2, -1);
    }
  }

  // Dauerbrand auf beschädigten Fahrzeugen
  burn(p, size, vel) {
    const vx = vel ? vel.x * 0.15 : 0, vz = vel ? vel.z * 0.15 : 0;
    this.fire.spawn(p.x + rand(-1, 1) * size, p.y, p.z + rand(-1, 1) * size, vx + rand(-1, 1), rand(2, 6), vz + rand(-1, 1), rand(0.3, 0.6), size * rand(0.8, 1.4), 0.15, FIRE_A, FIRE_C, 1, -6);
    this.smoke.spawn(p.x, p.y + size, p.z, vx + rand(-1, 1), rand(4, 8), vz + rand(-1, 1), rand(2.5, 4.5), size, size * 4, SMOKE_D, SMOKE_G, 0.6, -1);
  }

  trail(p, dark = false, size = 1) {
    this.smoke.spawn(p.x, p.y, p.z, rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5), dark ? 2.5 : 1.0, 0.6 * size, (dark ? 2.6 : 1.6) * size, dark ? SMOKE_D : SMOKE_L, SMOKE_G, 0.5, -0.5);
  }

  dust(p, size) {
    this.smoke.spawn(p.x + rand(-0.5, 0.5), p.y, p.z + rand(-0.5, 0.5), rand(-1, 1), rand(0.5, 2), rand(-1, 1), rand(1.2, 2.2), size, size * 3, DUST, DUST2, 1.5, -0.3);
  }

  wake(p, size) {
    this.foam.spawn(p.x + rand(-1, 1) * size, 0.6, p.z + rand(-1, 1) * size, rand(-1, 1), 0, rand(-1, 1), rand(3, 6), size * 0.7, size * 2.2, FOAM, SEA, 0.4, 0);
  }

  update(dt) {
    this.fire.update(dt);
    this.smoke.update(dt);
    this.spray.update(dt);
    this.foam.update(dt);
    for (const L of this.lights) {
      L.t = Math.max(0, L.t - dt);
      const k = L.t / L.max;
      L.l.intensity = L.i0 * k * k;
    }
    for (const R of this.rings) {
      if (!R.m.visible) continue;
      R.t -= dt;
      if (R.t <= 0) { R.m.visible = false; continue; }
      const k = 1 - R.t / R.max;
      const e = 1 - Math.pow(1 - k, 3);
      R.m.scale.setScalar(2 + R.r * e);
      R.m.material.opacity = 0.55 * (1 - k);
    }
  }

  clear() {
    this.fire.clear(); this.smoke.clear(); this.spray.clear(); this.foam.clear();
    for (const L of this.lights) { L.t = 0; L.l.intensity = 0; }
    for (const R of this.rings) R.m.visible = false;
  }
}
