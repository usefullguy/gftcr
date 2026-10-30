import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js?v=9';

// Alle Fahrzeuge schauen nach -Z, rechts ist +X, oben +Y.

export const vehicleMat = new THREE.MeshStandardMaterial({
  vertexColors: true, flatShading: true, roughness: 0.78, metalness: 0.12,
});

export const TEAM_COLORS = [0x2f6fd6, 0xc8372d];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

function colorize(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

class Builder {
  constructor() { this.parts = []; }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    geo.applyMatrix4(_m);
    geo.deleteAttribute('uv');
    colorize(geo, color);
    this.parts.push(geo);
    return this;
  }
  box(w, h, d, color, x, y, z, rx, ry, rz) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }
  cyl(rt, rb, h, seg, color, x, y, z, rx, ry, rz) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
  }
  // Längs (Z) verlaufender Quader, dessen Front (-Z) und Heck (+Z) unterschiedlich groß sind.
  wedge(wF, hF, wB, hB, len, color, x, y, z, yF = 0, yB = 0) {
    const g = new THREE.BoxGeometry(1, 1, len);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const front = pos.getZ(i) < 0;
      pos.setX(i, pos.getX(i) * (front ? wF : wB));
      pos.setY(i, pos.getY(i) * (front ? hF : hB) + (front ? yF : yB));
    }
    g.computeVertexNormals();
    return this.add(g, color, x, y, z);
  }
  build() {
    const g = mergeGeometries(this.parts);
    g.computeBoundingSphere();
    return g;
  }
  mesh() {
    const m = new THREE.Mesh(this.build(), vehicleMat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

function propeller(radius, color = 0x2a2a2a) {
  const b = new Builder();
  b.box(0.18, radius * 2, 0.08, color, 0, 0, 0);
  b.box(radius * 2, 0.18, 0.08, color, 0, 0, 0);
  b.cyl(0.0, 0.32, 0.7, 6, 0xd9d4c4, 0, 0, -0.3, -Math.PI / 2);
  return b.mesh();
}

// ---------- Flugzeuge ----------

function buildFalke(team) {
  const top = 0x6b7a58, belly = 0x9db0bb, dark = 0x2d3230, tc = TEAM_COLORS[team];
  const b = new Builder();
  b.box(1.25, 1.35, 4.6, top, 0, 0, 0.2);
  b.box(1.2, 0.4, 4.6, belly, 0, -0.62, 0.2);
  b.wedge(1.0, 1.05, 1.25, 1.35, 1.6, top, 0, 0, -2.9);
  b.cyl(0.62, 0.66, 0.6, 8, dark, 0, 0, -3.95, Math.PI / 2);
  b.wedge(1.25, 1.35, 0.35, 0.55, 3.6, top, 0, 0, 4.3, 0, 0.25);
  b.box(0.82, 0.55, 1.5, 0x8fc3dc, 0, 0.88, -0.4);
  b.box(0.86, 0.12, 0.12, dark, 0, 1.12, -0.4);
  b.wedge(0.82, 0.55, 0.3, 0.3, 1.4, top, 0, 0.82, 1.0);
  // Flügel mit spitz zulaufenden Enden
  b.box(7.2, 0.24, 1.9, top, 0, -0.4, -0.5);
  b.box(7.2, 0.08, 1.9, belly, 0, -0.55, -0.5);
  for (const s of [-1, 1]) {
    b.wedge(1.5, 0.22, 1.9, 0.24, 2.2, top, s * 4.6, -0.4, -0.5);
    b.box(1.4, 0.26, 1.3, tc, s * 3.4, -0.36, -0.5);
    b.box(0.12, 0.12, 0.9, dark, s * 2.1, -0.45, -1.8);
  }
  b.box(3.9, 0.15, 1.0, top, 0, 0.2, 5.4);
  b.box(0.15, 1.7, 1.25, top, 0, 1.0, 5.5);
  b.box(0.17, 0.5, 0.6, tc, 0, 1.4, 5.55);
  const mesh = b.mesh();
  const prop = propeller(1.45);
  prop.position.set(0, 0, -4.3);
  mesh.add(prop);
  return { mesh, props: [prop] };
}

function buildHabicht(team) {
  const top = 0x4f5a63, belly = 0x8c99a3, dark = 0x24292c, tc = TEAM_COLORS[team];
  const b = new Builder();
  b.box(1.4, 1.5, 6.0, top, 0, 0, -0.2);
  b.box(1.3, 0.4, 6.0, belly, 0, -0.65, -0.2);
  b.wedge(0.7, 0.8, 1.4, 1.5, 1.8, top, 0, -0.1, -4.1);
  b.box(0.9, 0.6, 2.6, 0x8fc3dc, 0, 0.95, -1.0);
  b.wedge(0.5, 0.25, 1.4, 1.5, 0.6, dark, 0, -0.05, -5.05);
  b.wedge(1.4, 1.5, 0.4, 0.6, 3.6, top, 0, 0, 4.6, 0, 0.3);
  b.box(13.5, 0.26, 2.2, top, 0, -0.3, -0.6);
  b.box(13.5, 0.08, 2.2, belly, 0, -0.46, -0.6);
  for (const s of [-1, 1]) {
    // Motorgondeln
    b.box(1.15, 1.15, 4.6, top, s * 3.1, -0.3, -0.6);
    b.cyl(0.6, 0.62, 0.5, 8, dark, s * 3.1, -0.3, -3.1, Math.PI / 2);
    b.wedge(1.15, 1.15, 0.4, 0.5, 1.4, top, s * 3.1, -0.25, 2.3);
    b.box(1.4, 0.28, 1.5, tc, s * 5.4, -0.26, -0.6);
    b.box(0.14, 0.14, 1.2, dark, s * 0.45, -0.5, -5.2);
  }
  b.box(5.0, 0.15, 1.2, top, 0, 0.25, 6.0);
  for (const s of [-1, 1]) b.box(0.15, 1.6, 1.3, top, s * 2.4, 0.8, 6.1);
  b.box(0.6, 0.2, 0.5, tc, 0, 0.35, 6.0);
  const mesh = b.mesh();
  const props = [];
  for (const s of [-1, 1]) {
    const p = propeller(1.3);
    p.position.set(s * 3.1, -0.3, -3.4);
    mesh.add(p); props.push(p);
  }
  return { mesh, props };
}

function buildBussard(team) {
  const top = 0x857a52, belly = 0xa7aa9a, dark = 0x2e2b25, tc = TEAM_COLORS[team];
  const b = new Builder();
  b.box(1.5, 1.6, 5.6, top, 0, 0, 0);
  b.box(1.4, 0.4, 5.6, belly, 0, -0.7, 0);
  b.wedge(1.2, 1.2, 1.5, 1.6, 1.6, top, 0, 0, -3.6);
  b.cyl(0.72, 0.76, 0.7, 8, dark, 0, 0, -4.7, Math.PI / 2);
  b.wedge(1.5, 1.6, 0.4, 0.6, 4.2, top, 0, 0.05, 4.9, 0, 0.3);
  b.box(0.95, 0.65, 3.4, 0x8fc3dc, 0, 1.0, -0.2);
  b.box(15.0, 0.28, 2.4, top, 0, -0.5, -0.4);
  b.box(15.0, 0.08, 2.4, belly, 0, -0.66, -0.4);
  for (const s of [-1, 1]) {
    b.wedge(1.9, 0.26, 2.4, 0.28, 2.0, top, s * 8.4, -0.5, -0.4);
    b.box(1.6, 0.3, 1.6, tc, s * 6.0, -0.46, -0.4);
    // festes Fahrwerk
    b.box(0.3, 1.4, 0.5, dark, s * 1.7, -1.3, -1.2);
    b.box(0.35, 0.7, 0.9, dark, s * 1.7, -2.0, -1.2);
  }
  // Bombenhalter
  b.box(0.4, 0.3, 2.2, dark, 0, -1.05, -0.4);
  b.box(4.6, 0.16, 1.3, top, 0, 0.25, 6.2);
  b.box(0.16, 1.9, 1.5, top, 0, 1.1, 6.3);
  b.box(0.18, 0.55, 0.7, tc, 0, 1.55, 6.35);
  b.box(0.12, 0.12, 1.2, dark, 0, 1.25, 1.8);
  const mesh = b.mesh();
  const prop = propeller(1.7);
  prop.position.set(0, 0, -5.1);
  mesh.add(prop);
  return { mesh, props: [prop] };
}

// ---------- Schiffe ----------

const HULL = 0x6c737a, HULL_DARK = 0x4b5157, DECK = 0x7d6a52, SUPER = 0xa3a9ae, BOOT = 0x2b2d30, RED = 0x7a2c25;

function hull(b, len, beam, draft, free, bowLen, team) {
  const mainLen = len - bowLen;
  const zMain = bowLen / 2;
  b.box(beam, draft + free, mainLen, HULL, 0, (free - draft) / 2, zMain);
  b.box(beam * 0.9, draft * 0.6, mainLen, RED, 0, -draft * 0.65, zMain);
  b.box(beam + 0.06, 0.5, mainLen, BOOT, 0, 0.1, zMain);
  b.wedge(0.5, draft + free + 1.2, beam, draft + free, bowLen, HULL, 0, (free - draft) / 2, -mainLen / 2 + zMain - bowLen / 2, 0.6, 0);
  b.wedge(0.5, 0.5, beam + 0.06, 0.5, bowLen, BOOT, 0, 0.1, -mainLen / 2 + zMain - bowLen / 2);
  // Deck
  b.box(beam * 0.92, 0.12, mainLen * 0.98, DECK, 0, free + 0.02, zMain);
  b.wedge(0.3, 0.12, beam * 0.92, 0.12, bowLen * 0.96, DECK, 0, free + 0.02, -mainLen / 2 + zMain - bowLen / 2, 0.6, 0);
  // Teamstreifen am Rumpf
  for (const s of [-1, 1]) b.box(0.1, 0.8, len * 0.08, TEAM_COLORS[team], s * (beam / 2 + 0.03), free * 0.55, -len * 0.25);
}

function turretMesh(cal) {
  const sizes = {
    '40': { w: 1.3, h: 0.9, d: 1.4, bl: 2.6, br: 0.12, n: 1, sp: 0 },
    '120': { w: 3.2, h: 1.9, d: 4.0, bl: 5.5, br: 0.2, n: 2, sp: 0.75 },
    '203': { w: 6.0, h: 2.8, d: 7.0, bl: 9.5, br: 0.32, n: 3, sp: 1.25 },
  }[cal];
  const yawObj = new THREE.Group();
  const hb = new Builder();
  hb.cyl(sizes.w * 0.55, sizes.w * 0.6, 0.4, 10, HULL_DARK, 0, 0.2, 0);
  hb.wedge(sizes.w * 0.85, sizes.h * 0.9, sizes.w, sizes.h, sizes.d, SUPER, 0, sizes.h / 2 + 0.3, 0.2);
  yawObj.add(hb.mesh());
  const pitchObj = new THREE.Group();
  pitchObj.position.set(0, sizes.h * 0.55 + 0.3, -sizes.d * 0.3);
  const bb = new Builder();
  for (let i = 0; i < sizes.n; i++) {
    const x = (i - (sizes.n - 1) / 2) * sizes.sp;
    bb.cyl(sizes.br * 0.8, sizes.br, sizes.bl, 6, HULL_DARK, x, 0, -sizes.bl / 2, -Math.PI / 2);
  }
  pitchObj.add(bb.mesh());
  yawObj.add(pitchObj);
  return { yawObj, pitchObj, barrelLen: sizes.bl, barrels: sizes.n, spacing: sizes.sp };
}

function funnel(b, r, h, x, y, z) {
  b.cyl(r, r * 1.08, h, 8, SUPER, x, y + h / 2, z);
  b.cyl(r * 1.02, r * 1.02, h * 0.15, 8, BOOT, x, y + h * 0.94, z);
}

function buildSchnellboot(team) {
  const b = new Builder();
  hull(b, 32, 5.6, 1.3, 1.5, 11, team);
  b.box(3.2, 1.8, 6.0, SUPER, 0, 2.4, -1.0);
  b.box(3.0, 1.0, 2.2, 0x2f3a45, 0, 3.7, -2.6);
  b.box(2.8, 0.15, 3.0, SUPER, 0, 4.25, -2.0);
  b.box(0.18, 4.0, 0.18, HULL_DARK, 0, 5.5, 0.4);
  b.box(2.0, 0.12, 0.12, HULL_DARK, 0, 6.6, 0.4);
  for (const s of [-1, 1]) {
    b.cyl(0.42, 0.42, 7.0, 8, 0x55605a, s * 2.05, 2.05, 6.0, Math.PI / 2);
    b.cyl(0.46, 0.46, 0.4, 8, BOOT, s * 2.05, 2.05, 2.6, Math.PI / 2);
  }
  const mesh = b.mesh();
  return { mesh, turretDefs: [{ cal: '40', pos: [0, 1.6, -8.5], rest: 0, arc: 2.6 }, { cal: '40', pos: [0, 1.6, 11.5], rest: Math.PI, arc: 2.4 }] };
}

function buildZerstoerer(team) {
  const b = new Builder();
  hull(b, 100, 10.5, 3.2, 3.4, 30, team);
  b.box(7.5, 3.0, 16, SUPER, 0, 4.9, -10);
  b.box(6.5, 2.4, 6, SUPER, 0, 7.6, -14);
  b.box(6.6, 1.0, 1.6, 0x2f3a45, 0, 8.4, -16.8);
  b.box(8.5, 0.2, 3, SUPER, 0, 9.0, -15);
  b.box(0.35, 12, 0.35, HULL_DARK, 0, 14, -10);
  b.box(4.0, 0.2, 0.2, HULL_DARK, 0, 16.5, -10);
  funnel(b, 1.5, 6, 0, 6.2, 0);
  funnel(b, 1.4, 5.5, 0, 6.2, 9);
  b.box(6.5, 2.8, 8, SUPER, 0, 4.8, 22);
  // Torpedorohre
  b.box(2.0, 1.0, 1.6, HULL_DARK, 0, 3.9, 15);
  b.cyl(0.38, 0.38, 6, 8, 0x55605a, -0.55, 4.5, 15, Math.PI / 2);
  b.cyl(0.38, 0.38, 6, 8, 0x55605a, 0.55, 4.5, 15, Math.PI / 2);
  b.box(1.6, 0.6, 1.6, HULL_DARK, 4.2, 3.7, 4);
  b.box(1.6, 0.6, 1.6, HULL_DARK, -4.2, 3.7, 4);
  const mesh = b.mesh();
  return {
    mesh,
    turretDefs: [
      { cal: '120', pos: [0, 3.5, -33], rest: 0, arc: 2.5 },
      { cal: '120', pos: [0, 6.3, -23.5], rest: 0, arc: 2.4 },
      { cal: '120', pos: [0, 6.2, 29.5], rest: Math.PI, arc: 2.4 },
      { cal: '120', pos: [0, 3.5, 38], rest: Math.PI, arc: 2.5 },
    ],
  };
}

function buildKreuzer(team) {
  const b = new Builder();
  hull(b, 160, 17, 5.5, 5.5, 44, team);
  b.box(13, 4.5, 30, SUPER, 0, 7.8, -12);
  b.box(10, 4, 14, SUPER, 0, 12, -18);
  b.box(8, 3.5, 7, SUPER, 0, 15.7, -21);
  b.box(8.2, 1.2, 2.2, 0x2f3a45, 0, 16.8, -24.4);
  b.box(12, 0.25, 4, SUPER, 0, 17.6, -22);
  b.box(0.6, 18, 0.6, HULL_DARK, 0, 25, -15);
  b.box(7, 0.3, 0.3, HULL_DARK, 0, 30, -15);
  b.box(5, 0.3, 0.3, HULL_DARK, 0, 27, -15);
  funnel(b, 2.6, 9, 0, 10, 0);
  funnel(b, 2.4, 8.5, 0, 10, 13);
  b.box(10, 4.5, 14, SUPER, 0, 7.8, 28);
  b.box(0.5, 12, 0.5, HULL_DARK, 0, 16, 30);
  for (const s of [-1, 1]) {
    b.box(2.4, 1.0, 2.4, HULL_DARK, s * 7.0, 6.2, -2);
    b.box(2.4, 1.0, 2.4, HULL_DARK, s * 7.0, 6.2, 8);
    b.box(1.8, 2.0, 4.0, 0x8b9297, s * 7.0, 7.5, 18);
  }
  const mesh = b.mesh();
  return {
    mesh,
    turretDefs: [
      { cal: '203', pos: [0, 5.6, -52], rest: 0, arc: 2.5 },
      { cal: '203', pos: [0, 10.2, -39], rest: 0, arc: 2.4 },
      { cal: '203', pos: [0, 10.2, 44], rest: Math.PI, arc: 2.4 },
      { cal: '203', pos: [0, 5.6, 57], rest: Math.PI, arc: 2.5 },
    ],
  };
}

const BUILDERS = {
  falke: buildFalke, habicht: buildHabicht, bussard: buildBussard,
  schnellboot: buildSchnellboot, zerstoerer: buildZerstoerer, kreuzer: buildKreuzer,
};

// Geometrie wird pro Typ und Team gecacht, Meshes werden geteilt.
const cache = new Map();

export function buildModel(id, team) {
  const key = id + team;
  if (!cache.has(key)) cache.set(key, BUILDERS[id](team));
  const tpl = cache.get(key);
  const mesh = tpl.mesh.clone(true);
  const out = { mesh, props: [], turrets: [] };
  if (tpl.props) {
    // Props sind Kinder des Rumpfs, in derselben Reihenfolge wie im Template
    let k = 0;
    mesh.children.forEach((ch) => { if (k < tpl.props.length) { out.props.push(ch); k++; } });
  }
  if (tpl.turretDefs) {
    for (const td of tpl.turretDefs) {
      const t = turretMesh(td.cal);
      t.yawObj.position.set(...td.pos);
      t.yawObj.rotation.y = td.rest;
      mesh.add(t.yawObj);
      out.turrets.push({ ...t, cal: td.cal, rest: td.rest, arc: td.arc, yaw: td.rest, pitch: 0, reload: Math.random() });
    }
  }
  return out;
}
