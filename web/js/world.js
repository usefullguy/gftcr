import * as THREE from 'three';
import { fbm, mulberry32 } from './util.js';

export const MAP_HALF = 3800;
export const SUN_DIR = new THREE.Vector3(-0.45, 0.6, -0.66).normalize();
export const HORIZON = 0xc6d8e6;

const WAVES = [
  [1.1, 0.021, 0.0, 0.9],
  [0.8, 0.006, 0.027, -1.1],
  [0.5, 0.045, 0.045, 1.7],
];

export function waveHeight(x, z, t) {
  let h = 0;
  for (const [a, kx, kz, w] of WAVES) h += a * Math.sin(x * kx + z * kz + t * w);
  return h;
}

// Fest platzierte Inseln, Zonen bei x = -1600, 0, 1600 auf z = 0 bleiben frei.
const ISLANDS = [
  { x: -800, z: -700, r: 430, h: 150 },
  { x: 900, z: 650, r: 380, h: 110 },
  { x: -2300, z: 950, r: 560, h: 210 },
  { x: 2250, z: -1050, r: 520, h: 180 },
  { x: 350, z: -1650, r: 300, h: 80 },
  { x: -450, z: 1500, r: 280, h: 70 },
  { x: 2850, z: 1850, r: 360, h: 120 },
  { x: -2900, z: -1950, r: 460, h: 165 },
  { x: 1700, z: 2600, r: 220, h: 55 },
  { x: -1500, z: -2700, r: 240, h: 60 },
];

function islandHeight(is, dx, dz) {
  const d = Math.sqrt(dx * dx + dz * dz) / is.r;
  if (d >= 1) return -40;
  const n = fbm((is.x + dx) * 0.0045 + is.seed, (is.z + dz) * 0.0045);
  const shape = Math.pow(1 - d, 1.6);
  return is.h * shape * (0.55 + 0.8 * n) - 18 * d * d + 6;
}

export class World {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.time = 0;
    this.seaTime = { value: 0 };
    this.islands = ISLANDS.map((o, i) => ({ ...o, seed: i * 13.7 }));
    this.buildSky();
    this.buildLights();
    this.buildSea();
    this.buildIslands();
    this.buildClouds();
  }

  heightAt(x, z) {
    let h = -40;
    for (const is of this.islands) {
      const dx = x - is.x, dz = z - is.z;
      if (dx * dx + dz * dz < is.r * is.r) {
        const v = islandHeight(is, dx, dz);
        if (v > h) h = v;
      }
    }
    return h;
  }

  // Boden- bzw. Wasserhöhe für Kollisionen
  groundAt(x, z) {
    return Math.max(0, this.heightAt(x, z));
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2c6cb8) },
        horizon: { value: new THREE.Color(HORIZON) },
        sunDir: { value: SUN_DIR },
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(horizon, top, pow(h, 0.5));
          if (d.y < 0.0) col = horizon * 0.95;
          float s = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.92, 0.75) * pow(s, 900.0) * 3.0 + vec3(1.0, 0.85, 0.6) * pow(s, 10.0) * 0.22;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(HORIZON, 1800, 11000);
    this.scene.background = new THREE.Color(HORIZON);
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xd6e8ff, 0x35566e, 1.25);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(1500);
    if (this.quality !== 'niedrig') {
      sun.castShadow = true;
      const size = this.quality === 'hoch' ? 2048 : 1024;
      sun.shadow.mapSize.set(size, size);
      const c = sun.shadow.camera;
      c.left = -260; c.right = 260; c.top = 260; c.bottom = -260; c.near = 10; c.far = 3500;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
    }
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  buildSea() {
    const size = 7000, seg = this.quality === 'niedrig' ? 120 : 180;
    this.seaCell = size / seg;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1d5a80, roughness: 0.55, metalness: 0.0, flatShading: true });
    const seaTime = this.seaTime;
    const half = size / 2;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = seaTime;
      sh.uniforms.uHalf = { value: half };
      const waves = WAVES.map(([a, kx, kz, w]) => `${a.toFixed(3)}*sin(wp.x*${kx.toFixed(4)}+wp.z*${kz.toFixed(4)}+uTime*${w.toFixed(2)})`).join('+');
      sh.vertexShader = 'uniform float uTime;\nuniform float uHalf;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
         vec4 wp = modelMatrix * vec4(position, 1.0);
         float fade = 1.0 - smoothstep(uHalf * 0.7, uHalf, max(abs(position.x), abs(position.z)));
         transformed.y += fade * (${waves});`
      );
    };
    this.sea = new THREE.Mesh(geo, mat);
    this.sea.receiveShadow = this.quality === 'hoch';
    this.sea.frustumCulled = false;
    this.scene.add(this.sea);

    const far = new THREE.Mesh(
      new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1d5a80, roughness: 0.5 })
    );
    far.position.y = -3.5;
    this.scene.add(far);
  }

  buildIslands() {
    const rng = mulberry32(42);
    const colSand = new THREE.Color(0xd6c38c), colWetSand = new THREE.Color(0xb3a273);
    const colGrass = new THREE.Color(0x5e8d3d), colGrass2 = new THREE.Color(0x6f9c46);
    const colForest = new THREE.Color(0x45703a), colRock = new THREE.Color(0x857f72), colRock2 = new THREE.Color(0x9a9487);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
    const treeSpots = [];
    const houseSpots = [];

    for (const is of this.islands) {
      const seg = Math.round(is.r / 14);
      let geo = new THREE.PlaneGeometry(is.r * 2, is.r * 2, seg, seg);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        pos.setY(i, islandHeight(is, x, z));
      }
      geo = geo.toNonIndexed();
      const p = geo.attributes.position;
      const colors = new Float32Array(p.count * 3);
      const c = new THREE.Color();
      const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 3) {
        a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); cc.fromBufferAttribute(p, i + 2);
        const y = (a.y + b.y + cc.y) / 3;
        n.subVectors(b, a).cross(cc.clone().sub(a)).normalize();
        const slope = 1 - Math.abs(n.y);
        const r = rng();
        if (y < 1.5) c.copy(colWetSand);
        else if (y < 6) c.copy(colSand);
        else if (slope > 0.45 || y > is.h * 0.7) c.copy(r > 0.5 ? colRock : colRock2);
        else if (y > is.h * 0.35) c.copy(colForest);
        else c.copy(r > 0.5 ? colGrass : colGrass2);
        for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.deleteAttribute('uv');
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(is.x, 0, is.z);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);

      const trees = Math.round(is.r * (this.quality === 'niedrig' ? 0.35 : 0.8));
      for (let t = 0, placed = 0; t < trees * 3 && placed < trees && treeSpots.length < 6000; t++) {
        const ang = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * is.r * 0.85;
        const x = is.x + Math.cos(ang) * rad, z = is.z + Math.sin(ang) * rad;
        const y = this.heightAt(x, z);
        if (y < 8 || y > is.h * 0.6) continue;
        const slope = Math.abs(this.heightAt(x + 4, z) - y) + Math.abs(this.heightAt(x, z + 4) - y);
        if (slope > 4) continue;
        treeSpots.push([x, y, z, 0.7 + rng() * 0.7]);
        placed++;
      }
      for (let hcount = 0, t = 0; t < 60 && hcount < Math.round(is.r / 90); t++) {
        const ang = rng() * Math.PI * 2, rad = is.r * (0.55 + rng() * 0.25);
        const x = is.x + Math.cos(ang) * rad, z = is.z + Math.sin(ang) * rad;
        const y = this.heightAt(x, z);
        if (y < 5 || y > 25) continue;
        houseSpots.push([x, y, z, rng() * Math.PI]);
        hcount++;
      }
    }

    // Bäume: zwei Kegel übereinander, instanziert
    const treeGeo = new THREE.ConeGeometry(4.5, 11, 6);
    treeGeo.translate(0, 7, 0);
    const treeMat = new THREE.MeshLambertMaterial({ color: 0x3e6b33, flatShading: true });
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeSpots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    treeSpots.forEach(([x, y, z, sc], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), x * 0.13);
      m.compose(v.set(x, y - 1, z), q, s.set(sc, sc * (0.8 + (i % 5) * 0.12), sc));
      trees.setMatrixAt(i, m);
    });
    trees.castShadow = true;
    this.scene.add(trees);

    const houseGeo = new THREE.BoxGeometry(10, 6, 14);
    houseGeo.translate(0, 3, 0);
    const roofGeo = new THREE.CylinderGeometry(0.01, 8, 5, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale(1, 1, 1.4);
    roofGeo.translate(0, 8.5, 0);
    const houses = new THREE.InstancedMesh(houseGeo, new THREE.MeshLambertMaterial({ color: 0xe8e2d4, flatShading: true }), houseSpots.length);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xa4452f, flatShading: true }), houseSpots.length);
    houseSpots.forEach(([x, y, z, r], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r);
      m.compose(v.set(x, y - 1.5, z), q, s.set(1, 1, 1));
      houses.setMatrixAt(i, m); roofs.setMatrixAt(i, m);
    });
    houses.castShadow = roofs.castShadow = true;
    this.scene.add(houses, roofs);
  }

  buildClouds() {
    const rng = mulberry32(7);
    const clusters = this.quality === 'niedrig' ? 30 : 60;
    const boxes = [];
    for (let c = 0; c < clusters; c++) {
      const cx = (rng() * 2 - 1) * 5000, cz = (rng() * 2 - 1) * 5000, cy = 750 + rng() * 650;
      const n = 5 + Math.floor(rng() * 9);
      for (let i = 0; i < n; i++) {
        boxes.push([
          cx + (rng() * 2 - 1) * 160, cy + (rng() * 2 - 1) * 25, cz + (rng() * 2 - 1) * 110,
          60 + rng() * 110, 22 + rng() * 34, 50 + rng() * 100,
        ]);
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x6d7884, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, boxes.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    boxes.forEach(([x, y, z, w, h, d], i) => {
      m.compose(v.set(x, y, z), q, s.set(w, h, d));
      mesh.setMatrixAt(i, m);
    });
    this.scene.add(mesh);
  }

  update(dt, focus, camera) {
    this.time += dt;
    this.seaTime.value = this.time;
    const c = this.seaCell;
    this.sea.position.set(Math.round(camera.position.x / c) * c, 0, Math.round(camera.position.z / c) * c);
    this.sky.position.copy(camera.position);
    if (this.sun.castShadow) {
      this.sun.target.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(SUN_DIR, 1500);
    }
  }
}
