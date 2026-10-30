import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset,
  VignetteEffect, ToneMappingEffect, ToneMappingMode, HueSaturationEffect, BrightnessContrastEffect,
} from '../vendor/postprocessing.js?v=9';

// Nachbearbeitung: Bloom für Feuer/Leuchtspur/Sonne, Kantenglättung, Vignette, Farbabstimmung.
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

  const bloom = new BloomEffect({
    intensity: quality === 'hoch' ? 1.35 : 1.1,
    luminanceThreshold: 0.9,
    luminanceSmoothing: 0.25,
    mipmapBlur: true,
    radius: 0.72,
  });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  const grade = new HueSaturationEffect({ saturation: 0.1 });
  const contrast = new BrightnessContrastEffect({ contrast: 0.06 });
  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
  composer.addPass(new EffectPass(camera, bloom, tone, grade, contrast, vignette));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: quality === 'hoch' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));

  return {
    render: (dt) => composer.render(dt),
    setSize: (w, h) => composer.setSize(w, h),
    // Bei Treffern dunkelt der Rand kurz stärker ab
    setHurt: (f) => { vignette.darkness = 0.42 + f * 0.35; },
  };
}
