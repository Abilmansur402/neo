/**
 * Pointer light + sound layer.
 *  - Cards, tiles and buttons get a soft highlight and a shadow that leans away from the cursor (CSS vars --mx/--my/--sx/--sy).
 *  - A faint teal glow follows the pointer across the page.
 *  - Tiny synthesised sounds (Web Audio, no files) on hover, click, result and alert. Muted state is persisted.
 * Everything respects prefers-reduced-motion and is a no-op on touch devices.
 */

/* ---------------- sound ---------------- */
const KEY = 'neo.sound';
let ctx = null;
let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
const listeners = new Set();

function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, { dur = 0.06, gain = 0.05, type = 'sine', at = 0, slide = 0 } = {}) {
  const c = ac(); if (!c || !enabled) return;
  const t0 = c.currentTime + at;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}

let lastHover = 0;
export const sfx = {
  get enabled() { return enabled; },
  set(on) { enabled = on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ } listeners.forEach((f) => f(on)); if (on) sfx.click(); },
  subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
  hover() { const now = performance.now(); if (now - lastHover < 70) return; lastHover = now; tone(1480, { dur: 0.03, gain: 0.012 }); },
  click() { tone(740, { dur: 0.05, gain: 0.04, type: 'triangle' }); tone(1180, { dur: 0.06, gain: 0.03, at: 0.03 }); },
  toggle() { tone(620, { dur: 0.05, gain: 0.035, type: 'triangle', slide: 300 }); },
  success() { [660, 880, 1320].forEach((f, i) => tone(f, { dur: 0.12, gain: 0.04, at: i * 0.09 })); },
  warn() { [880, 880].forEach((f, i) => tone(f, { dur: 0.1, gain: 0.05, type: 'square', at: i * 0.16 })); },
  alert() { [988, 1319, 988, 1319].forEach((f, i) => tone(f, { dur: 0.09, gain: 0.05, type: 'square', at: i * 0.13 })); },
  error() { tone(330, { dur: 0.18, gain: 0.05, type: 'sawtooth', slide: -120 }); },
};

/* ---------------- pointer light ---------------- */
const LIT = '.card, .card-pop, .tile, .btn, .glass, .nav-item, .hud-portal, .hud-cta';
const NOISY = 'button, a, .tile, .nav-item, [role="button"], select, input[type="checkbox"]';
let installed = false;

export function installFx() {
  if (installed || typeof window === 'undefined') return; installed = true;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;

  // sounds: delegated hover / click
  let hoverEl = null;
  document.addEventListener('pointerover', (e) => { const el = e.target.closest?.(NOISY); if (el && el !== hoverEl) { hoverEl = el; if (!el.disabled) sfx.hover(); } }, { passive: true });
  document.addEventListener('pointerout', (e) => { if (hoverEl && !hoverEl.contains(e.relatedTarget)) hoverEl = null; }, { passive: true });
  document.addEventListener('click', (e) => { const el = e.target.closest?.('button, a, .tile, [role="button"]'); if (el && !el.disabled) sfx.click(); ac(); }, { passive: true });
  document.addEventListener('change', (e) => { if (e.target.matches?.('select, input[type="checkbox"], input[type="range"]')) sfx.toggle(); }, { passive: true });

  if (reduce || coarse) return;

  // pointer glow
  const glow = document.createElement('div'); glow.id = 'cursor-glow'; glow.setAttribute('aria-hidden', 'true'); document.body.appendChild(glow);
  let gx = window.innerWidth / 2, gy = window.innerHeight / 2, tx = gx, ty = gy, raf = 0;
  const step = () => { gx += (tx - gx) * 0.18; gy += (ty - gy) * 0.18; glow.style.transform = `translate(${gx - 160}px, ${gy - 160}px)`; if (Math.abs(tx - gx) + Math.abs(ty - gy) > 0.3) raf = requestAnimationFrame(step); else raf = 0; };

  let lit = null;
  document.addEventListener('pointermove', (e) => {
    tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(step);
    const el = e.target.closest?.(LIT);
    if (lit && lit !== el) { lit.style.removeProperty('--mx'); lit.style.removeProperty('--my'); lit.style.removeProperty('--sx'); lit.style.removeProperty('--sy'); lit.classList.remove('lit'); }
    lit = el; if (!el) return;
    const r = el.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    el.style.setProperty('--mx', `${x}px`); el.style.setProperty('--my', `${y}px`);
    el.style.setProperty('--sx', `${((0.5 - x / r.width) * 16).toFixed(1)}px`); el.style.setProperty('--sy', `${((0.5 - y / r.height) * 16 + 10).toFixed(1)}px`);
    el.classList.add('lit');
  }, { passive: true });
  document.addEventListener('pointerleave', () => { glow.style.opacity = '0'; }, { passive: true });
  document.addEventListener('pointerenter', () => { glow.style.opacity = ''; }, { passive: true });
}
