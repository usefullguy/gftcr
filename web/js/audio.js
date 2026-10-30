// Klangerzeugung mit der Web Audio API, ohne Audiodateien.
// Jeder Weltklang läuft durch einen 3D-Panner, ferne Klänge kommen mit Schallverzögerung und gedämpften Höhen an.

const SPEED_OF_SOUND = 343;

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.last = {};
    this.listener = { x: 0, y: 0, z: 0 };
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // Hall-Bus mit erzeugter Impulsantwort (offenes Meer: lang, dünn)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8, 2.6);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.55;
    this.reverbIn.connect(this.reverb);
    this.reverb.connect(this.master);

    // Bus für Weltklänge und für Oberfläche (UI ohne Raum)
    this.world = ctx.createGain();
    this.world.connect(this.master);
    this.ui = ctx.createGain();
    this.ui.gain.value = 0.7;
    this.ui.connect(this.master);

    this.noise = this.makeNoise(2);
    this.brown = this.makeBrown(4);

    this.setupEngine();
    this.setupAmbience();
  }

  impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 400 ? i / 400 : 1);
    }
    return buf;
  }

  makeNoise(seconds) {
    const ctx = this.ctx, len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeBrown(seconds) {
    const ctx = this.ctx, len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Kameraposition und Blickrichtung für den 3D-Klang
  setListener(cam) {
    this.listener.x = cam.position.x; this.listener.y = cam.position.y; this.listener.z = cam.position.z;
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.position.x, t, 0.02);
      L.positionY.setTargetAtTime(cam.position.y, t, 0.02);
      L.positionZ.setTargetAtTime(cam.position.z, t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(fy, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(ux, t, 0.02); L.upY.setTargetAtTime(uy, t, 0.02); L.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      L.setPosition(cam.position.x, cam.position.y, cam.position.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    // Wind lauter in der Höhe, Meeresrauschen lauter nah am Wasser
    if (this.windGain) {
      const alt = Math.max(0, cam.position.y);
      this.windGain.gain.setTargetAtTime(0.012 + Math.min(alt / 1500, 1) * 0.035, t, 0.5);
      this.seaGain.gain.setTargetAtTime(0.05 * Math.max(0, 1 - alt / 250), t, 0.5);
    }
  }

  dist(pos) {
    const l = this.listener;
    return Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z);
  }

  // Ausgang für einen Klang an einer Weltposition. Gibt {node, t0} zurück oder null, wenn zu leise.
  out(pos, gain, own, maxDist = 6000, reverb = 0.25) {
    const ctx = this.ctx;
    const d = own ? 0 : this.dist(pos);
    if (d > maxDist) return null;
    const t0 = ctx.currentTime + Math.min(d / SPEED_OF_SOUND, 3);
    const g = ctx.createGain();
    g.gain.value = gain;
    let tail = g;
    if (!own) {
      // Luftdämpfung: entfernte Klänge verlieren Höhen
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = Math.max(350, 16000 / (1 + d / 250));
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 45;
      p.rolloffFactor = 1;
      p.maxDistance = maxDist;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(air); air.connect(p);
      tail = p;
    }
    tail.connect(this.world);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb * (own ? 0.5 : 1 + Math.min(d / 1500, 1.5));
      tail.connect(s); s.connect(this.reverbIn);
    }
    return { node: g, t0 };
  }

  noiseHit(dest, t0, { gain, type = 'bandpass', freq, freqEnd, q = 1, attack = 0.002, dur, brown = false }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.noise;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 1.2, dur + 0.1);
  }

  tone(dest, t0, { gain, type = 'sine', f0, f1, attack = 0.003, dur }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  limit(key, gap) {
    const now = this.ctx.currentTime;
    if (this.last[key] && now - this.last[key] < gap) return false;
    this.last[key] = now;
    return true;
  }

  // ---------- Waffen ----------
  shot(kind, pos, own) {
    if (!this.ctx) return;
    if (!this.limit(kind + (own ? 'o' : pos.x.toFixed(0)), own ? 0.025 : 0.06)) return;
    const vol = own ? 0.55 : 1;
    switch (kind) {
      case 'mg': {
        const o = this.out(pos, 0.5 * vol, own, 2500, 0.15); if (!o) return;
        this.noiseHit(o.node, o.t0, { gain: 0.9, type: 'bandpass', freq: 2600, freqEnd: 1200, q: 0.9, dur: 0.07 });
        this.tone(o.node, o.t0, { gain: 0.35, type: 'square', f0: 160, f1: 70, dur: 0.04 });
        break;
      }
      case 'cannon': {
        const o = this.out(pos, 0.7 * vol, own, 3500, 0.25); if (!o) return;
        this.noiseHit(o.node, o.t0, { gain: 1, type: 'lowpass', freq: 3000, freqEnd: 500, q: 0.5, dur: 0.16 });
        this.tone(o.node, o.t0, { gain: 0.8, f0: 140, f1: 45, dur: 0.18 });
        break;
      }
      case 'big': {
        const o = this.out(pos, 1.1 * vol, own, 9000, 0.6); if (!o) return;
        this.noiseHit(o.node, o.t0, { gain: 0.8, type: 'highpass', freq: 1800, q: 0.5, dur: 0.06 });
        this.noiseHit(o.node, o.t0, { gain: 1, type: 'lowpass', freq: 900, freqEnd: 120, q: 0.4, dur: 1.4, brown: true });
        this.tone(o.node, o.t0, { gain: 1, f0: 75, f1: 24, attack: 0.005, dur: 0.9 });
        break;
      }
      case 'rocket': {
        const o = this.out(pos, 0.6 * vol, own, 3500, 0.2); if (!o) return;
        this.noiseHit(o.node, o.t0, { gain: 0.8, type: 'bandpass', freq: 900, freqEnd: 2600, q: 0.6, attack: 0.03, dur: 0.7 });
        break;
      }
      case 'drop': {
        const o = this.out(pos, 0.4 * vol, own, 1500, 0.1); if (!o) return;
        this.tone(o.node, o.t0, { gain: 0.5, type: 'triangle', f0: 220, f1: 110, dur: 0.12 });
        this.noiseHit(o.node, o.t0, { gain: 0.3, freq: 800, q: 2, dur: 0.15 });
        break;
      }
      case 'torp': {
        const o = this.out(pos, 0.6 * vol, own, 2500, 0.3); if (!o) return;
        this.tone(o.node, o.t0, { gain: 0.6, f0: 90, f1: 40, dur: 0.35 });
        this.noiseHit(o.node, o.t0 + 0.08, { gain: 0.7, type: 'lowpass', freq: 1800, freqEnd: 400, q: 0.5, dur: 0.8 });
        break;
      }
    }
  }

  boom(size, pos) {
    if (!this.ctx || !this.limit('boom' + Math.round(pos.x / 20), 0.05)) return;
    const o = this.out(pos, Math.min(1.6, 0.6 + size * 0.35), false, 12000, 0.7);
    if (!o) return;
    const d = 0.6 + size * 0.45;
    this.noiseHit(o.node, o.t0, { gain: 0.9, type: 'highpass', freq: 2200, q: 0.4, dur: 0.08 });
    this.noiseHit(o.node, o.t0, { gain: 1, type: 'lowpass', freq: 1400, freqEnd: 90, q: 0.3, attack: 0.004, dur: d * 1.6, brown: true });
    this.tone(o.node, o.t0, { gain: 1, f0: 95, f1: 22, attack: 0.006, dur: d });
    // Nachknistern
    for (let i = 0; i < Math.min(6, 2 + size * 2); i++) {
      this.noiseHit(o.node, o.t0 + 0.15 + Math.random() * d, { gain: 0.2, type: 'bandpass', freq: 1200 + Math.random() * 2500, q: 3, dur: 0.05 });
    }
  }

  splash(pos) {
    if (!this.ctx || !this.limit('splash', 0.05)) return;
    const o = this.out(pos, 0.55, false, 3000, 0.25); if (!o) return;
    this.noiseHit(o.node, o.t0, { gain: 0.9, type: 'bandpass', freq: 2400, freqEnd: 500, q: 0.7, attack: 0.01, dur: 0.75 });
    this.tone(o.node, o.t0, { gain: 0.3, f0: 120, f1: 50, dur: 0.25 });
  }

  // Treffer auf das eigene Fahrzeug: metallisches Klonk
  clank() {
    if (!this.ctx || !this.limit('clank', 0.08)) return;
    const t = this.ctx.currentTime, d = this.ui;
    this.tone(d, t, { gain: 0.18, type: 'triangle', f0: 420 + Math.random() * 80, dur: 0.18 });
    this.tone(d, t, { gain: 0.12, type: 'square', f0: 650 + Math.random() * 120, dur: 0.08 });
    this.noiseHit(d, t, { gain: 0.25, type: 'bandpass', freq: 3500, q: 2, dur: 0.06 });
  }

  // Trefferbestätigung für eigene Schüsse
  hit(kill) {
    if (!this.ctx || !this.limit(kill ? 'kill' : 'hit', kill ? 0.2 : 0.045)) return;
    const t = this.ctx.currentTime, d = this.ui;
    if (kill) {
      this.tone(d, t, { gain: 0.16, type: 'triangle', f0: 880, dur: 0.18 });
      this.tone(d, t + 0.09, { gain: 0.16, type: 'triangle', f0: 1320, dur: 0.3 });
    } else {
      this.tone(d, t, { gain: 0.07, f0: 2100, f1: 1700, dur: 0.035 });
    }
  }

  // Vorbeiflug: Rauschen mit fallender Tonhöhe
  flyby(pos) {
    if (!this.ctx || !this.limit('flyby', 0.6)) return;
    const o = this.out(pos, 0.6, false, 400, 0.1); if (!o) return;
    this.noiseHit(o.node, o.t0, { gain: 0.9, type: 'bandpass', freq: 1600, freqEnd: 300, q: 1.2, attack: 0.25, dur: 1.1 });
    this.tone(o.node, o.t0, { gain: 0.25, type: 'sawtooth', f0: 190, f1: 95, attack: 0.25, dur: 1.0 });
  }

  // ---------- Oberfläche ----------
  uiHover() {
    if (!this.ctx || !this.limit('hover', 0.04)) return;
    this.tone(this.ui, this.ctx.currentTime, { gain: 0.035, f0: 2400, dur: 0.025 });
  }

  uiClick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(this.ui, t, { gain: 0.09, type: 'triangle', f0: 520, f1: 780, dur: 0.07 });
  }

  uiToast() {
    if (!this.ctx || !this.limit('toast', 0.3)) return;
    const t = this.ctx.currentTime;
    this.tone(this.ui, t, { gain: 0.07, type: 'triangle', f0: 660, dur: 0.15 });
    this.tone(this.ui, t + 0.08, { gain: 0.07, type: 'triangle', f0: 990, dur: 0.22 });
  }

  uiUnlock() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(this.ui, t + i * 0.09, { gain: 0.09, type: 'triangle', f0: f, dur: 0.35 }));
  }

  alarm() {
    if (!this.ctx || !this.limit('alarm', 1.1)) return;
    const t = this.ctx.currentTime;
    this.tone(this.ui, t, { gain: 0.05, type: 'square', f0: 740, dur: 0.12 });
    this.tone(this.ui, t + 0.18, { gain: 0.05, type: 'square', f0: 740, dur: 0.12 });
  }

  // ---------- Dauerklänge ----------
  setupEngine() {
    const ctx = this.ctx;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 2;
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator(); this.engOsc2.type = 'square';
    const o2g = ctx.createGain(); o2g.gain.value = 0.35;
    // Propeller-Flattern: Amplitudenmodulation
    this.engLfo = ctx.createOscillator(); this.engLfo.frequency.value = 22;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.3;
    const am = ctx.createGain(); am.gain.value = 0.7;
    this.engLfo.connect(lfoGain); lfoGain.connect(am.gain);
    const eNoise = ctx.createBufferSource(); eNoise.buffer = this.brown; eNoise.loop = true;
    this.engNoiseGain = ctx.createGain(); this.engNoiseGain.gain.value = 0.4;
    this.engOsc.connect(am); this.engOsc2.connect(o2g); o2g.connect(am);
    eNoise.connect(this.engNoiseGain); this.engNoiseGain.connect(am);
    am.connect(this.engFilter); this.engFilter.connect(this.engGain); this.engGain.connect(this.ui);
    this.engOsc.start(); this.engOsc2.start(); this.engLfo.start(); eNoise.start();
  }

  setupAmbience() {
    const ctx = this.ctx;
    const mk = (type, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.08;
      const lg = ctx.createGain(); lg.gain.value = freq * 0.35;
      lfo.connect(lg); lg.connect(f.frequency);
      src.connect(f); f.connect(g); g.connect(this.ui);
      src.start(); lfo.start();
      return g;
    };
    this.windGain = mk('bandpass', 500, 0.6);
    this.seaGain = mk('lowpass', 420, 0.3);
  }

  engine(kind, throttle, speedFrac = 0.7) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!kind) { this.engGain.gain.setTargetAtTime(0, t, 0.25); return; }
    if (kind === 'plane') {
      const f = 48 + throttle * 38 + speedFrac * 14;
      this.engOsc.frequency.setTargetAtTime(f, t, 0.2);
      this.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.2);
      this.engLfo.frequency.setTargetAtTime(f * 0.5, t, 0.2);
      this.engFilter.frequency.setTargetAtTime(350 + throttle * 900, t, 0.2);
      this.engNoiseGain.gain.setTargetAtTime(0.25 + speedFrac * 0.5, t, 0.3);
      this.engGain.gain.setTargetAtTime(0.06 + throttle * 0.05, t, 0.25);
    } else {
      const f = 32 + Math.abs(throttle) * 12;
      this.engOsc.frequency.setTargetAtTime(f, t, 0.4);
      this.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.4);
      this.engLfo.frequency.setTargetAtTime(6 + Math.abs(throttle) * 4, t, 0.4);
      this.engFilter.frequency.setTargetAtTime(160 + Math.abs(throttle) * 120, t, 0.4);
      this.engNoiseGain.gain.setTargetAtTime(0.8, t, 0.4);
      this.engGain.gain.setTargetAtTime(0.09, t, 0.3);
    }
  }
}
