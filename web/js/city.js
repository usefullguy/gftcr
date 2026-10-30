import * as THREE from 'three';
import { mulberry32 } from './util.js?v=11';

// Stadtkarte für Panzer: Straßenraster, Häuserblöcke, Plätze als Zonen, Felder am Rand.
export const CITY_HALF = 1300;
export const CELL = 130;      // Abstand der Straßenmitten
const ROAD = 11;              // halbe Straßenbreite
const WALK = 4;               // Gehweg
export const CITY_ZONES = [
  { name: 'A', x: -780, z: 0, r: 120 },
  { name: 'B', x: 0, z: 0, r: 120 },
  { name: 'C', x: 780, z: 0, r: 120 },
];

const FACADES = [0xd8cdb4, 0xc9b79a, 0xb7a58a, 0xa96f58, 0x9a5f4b, 0xb9bcb8, 0xa2a7a6, 0xcfc3a3, 0x8f8775];

export class City {
  constructor(group, quality) {
    this.group = group;
    this.half = CITY_HALF;
    this.blocks = new Map(); // "ix,iz" -> [{x0,x1,z0,z1,h}]
    const rng = mulberry32(1337);
    const boxes = [];   // [cx, cy, cz, w, h, d, color]
    const parks = [];
    const trees = [];

    const nearZone = (x, z) => CITY_ZONES.some((zn) => Math.abs(x - zn.x) < CELL && Math.abs(z - zn.z) < CELL);
    for (let ix = -10; ix < 10; ix++) {
      for (let iz = -10; iz < 10; iz++) {
        const cx = (ix + 0.5) * CELL, cz = (iz + 0.5) * CELL;
        const x0 = ix * CELL + ROAD + WALK, x1 = (ix + 1) * CELL - ROAD - WALK;
        const z0 = iz * CELL + ROAD + WALK, z1 = (iz + 1) * CELL - ROAD - WALK;
        const list = [];
        this.blocks.set(ix + ',' + iz, list);
        const outer = Math.abs(cz) > 1040;
        if (nearZone(cx, cz)) {
          // Platz: offen, nur ein paar Deckungsmauern
          for (let k = 0; k < 2; k++) {
            const w = 10 + rng() * 10, d = 1.4, h = 1.6;
            const x = x0 + 12 + rng() * (x1 - x0 - 24), z = z0 + 12 + rng() * (z1 - z0 - 24);
            const rot = rng() > 0.5;
            const bw = rot ? d : w, bd = rot ? w : d;
            boxes.push([x, h / 2, z, bw, h, bd, 0x9d978a]);
            list.push({ x0: x - bw / 2, x1: x + bw / 2, z0: z - bd / 2, z1: z + bd / 2, h });
          }
          continue;
        }
        if (outer || rng() < 0.1) {
          // Park oder Feld
          parks.push([cx, cz, x1 - x0, z1 - z0, outer ? 0x6d7a45 : 0x5f8a43]);
          const n = outer ? 6 : 10;
          for (let k = 0; k < n; k++) trees.push([x0 + 6 + rng() * (x1 - x0 - 12), z0 + 6 + rng() * (z1 - z0 - 12), 0.8 + rng() * 0.6]);
          continue;
        }
        // Häuser: Block in 2-3 x 2-3 Grundstücke teilen
        const centerDist = Math.hypot(cx, cz) / CITY_HALF;
        const nx = 2 + (rng() > 0.5 ? 1 : 0), nz = 2 + (rng() > 0.6 ? 1 : 0);
        const lw = (x1 - x0) / nx, ld = (z1 - z0) / nz;
        for (let a = 0; a < nx; a++) {
          for (let b = 0; b < nz; b++) {
            if (rng() < 0.12) continue; // Hinterhof / Baulücke
            const ruin = rng() < 0.08;
            const h = ruin ? 3 + rng() * 5 : (10 + rng() * 22) * (1.5 - centerDist * 0.8) + (rng() < 0.08 ? 20 : 0);
            const inset = 1.2;
            const bx0 = x0 + a * lw + inset, bx1 = x0 + (a + 1) * lw - inset;
            const bz0 = z0 + b * ld + inset, bz1 = z0 + (b + 1) * ld - inset;
            const color = ruin ? 0x7d776b : FACADES[(rng() * FACADES.length) | 0];
            boxes.push([(bx0 + bx1) / 2, h / 2, (bz0 + bz1) / 2, bx1 - bx0, h, bz1 - bz0, color]);
            list.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, h });
          }
        }
      }
    }

    this.buildGround();
    this.buildBuildings(boxes, quality);
    this.buildParks(parks, trees);
  }

  // Höhe eines Gebäudes an (x, z), 0 auf Straßen und Plätzen
  heightAt(x, z) {
    const list = this.blocks.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    if (!list) return 0;
    for (const b of list) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return b.h;
    return 0;
  }

  // Sichtlinie für die KI (in Augenhöhe der Panzer)
  lineOfSight(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    const steps = Math.ceil(d / 6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const y = a.y + (b.y - a.y) * t;
      if (this.heightAt(a.x + dx * t, a.z + dz * t) > y) return false;
    }
    return true;
  }

  buildGround() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vCityPos;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vCityPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vCityPos;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vCityPos.xz;
        vec2 m = abs(mod(p + ${CELL / 2}.0, ${CELL}.0) - ${CELL / 2}.0);
        float road = 1.0 - step(${ROAD}.0, min(m.x, m.y));
        float walk = (1.0 - step(${ROAD + WALK}.0, min(m.x, m.y))) * (1.0 - road);
        vec3 col = vec3(0.60, 0.58, 0.53);
        col = mix(col, vec3(0.70, 0.69, 0.66), walk);
        col = mix(col, vec3(0.23, 0.24, 0.25), road);
        // Mittellinie
        float onX = step(m.y, 0.25) * step(${ROAD}.0, m.x) * step(0.5, fract(p.x / 8.0));
        float onZ = step(m.x, 0.25) * step(${ROAD}.0, m.y) * step(0.5, fract(p.y / 8.0));
        col = mix(col, vec3(0.82, 0.78, 0.6), clamp(onX + onZ, 0.0, 1.0) * 0.8);
        float outside = step(${CITY_HALF}.0, max(abs(p.x), abs(p.y)));
        col = mix(col, vec3(0.42, 0.47, 0.30), outside);
        diffuseColor.rgb = col;`);
    };
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), mat);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  buildBuildings(boxes, quality) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    // Fensterraster im Shader, abhängig von Weltposition und Flächenrichtung
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vBPos;\nvarying vec3 vBN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
         vBPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
         vBN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`);
      sh.fragmentShader = 'varying vec3 vBPos;\nvarying vec3 vBN;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if (abs(vBN.y) < 0.5) {
          float u = abs(vBN.x) > 0.5 ? vBPos.z : vBPos.x;
          vec2 f = fract(vec2(u / 4.2, vBPos.y / 3.6));
          float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.32, f.y) * step(f.y, 0.82) * step(3.4, vBPos.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.16, 0.2), win * 0.9);
          float base = 1.0 - step(1.2, vBPos.y);
          diffuseColor.rgb *= 1.0 - base * 0.35;
        } else {
          diffuseColor.rgb *= 0.72;
        }`);
    };
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, boxes.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    boxes.forEach(([x, y, z, w, h, d, col], i) => {
      m.compose(v.set(x, y, z), q, s.set(w, h, d));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(col));
    });
    mesh.castShadow = quality !== 'niedrig';
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildParks(parks, trees) {
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), parks.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    parks.forEach(([x, z, w, d, col], i) => {
      m.compose(v.set(x, 0.05, z), q, s.set(w, 1, d));
      pm.setMatrixAt(i, m);
      pm.setColorAt(i, c.set(col));
    });
    pm.receiveShadow = true;
    this.group.add(pm);
    const geo = new THREE.ConeGeometry(3.2, 9, 6);
    geo.translate(0, 6, 0);
    const tm = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x3e6b33, flatShading: true }), trees.length);
    trees.forEach(([x, z, sc], i) => {
      m.compose(v.set(x, 0, z), q, s.set(sc, sc, sc));
      tm.setMatrixAt(i, m);
    });
    tm.castShadow = true;
    this.group.add(tm);
  }
}
