import * as THREE from 'three';
import { fmtTime, clamp } from './util.js';
import { MAP_HALF } from './world.js';
import { DEFS } from './vehicles.js';
import { toastIn, feedIn, feedOut, killBanner, pop, flash, hpGhost, deathIn } from './ui.js';

const $ = (id) => document.getElementById(id);
export const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Hud {
  constructor() {
    this.el = $('hud');
    this.overlay = $('overlay');
    this.ctx = this.overlay.getContext('2d');
    this.mini = $('minimap').getContext('2d');
    this.hitT = 0; this.killHit = false;
    this.hurtT = 0;
    this.dmgDirs = [];
    this.miniBg = null;
    this.zoneEls = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.overlay.width = innerWidth * dpr;
    this.overlay.height = innerHeight * dpr;
  }

  show(on) {
    this.el.hidden = !on;
    if (!on) this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  setup(game, world) {
    const zc = $('zones');
    zc.innerHTML = '';
    this.zoneEls = game.zones.map((z) => {
      const d = document.createElement('div');
      d.className = 'zone';
      d.innerHTML = `<i></i>${z.name}`;
      zc.appendChild(d);
      return d;
    });
    $('feed').innerHTML = '';
    $('toasts').innerHTML = '';
    this.buildMinimapBg(world);
  }

  buildMinimapBg(world) {
    if (this.miniBg) return;
    const size = 200, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const wx = (x / size * 2 - 1) * MAP_HALF, wz = (y / size * 2 - 1) * MAP_HALF;
        const h = world.heightAt(wx, wz);
        const i = (y * size + x) * 4;
        if (h > 6) { img.data[i] = 96; img.data[i + 1] = 128; img.data[i + 2] = 72; img.data[i + 3] = 255; }
        else if (h > 0) { img.data[i] = 200; img.data[i + 1] = 184; img.data[i + 2] = 130; img.data[i + 3] = 255; }
        else { img.data[i + 3] = 0; }
      }
    }
    g.putImageData(img, 0, 0);
    this.miniBg = c;
  }

  feed(killer, victim, how, player) {
    const f = $('feed');
    const d = document.createElement('div');
    const cls = (u) => (u === player ? 'me' : u.team === 0 ? 'b' : 'r');
    const vName = `<span class="${cls(victim)}">${esc(victim.name)}</span> <span class="muted">(${victim.def.name})</span>`;
    const ico = victim.kind === 'ship' ? '⚓' : '✈';
    if (killer) d.innerHTML = `<span class="${cls(killer)}">${esc(killer.name)}</span><span class="ico">${ico}</span>${vName}`;
    else d.innerHTML = `${vName} ${how === 'crash' ? 'abgestürzt' : 'zerstört'}`;
    f.prepend(d);
    feedIn(d);
    while (f.children.length > 6) f.lastChild.remove();
    setTimeout(() => feedOut(d), 9000);
  }

  toast(title, text, ms = 3200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<b>${title}</b>${text ? `<span>${text}</span>` : ''}`;
    $('toasts').appendChild(t);
    toastIn(t, ms, () => t.remove());
  }

  hit(kill) { this.hitT = kill ? 0.5 : 0.15; this.killHit = kill; }

  kill(victim, streak) {
    const sub = `${esc(victim.name)} · ${victim.def.name}` + (streak > 1 ? ` · Serie ${streak}` : '');
    killBanner($('killbanner'), victim.kind === 'ship' ? 'Versenkt' : 'Abgeschossen', sub);
  }
  hurt(f, from) {
    this.hurtT = Math.min(1, this.hurtT + f * 4 + 0.15);
    if (from) this.dmgDirs.push({ x: from.x, z: from.z, t: 1.4 });
    if (this.dmgDirs.length > 6) this.dmgDirs.shift();
  }

  notice(text) {
    const f = $('feed');
    const d = document.createElement('div');
    d.className = 'muted';
    d.textContent = text;
    f.prepend(d);
    feedIn(d);
    setTimeout(() => feedOut(d), 7000);
  }

  death(text, sub) {
    const d = $('deathmsg');
    d.hidden = !text;
    if (text) { d.innerHTML = `${text}<small>${sub || ''}</small>`; deathIn(d); }
  }

  scoreboard(game, on) {
    const sb = $('scoreboard');
    sb.hidden = !on;
    if (!on) return;
    const rows = (team) => game.units
      .filter((u) => u.team === team && !u.escort)
      .sort((a, b) => b.kills - a.kills)
      .map((u) => `<tr class="${u.isPlayer ? 'me' : ''} ${u.alive ? '' : 'dead'} ${u.human || u.owner ? 'human' : ''}"><td>${esc(u.name)}</td><td class="muted">${u.def.name}</td><td>${u.kills}</td></tr>`).join('');
    sb.innerHTML = `<div><h4 style="color:#8fb8ff">Blau</h4><table>${rows(0)}</table></div><div><h4 style="color:#ff9b91">Rot</h4><table>${rows(1)}</table></div>`;
  }

  update(dt, game, cam, view) {
    const p = game.player;
    $('tkBlue').textContent = Math.ceil(game.tickets[0]);
    $('tkRed').textContent = Math.ceil(game.tickets[1]);
    $('tkBlueBar').style.width = (game.tickets[0] / game.maxTickets * 100) + '%';
    $('tkRedBar').style.width = (game.tickets[1] / game.maxTickets * 100) + '%';
    $('timer').textContent = fmtTime(game.duration - game.time);

    game.zones.forEach((z, i) => {
      const el = this.zoneEls[i];
      if (el._owner !== undefined && el._owner !== z.owner) flash(el, z.owner === 0 ? 'rgba(76,141,240,0.9)' : z.owner === 1 ? 'rgba(226,86,74,0.9)' : 'rgba(255,255,255,0.7)');
      el._owner = z.owner;
      el.className = 'zone' + (z.owner === 0 ? ' own' : z.owner === 1 ? ' enemy' : '') + (z.inside && z.inside[0] && z.inside[1] ? ' contest' : '');
      const fill = el.firstChild;
      fill.style.height = Math.abs(z.v) * 100 + '%';
      fill.style.background = z.v >= 0 ? 'rgba(76,141,240,0.55)' : 'rgba(226,86,74,0.55)';
    });

    if (p) {
      $('vpName').textContent = p.def.name;
      $('vpClass').textContent = p.def.klasse;
      if (p.kind === 'plane') { $('wpBig').textContent = Math.round(p.speed * 3.6); $('wpBigUnit').textContent = 'km/h'; }
      else { $('wpBig').textContent = Math.round(Math.abs(p.speed) * 1.94); $('wpBigUnit').textContent = 'kn'; }
      const streakEl = $('vpStreak');
      if (streakEl._v !== p.streak) { streakEl.textContent = p.streak > 0 ? `Serie ${p.streak}` : ''; if (p.streak > 0) pop(streakEl, 1.6); streakEl._v = p.streak; }
      const hpEl = $('vpHp');
      if (this.hpUnit !== p) { this.hpUnit = p; $('vpHpGhost').style.width = '100%'; }
      hpEl.style.width = p.hpFrac * 100 + '%';
      hpGhost($('vpHpGhost'), p.hpFrac);
      hpEl.style.background = p.hpFrac > 0.5 ? 'var(--good)' : p.hpFrac > 0.25 ? 'var(--accent)' : 'var(--red)';
      $('vpRows').innerHTML = this.rows(p, game);
    }

    const warn = $('warning');
    let w = '';
    if (p && p.alive && p.bounds) w = 'Kartenrand – umkehren';
    else if (p && p.alive && p.kind === 'plane' && p.speed < p.def.minSpeed) w = 'Strömungsabriss';
    warn.hidden = !w;
    if (w) warn.textContent = w;

    this.hitT = Math.max(0, this.hitT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt * 1.2);
    for (const d of this.dmgDirs) d.t -= dt;
    this.dmgDirs = this.dmgDirs.filter((d) => d.t > 0);
    $('vignette').style.opacity = this.hurtT;

    this.drawOverlay(game, cam, view);
    this.drawMinimap(game, cam);
  }

  rows(p, game) {
    const gauge = (f, cls = '') => `<span class="gauge"><i style="width:${clamp(f, 0, 1) * 100}%;${cls}"></i></span>`;
    const out = [];
    if (p.kind === 'plane') {
      out.push(['Höhe', `${Math.round(p.pos.y)} m`]);
      out.push(['Schub', gauge(p.ctrl.throttle)]);
      out.push(['Waffen', p.overheated ? '<span class="warn">überhitzt</span>' : gauge(p.heat, p.heat > 0.7 ? 'background:var(--red)' : '')]);
      const s = p.def.secondary;
      if (s) out.push([s.name, `${p.ammo2} / ${s.count}` + (p.ammo2 < s.count ? ` <span class="muted">(${Math.ceil(s.rearm - p.rearm)} s)</span>` : '')]);
    } else {
      const steps = ['Zurück', 'Stopp', '1/4', '1/2', '3/4', 'Voll'];
      out.push(['Fahrstufe', steps[(p.throttleStep ?? 2) + 1]]);
      const ready = p.turrets.filter((t) => t.reload <= 0).length;
      const maxRel = Math.max(...p.turrets.map((t) => t.reload));
      out.push([p.cal.name, ready === p.turrets.length ? '<span class="ok">bereit</span>' : `${ready}/${p.turrets.length} · ${Math.max(0, maxRel).toFixed(1)} s`]);
      if (p.def.torpedo) {
        out.push(['Torpedos', p.torps > 0 ? `<span class="ok">${p.torps}</span>` : `${Math.ceil(p.def.torpedo.rearm - p.torpRearm)} s`]);
      }
      if (game.aimDist) out.push(['Entfernung', `${Math.round(game.aimDist)} m`]);
    }
    if (game.barrageReady) out.push(['Sperrfeuer', '<span class="ok">F</span>']);
    return out.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('');
  }

  project(p, cam) {
    _v.copy(p).project(cam);
    if (_v.z > 1 || _v.z < -1) return null;
    return { x: (_v.x + 1) / 2 * this.overlay.width, y: (1 - _v.y) / 2 * this.overlay.height };
  }

  drawOverlay(game, cam, view) {
    const ctx = this.ctx, dpr = this.dpr;
    const W = this.overlay.width, H = this.overlay.height;
    ctx.clearRect(0, 0, W, H);
    const p = game.player;
    const myTeam = game.myTeam ?? 0;
    this.drawCompass(ctx, cam, game, W, dpr);
    ctx.lineWidth = 1.5 * dpr;
    ctx.font = `${12 * dpr}px Bahnschrift, Arial Narrow, sans-serif`;
    ctx.textAlign = 'center';

    // Markierungen über Einheiten
    for (const u of game.units) {
      if (u === p || !u.alive || u.removed) continue;
      const top = _v2.copy(u.pos);
      top.y += u.kind === 'ship' ? u.def.top + 6 : 6;
      const s = this.project(top, cam);
      if (!s) continue;
      const dist = cam.position.distanceTo(u.pos);
      const enemy = u.team !== myTeam;
      if (!enemy && dist > 3500) continue;
      ctx.fillStyle = ctx.strokeStyle = enemy ? 'rgba(255,110,95,0.95)' : 'rgba(120,170,255,0.9)';
      const sz = 6 * dpr;
      ctx.beginPath();
      ctx.moveTo(s.x - sz, s.y - sz * 1.4); ctx.lineTo(s.x + sz, s.y - sz * 1.4); ctx.lineTo(s.x, s.y);
      ctx.closePath();
      enemy ? ctx.fill() : ctx.stroke();
      if (dist < 1800 || (enemy && dist < 3000)) {
        ctx.fillText(dist < 1000 ? `${u.name} · ${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`, s.x, s.y - sz * 2);
      }
      // Lebensbalken für Ziele in der Nähe
      if (enemy && dist < 1500 && u.hpFrac < 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(s.x - 16 * dpr, s.y + 4 * dpr, 32 * dpr, 3 * dpr);
        ctx.fillStyle = 'rgba(255,110,95,0.95)';
        ctx.fillRect(s.x - 16 * dpr, s.y + 4 * dpr, 32 * dpr * u.hpFrac, 3 * dpr);
      }
    }

    // Zonen am Horizont
    for (const z of game.zones) {
      const s = this.project(_v2.set(z.x, 40, z.z), cam);
      if (!s) continue;
      ctx.fillStyle = z.owner === 0 ? 'rgba(120,170,255,0.9)' : z.owner === 1 ? 'rgba(255,110,95,0.9)' : 'rgba(240,240,240,0.8)';
      ctx.font = `bold ${16 * dpr}px Bahnschrift, Arial Narrow, sans-serif`;
      ctx.fillText(z.name, s.x, s.y);
    }
    ctx.font = `${12 * dpr}px Bahnschrift, Arial Narrow, sans-serif`;

    if (!p || !p.alive) return;

    // Trefferrichtung: roter Bogen in Richtung des Angreifers
    const camYaw = cam.rotation.y;
    for (const d of this.dmgDirs) {
      const bearing = Math.atan2(-(d.x - cam.position.x), -(d.z - cam.position.z));
      const rel = bearing - camYaw;
      const a = -Math.PI / 2 - rel;
      const r = Math.min(W, H) * 0.16;
      ctx.strokeStyle = `rgba(255,60,40,${Math.min(1, d.t) * 0.9})`;
      ctx.lineWidth = 6 * dpr;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r, a - 0.28, a + 0.28); ctx.stroke();
    }
    ctx.lineWidth = 1.5 * dpr;

    // Fadenkreuz
    const cx = W / 2, cy = H / 2;
    if (p.kind === 'plane') {
      // Mausziel = Bildmitte, Nase = wo die Waffen hinzeigen
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(cx, cy, 9 * dpr, 0, Math.PI * 2); ctx.stroke();
      const nose = this.project(_v2.copy(p.fwd).multiplyScalar(600).add(p.pos), cam);
      if (nose) {
        ctx.strokeStyle = 'rgba(160,255,160,0.95)';
        const s = 8 * dpr;
        ctx.beginPath();
        ctx.moveTo(nose.x - s * 1.6, nose.y); ctx.lineTo(nose.x - s * 0.5, nose.y);
        ctx.moveTo(nose.x + s * 0.5, nose.y); ctx.lineTo(nose.x + s * 1.6, nose.y);
        ctx.moveTo(nose.x, nose.y - s * 0.5); ctx.lineTo(nose.x, nose.y - s * 1.2);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(nose.x, nose.y, 1.5 * dpr, 0, Math.PI * 2); ctx.fill();
      }
      // Vorhaltepunkt für das nächste Ziel
      const lead = view.lead;
      if (lead) {
        const s = this.project(lead, cam);
        if (s) {
          ctx.strokeStyle = 'rgba(255,200,80,0.95)';
          ctx.beginPath(); ctx.arc(s.x, s.y, 6 * dpr, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s.x - 10 * dpr, s.y); ctx.lineTo(s.x - 6 * dpr, s.y); ctx.moveTo(s.x + 6 * dpr, s.y); ctx.lineTo(s.x + 10 * dpr, s.y); ctx.stroke();
        }
      }
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      const g = 7 * dpr, l = 16 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx - l, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + l, cy);
      ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + l);
      ctx.stroke();
      // Turmstatus
      const n = p.turrets.length;
      p.turrets.forEach((t, i) => {
        const x = cx + (i - (n - 1) / 2) * 12 * dpr, y = cy + 30 * dpr;
        ctx.fillStyle = t.ready ? 'rgba(130,230,130,0.95)' : t.reload <= 0 ? 'rgba(240,200,80,0.9)' : 'rgba(255,255,255,0.25)';
        ctx.fillRect(x - 4 * dpr, y, 8 * dpr, 4 * dpr);
      });
      if (view.lead) {
        const s = this.project(view.lead, cam);
        if (s) {
          ctx.strokeStyle = 'rgba(255,200,80,0.95)';
          ctx.beginPath();
          ctx.moveTo(s.x, s.y - 7 * dpr); ctx.lineTo(s.x + 7 * dpr, s.y); ctx.lineTo(s.x, s.y + 7 * dpr); ctx.lineTo(s.x - 7 * dpr, s.y);
          ctx.closePath(); ctx.stroke();
        }
      }
    }

    if (this.hitT > 0) {
      ctx.strokeStyle = this.killHit ? 'rgba(255,90,70,1)' : 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2.5 * dpr;
      const a = 6 * dpr, b = 13 * dpr;
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { ctx.moveTo(cx + sx * a, cy + sy * a); ctx.lineTo(cx + sx * b, cy + sy * b); }
      ctx.stroke();
    }
  }

  // Kompassband oben: Himmelsrichtungen, Grad, Zonen
  drawCompass(ctx, cam, game, W, dpr) {
    const heading = ((-cam.rotation.y * 180 / Math.PI) % 360 + 360) % 360;
    const w = Math.min(560 * dpr, W * 0.5), x0 = W / 2 - w / 2, y = 14 * dpr, span = 120;
    const px = (deg) => {
      let d = deg - heading;
      d = ((d + 540) % 360) - 180;
      return Math.abs(d) > span / 2 ? null : W / 2 + (d / span) * w;
    };
    const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.15, 'rgba(0,0,0,0.45)');
    grad.addColorStop(0.85, 'rgba(0,0,0,0.45)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y - 6 * dpr, w, 28 * dpr);
    ctx.textAlign = 'center';
    const names = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let deg = 0; deg < 360; deg += 5) {
      const x = px(deg);
      if (x === null) continue;
      const fade = 1 - Math.abs(x - W / 2) / (w / 2);
      ctx.globalAlpha = Math.max(0, fade) * 0.95;
      ctx.strokeStyle = ctx.fillStyle = '#e8eadf';
      ctx.lineWidth = 1 * dpr;
      const major = deg % 15 === 0;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (major ? 7 : 4) * dpr); ctx.stroke();
      if (names[deg] !== undefined) {
        ctx.font = `700 ${14 * dpr}px Rajdhani, sans-serif`;
        ctx.fillStyle = deg === 0 ? '#f2b33d' : '#e8eadf';
        ctx.fillText(names[deg], x, y + 21 * dpr);
      } else if (major) {
        ctx.font = `600 ${10 * dpr}px Rajdhani, sans-serif`;
        ctx.fillText(String(deg), x, y + 19 * dpr);
      }
    }
    // Zonen als Marker auf dem Band
    for (const z of game.zones) {
      const deg = ((Math.atan2(z.x - cam.position.x, -(z.z - cam.position.z)) * 180 / Math.PI) + 360) % 360;
      const x = px(deg);
      if (x === null) continue;
      ctx.globalAlpha = 1;
      ctx.fillStyle = z.owner === (game.myTeam ?? 0) ? '#7fb0ff' : z.owner >= 0 ? '#ff7d70' : '#dddddd';
      ctx.font = `${11 * dpr}px "Black Ops One", sans-serif`;
      ctx.fillText(z.name, x, y - 9 * dpr + 6 * dpr);
    }
    ctx.globalAlpha = 1;
    // Mittelmarke
    ctx.fillStyle = '#f2b33d';
    ctx.beginPath(); ctx.moveTo(W / 2, y + 26 * dpr); ctx.lineTo(W / 2 - 5 * dpr, y + 32 * dpr); ctx.lineTo(W / 2 + 5 * dpr, y + 32 * dpr); ctx.fill();
    ctx.font = `700 ${12 * dpr}px Rajdhani, sans-serif`;
    ctx.fillText(String(Math.round(heading)).padStart(3, '0'), W / 2, y + 44 * dpr);
  }

  drawMinimap(game, cam) {
    const g = this.mini, S = 200;
    g.clearRect(0, 0, S, S);
    if (this.miniBg) g.drawImage(this.miniBg, 0, 0);
    const tx = (x) => (x / MAP_HALF + 1) / 2 * S;
    g.lineWidth = 1.5;
    for (const z of game.zones) {
      g.strokeStyle = z.owner === 0 ? '#4c8df0' : z.owner === 1 ? '#e2564a' : '#dddddd';
      g.beginPath(); g.arc(tx(z.x), tx(z.z), z.r / MAP_HALF * S / 2, 0, Math.PI * 2); g.stroke();
      g.fillStyle = g.strokeStyle;
      g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(z.name, tx(z.x), tx(z.z));
    }
    for (const u of game.units) {
      if (!u.alive) continue;
      const x = tx(u.pos.x), y = tx(u.pos.z);
      const a = Math.atan2(u.fwd.x, -u.fwd.z);
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = u.isPlayer ? '#f2b33d' : u.team === (game.myTeam ?? 0) ? '#7fb0ff' : '#ff7d70';
      const s = u.isPlayer ? 5 : u.kind === 'ship' ? 4 : 3;
      if (u.kind === 'ship') g.fillRect(-s * 0.5, -s * 1.3, s, s * 2.6);
      else { g.beginPath(); g.moveTo(0, -s * 1.4); g.lineTo(s, s); g.lineTo(-s, s); g.closePath(); g.fill(); }
      g.restore();
    }
    // Blickrichtung
    const cdx = -Math.sin(cam.rotation.y), cdz = -Math.cos(cam.rotation.y);
    const cx = tx(cam.position.x), cz = tx(cam.position.z);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.moveTo(cx, cz); g.lineTo(cx + cdx * 26, cz + cdz * 26); g.stroke();
  }
}

export function vehicleCardHtml(def, locked, lockText) {
  return `<span class="c-name">${def.name}</span><span class="c-class">${def.klasse}</span>${locked ? `<span class="c-lock">Gesperrt · ${lockText}</span>` : ''}`;
}

export function vehicleDetailsHtml(def, CALIBERS) {
  const s = def.stats;
  const bar = (label, v) => `<div class="stat"><span>${label}</span><span class="sbar"><i style="width:${v * 100}%"></i></span></div>`;
  let weapons = '';
  if (def.kind === 'plane') {
    weapons += def.guns.map((g) => `<div>${g.name} ×${g.mounts.length}</div>`).join('');
    if (def.secondary) weapons += `<div>${def.secondary.name} ×${def.secondary.count}</div>`;
    if (def.tailGun) weapons += '<div>Heck-MG (automatisch)</div>';
  } else {
    const cal = { schnellboot: '40', zerstoerer: '120', kreuzer: '203' }[def.id];
    const barrels = { schnellboot: 2, zerstoerer: 8, kreuzer: 12 }[def.id];
    weapons += `<div>${CALIBERS[cal].name} ×${barrels}</div>`;
    if (def.torpedo) weapons += `<div>Torpedos ×${def.torpedo.count}</div>`;
    weapons += `<div>Flak ×${def.aa.length} (automatisch)</div>`;
  }
  return `<h3>${def.name}</h3><div class="muted">${def.klasse}</div><p>${def.desc}</p>
    ${bar('Tempo', s.tempo)}${bar('Panzerung', s.panzer)}${bar('Feuerkraft', s.feuer)}${bar('Wendigkeit', s.wendig)}
    <div class="weapons">${weapons}</div>`;
}

export { DEFS };
