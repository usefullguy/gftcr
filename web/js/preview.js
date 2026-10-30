import * as THREE from 'three';
import { buildModel } from './models.js?v=11';

// Rendert Vorschaubilder der Fahrzeuge (3/4-Ansicht von vorne) einmalig in Data-URLs.
const cache = new Map();
let renderer = null, scene = null, camera = null;

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(640, 360);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3a30, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(-0.6, 1, -0.4);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 3000);
}

export function preview(id) {
  if (cache.has(id)) return cache.get(id);
  if (!renderer) setup();
  const { mesh } = buildModel(id, 0);
  scene.add(mesh);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.z * 0.8, size.y * 1.6);
  const d = r * 1.9;
  camera.position.set(center.x - d * 0.62, center.y + d * 0.32, center.z - d * 0.78);
  camera.lookAt(center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(mesh);
  cache.set(id, url);
  return url;
}
