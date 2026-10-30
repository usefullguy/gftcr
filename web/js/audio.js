// Alle Klänge werden zur Laufzeit erzeugt, keine Audiodateien nötig.
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.listener = { x: 0, y: 0, z: 0 };
    this.last = {};
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 400;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.engOsc.start(); this.engOsc2.start();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(p) { this.listener.x = p.x; this.listener.y = p.y; this.listener.z = p.z; }

  gainFor(pos, own) {
    if (own) return 1;
    const l = this.listener;
    const d = Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z);
    return 1 / (1 + d / 120);
  }

  burst(gain, freq, q, dur, type = 'bandpass', delay = 0) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  thump(gain, f0, f1, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  limit(key, gap) {
    const now = this.ctx.currentTime;
    if (this.last[key] && now - this.last[key] < gap) return false;
    this.last[key] = now;
    return true;
  }

  shot(kind, pos, own) {
    if (!this.ctx) return;
    const g = this.gainFor(pos, own) * (own ? 0.5 : 0.7);
    if (g < 0.02) return;
    if (!this.limit(kind + (own ? 'o' : ''), own ? 0.03 : 0.07)) return;
    switch (kind) {
      case 'mg': this.burst(g * 0.5, 2200, 0.8, 0.06); break;
      case 'cannon': this.burst(g * 0.7, 900, 0.7, 0.14); this.thump(g * 0.4, 180, 60, 0.12); break;
      case 'big': this.burst(g, 300, 0.5, 0.9, 'lowpass'); this.thump(g, 90, 30, 0.7); break;
      case 'rocket': this.burst(g * 0.6, 1200, 0.4, 0.5); break;
      case 'drop': this.burst(g * 0.3, 600, 2, 0.2); break;
      case 'torp': this.burst(g * 0.5, 400, 0.6, 0.6, 'lowpass'); break;
    }
  }

  boom(size, pos) {
    if (!this.ctx) return;
    const g = this.gainFor(pos, false) * Math.min(1.4, 0.5 + size * 0.3);
    if (g < 0.02 || !this.limit('boom', 0.05)) return;
    this.burst(g, 250 + 300 / size, 0.4, 0.6 + size * 0.4, 'lowpass');
    this.thump(g * 0.9, 110, 28, 0.5 + size * 0.3);
  }

  splash(pos) {
    if (!this.ctx) return;
    const g = this.gainFor(pos, false) * 0.5;
    if (g < 0.02 || !this.limit('splash', 0.06)) return;
    this.burst(g, 1500, 0.4, 0.5);
  }

  hit(kill) {
    if (!this.ctx) return;
    if (!this.limit(kill ? 'kill' : 'hit', 0.05)) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'square';
    o.frequency.value = kill ? 660 : 1400;
    g.gain.setValueAtTime(kill ? 0.12 : 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + (kill ? 0.25 : 0.04));
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }

  engine(kind, throttle) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!kind) { this.engGain.gain.setTargetAtTime(0, t, 0.2); return; }
    const plane = kind === 'plane';
    const f = plane ? 55 + throttle * 45 : 28 + throttle * 14;
    this.engOsc.frequency.setTargetAtTime(f, t, 0.15);
    this.engOsc2.frequency.setTargetAtTime(f * (plane ? 2.01 : 1.5), t, 0.15);
    this.engFilter.frequency.setTargetAtTime(plane ? 300 + throttle * 500 : 180 + throttle * 120, t, 0.2);
    this.engGain.gain.setTargetAtTime(plane ? 0.07 + throttle * 0.05 : 0.08, t, 0.2);
  }
}
