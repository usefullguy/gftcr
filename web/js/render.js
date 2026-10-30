import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset,
  ToneMappingEffect, ToneMappingMode,
} from '../vendor/postprocessing.js?v=11';

// Nachbearbeitung: Bloom für Feuer/Leuchtspur/Sonne und Kantenglättung.
// Auf "niedrig" wird direkt gerendert.
export function createPipeline(renderer, scene, camera, quality) {
  if (quality === 'niedrig') {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    return { render: () => renderer.render(scene, camera), setSize() {}, setHurt() {} };
  }

  renderer.toneMapping = THREE.NoToneMapping;
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

  // Nur Bloom (Feuer, Leuchtspur, Sonne) und Kantenglättung, keine Farbfilter
  const bloom = new BloomEffect({ intensity: 0.85, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, mipmapBlur: true, radius: 0.6 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  composer.addPass(new EffectPass(camera, bloom, tone));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: quality === 'hoch' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));

  return {
    render: (dt) => composer.render(dt),
    setSize: (w, h) => composer.setSize(w, h),
    setHurt() {},
  };
}
