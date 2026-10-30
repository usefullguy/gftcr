// UI-Animationen mit GSAP (vendor/gsap.min.js, global geladen).
// Fällt sauber auf "ohne Animation" zurück, falls GSAP fehlt oder Bewegung reduziert werden soll.

const gsap = window.gsap;
const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const on = !!gsap && !reduced;

export function splitLogo() {}

export function screenIn(el) {
  if (!on || !el) return;
  gsap.killTweensOf(el.querySelectorAll('*'));
  if (el.id === 'menu') {
    gsap.fromTo(el.querySelector('.menu-side'), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out' });
    gsap.fromTo(el.querySelector('.report'), { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 0.15 });
    return;
  }
  const panel = el.querySelector('.panel');
  if (!panel) return;
  gsap.fromTo(panel, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' });
}

export function cardsIn(container) {
  if (!on) return;
  gsap.fromTo(container.children, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, stagger: 0.05, ease: 'power2.out' });
}

export function detailsIn(el) {
  if (!on) return;
  gsap.fromTo(el.querySelectorAll('h3, p, .muted, .weapons div'), { x: 12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.03, ease: 'power2.out' });
  el.querySelectorAll('.sbar i').forEach((bar, i) => {
    const w = bar.style.width;
    gsap.fromTo(bar, { width: '0%' }, { width: w, duration: 0.6, delay: 0.05 + i * 0.05, ease: 'power3.out' });
  });
}

export function toastIn(t, ms, done) {
  if (!on) { setTimeout(done, ms); return; }
  gsap.fromTo(t, { y: -14, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2)' });
  gsap.to(t, { y: -10, opacity: 0, duration: 0.35, delay: ms / 1000, ease: 'power2.in', onComplete: done });
}

export function feedIn(d) {
  if (!on) return;
  gsap.fromTo(d, { x: 24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'power3.out' });
}

export function feedOut(d) {
  if (!on) { d.remove(); return; }
  gsap.to(d, { opacity: 0, x: 12, duration: 0.4, onComplete: () => d.remove() });
}

// Großer Abschuss-Hinweis in der Bildmitte
export function killBanner(el, title, sub) {
  el.innerHTML = `<b>${title}</b><span>${sub}</span>`;
  el.hidden = false;
  if (!on) { clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 1800); return; }
  gsap.killTweensOf(el);
  gsap.fromTo(el, { scale: 1.35, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: 'back.out(2.2)' });
  gsap.to(el, { opacity: 0, y: -8, duration: 0.4, delay: 1.6, ease: 'power2.in', onComplete: () => { el.hidden = true; gsap.set(el, { y: 0 }); } });
}

export function pop(el, scale = 1.25) {
  if (!on || !el) return;
  gsap.fromTo(el, { scale }, { scale: 1, duration: 0.45, ease: 'elastic.out(1, 0.5)' });
}

export function flash(el, color) {
  if (!on || !el) return;
  gsap.fromTo(el, { boxShadow: `0 0 0 0 ${color}` }, { boxShadow: '0 0 0 10px rgba(0,0,0,0)', duration: 0.8, ease: 'power2.out' });
  pop(el, 1.3);
}

// Schadensspur am Lebensbalken: der helle Rest läuft verzögert nach
export function hpGhost(el, frac) {
  if (!on) { el.style.width = frac * 100 + '%'; return; }
  const cur = parseFloat(el.style.width) || 100;
  if (frac * 100 >= cur) { gsap.killTweensOf(el); el.style.width = frac * 100 + '%'; return; }
  gsap.to(el, { width: frac * 100 + '%', duration: 0.6, delay: 0.35, ease: 'power2.out', overwrite: true });
}

export function countUp(el, value, delay = 0) {
  if (!on) { el.textContent = value; return; }
  const o = { v: 0 };
  gsap.to(o, { v: value, duration: 0.9, delay, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(o.v); } });
}

export function resultIn(el) {
  if (!on) return;
  gsap.fromTo(el.querySelector('h2'), { scale: 1.6, opacity: 0, letterSpacing: '0.4em' }, { scale: 1, opacity: 1, letterSpacing: '0.06em', duration: 0.6, ease: 'power4.out' });
  gsap.fromTo(el.querySelectorAll('tr'), { x: -16, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, stagger: 0.08, delay: 0.3, ease: 'power2.out' });
}

export function deathIn(el) {
  if (!on) return;
  gsap.fromTo(el, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' });
}

export function hudIn(el) {
  if (!on) return;
  gsap.fromTo(el.querySelectorAll('#topbar-hud, #vehpanel, #weaponpanel, #minimap'), { opacity: 0, y: (i) => (i === 0 ? -16 : 16) }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out' });
}

// Klick- und Hover-Klänge für alle Buttons
export function bindUiSounds(audio) {
  let lastHover = null;
  document.addEventListener('mouseover', (e) => {
    const b = e.target.closest('button');
    if (b && b !== lastHover && !b.disabled) audio.uiHover();
    lastHover = b;
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.disabled) { audio.init(); audio.uiClick(); }
  });
}

// ---------- Tarnmuster-Übergang ----------
// Splittertarn: kantige Splitter in drei Farbtönen auf Grundfarbe, dazu feine "Regenstriche".
export function makeCamo(w = 1280, h = 800) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#7a7650';
  g.fillRect(0, 0, w, h);
  const colors = ['#3f4a2c', '#5a4a33', '#2f3824', '#6b6a44'];
  const shard = (cx, cy, size, ang) => {
    g.beginPath();
    const n = 4 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = ang + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
      // gestreckt entlang der Hauptrichtung
      const r = size * (0.4 + Math.random() * 0.9) * (Math.abs(Math.cos(a - ang)) * 1.4 + 0.35);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.75;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
  };
  for (let layer = 0; layer < colors.length; layer++) {
    g.fillStyle = colors[layer];
    const count = 26 - layer * 3;
    for (let i = 0; i < count; i++) shard(Math.random() * w, Math.random() * h, 60 + Math.random() * 120, -0.5 + (Math.random() - 0.5) * 0.4);
  }
  // Regenstriche
  g.strokeStyle = 'rgba(30, 36, 20, 0.55)';
  g.lineWidth = 2;
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * w, y = Math.random() * h, l = 6 + Math.random() * 10;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + l * 0.25, y + l); g.stroke();
  }
  return c.toDataURL('image/jpeg', 0.85);
}

let camoBusy = false;
export function camoTransition(swap, label = '') {
  const el = document.getElementById('camo');
  if (!el.style.backgroundImage) el.style.backgroundImage = `url(${makeCamo()})`;
  document.getElementById('camoText').textContent = label;
  if (!on || camoBusy) { swap(); return Promise.resolve(); }
  camoBusy = true;
  const closed = 'polygon(0% 0%, 0% 0%, -20% 100%, -20% 100%)';
  const full = 'polygon(0% 0%, 120% 0%, 100% 100%, -20% 100%)';
  const gone = 'polygon(120% 0%, 120% 0%, 100% 100%, 100% 100%)';
  const lbl = el.querySelector('.camo-label');
  return new Promise((resolve) => {
    gsap.timeline({ onComplete: () => { gsap.set(el, { visibility: 'hidden', clipPath: closed }); camoBusy = false; resolve(); } })
      .set(el, { visibility: 'visible', clipPath: closed })
      .set(lbl, { opacity: 0, scale: 0.9 })
      .to(el, { clipPath: full, duration: 0.42, ease: 'power3.in' })
      .to(lbl, { opacity: 1, scale: 1, duration: 0.2, ease: 'back.out(2)' }, '-=0.05')
      .add(() => swap())
      .to({}, { duration: 0.35 })
      .to(lbl, { opacity: 0, duration: 0.15 })
      .to(el, { clipPath: gone, duration: 0.45, ease: 'power3.out' });
  });
}
