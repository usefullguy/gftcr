// UI-Animationen mit GSAP (vendor/gsap.min.js, global geladen).
// Fällt sauber auf "ohne Animation" zurück, falls GSAP fehlt oder Bewegung reduziert werden soll.

const gsap = window.gsap;
const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const on = !!gsap && !reduced;

export function splitLogo() {
  document.querySelectorAll('.logo').forEach((el) => {
    if (el.dataset.split) return;
    el.dataset.split = '1';
    el.innerHTML = [...el.textContent].map((c) => `<span class="ch">${c}</span>`).join('');
  });
}

export function screenIn(el) {
  if (!on || !el) return;
  gsap.killTweensOf(el.querySelectorAll('*'));
  if (el.id === 'menu') {
    const chars = el.querySelectorAll('.logo .ch');
    gsap.fromTo(chars, { y: 28, opacity: 0, rotateX: -70 }, { y: 0, opacity: 1, rotateX: 0, duration: 0.7, stagger: 0.045, ease: 'back.out(1.6)' });
    gsap.fromTo(el.querySelector('.tagline'), { opacity: 0, letterSpacing: '0.6em' }, { opacity: 1, letterSpacing: '0.3em', duration: 0.9, delay: 0.25, ease: 'power3.out' });
    gsap.fromTo(el.querySelectorAll('.menu-buttons button'), { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, stagger: 0.07, delay: 0.35, ease: 'power3.out' });
    gsap.fromTo(el.querySelector('.menu-side > p'), { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 0.7 });
    return;
  }
  const panel = el.querySelector('.panel');
  if (!panel) return;
  gsap.fromTo(panel, { y: 24, opacity: 0, scale: 0.985 }, { y: 0, opacity: 1, scale: 1, duration: 0.42, ease: 'power3.out' });
  const items = panel.querySelectorAll('h2, h3, .row, table, .tabs, .row-buttons, .panel.center > button, .hangar-foot');
  gsap.fromTo(items, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, stagger: 0.025, delay: 0.08, ease: 'power2.out' });
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
  gsap.fromTo(el.querySelectorAll('#topbar, #vehpanel, #minimap'), { opacity: 0, y: (i) => (i === 0 ? -16 : 16) }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out' });
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
