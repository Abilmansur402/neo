/**
 * SpatialCardHUD — frosted-glass telemetry cards that tilt in 3D with the cursor (CSS perspective, no WebGL),
 * plus the live incubator viewport with RGB / thermal toggle and a risk gauge overlay.
 */
import { useEffect, useRef, useState } from 'react';
import { Video, Thermometer, HeartPulse } from 'lucide-react';
import { drawInfant } from '../lib/infantBody.js';

export function useTilt(strength = 10) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const move = (e) => { const b = el.getBoundingClientRect(); const x = (e.clientX - b.left) / b.width - 0.5, y = (e.clientY - b.top) / b.height - 0.5; el.style.transform = `perspective(900px) rotateX(${-y * strength}deg) rotateY(${x * strength}deg) translateZ(6px)`; };
    const leave = () => { el.style.transform = 'perspective(900px) rotateX(0) rotateY(0)'; };
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
  }, [strength]);
  return ref;
}

export function GlassCard({ children, className = '', glow = '#2F80ED', tilt = 10, style }) {
  const ref = useTilt(tilt);
  return <div ref={ref} className={`glass-dark ${className}`} style={{ '--glow': glow, ...style }}>{children}</div>;
}

export function Metric({ label, value, unit, color = '#2F80ED', sub }) {
  return <div><div className="hud-label">{label}</div><div className="hud-num" style={{ color, textShadow: `0 0 14px ${color}33` }}>{value}<span className="hud-unit">{unit}</span></div>{sub && <div className="hud-sub">{sub}</div>}</div>;
}

/* ---- Incubator viewport (canvas) ---- */
function heat(v) { const s = [[60, 10, 110], [220, 60, 50], [255, 150, 10], [255, 230, 120]]; const x = Math.max(0, Math.min(1, v)) * 3; const i = Math.floor(x), f = x - i; const a = s[i], b = s[Math.min(i + 1, 3)]; return `rgb(${a[0] + (b[0] - a[0]) * f},${a[1] + (b[1] - a[1]) * f},${a[2] + (b[2] - a[2]) * f})`; }
// demo problem zones for the anatomy view (body point → label position), synthetic values
const HOTSPOTS = [
  { x: 14, y: -30, lx: 80, ly: -100, color: '#D9A85C', label: 'LUNGS · RDS', sub: 'FiO2 35% · S/F 269' },
  { x: 112, y: 8, lx: 160, ly: 120, color: '#F87171', label: 'GUT · NEC watch', sub: 'feeds on hold' },
  { x: -110, y: -20, lx: -60, ly: -100, color: '#2F80ED', label: 'BRAIN · IVH', sub: 'grade 0 · low risk' },
];

export function IncubatorViewport({ mode: modeProp, thermal, risk = 31 }) {
  const mode = modeProp || (thermal ? 'thermal' : 'rgb');
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; const ctx = c.getContext('2d'); let raf, alive = true; const t0 = performance.now();
    const draw = (now) => {
      if (!alive) return; const t = (now - t0) / 1000; const W = c.width, H = c.height;
      ctx.clearRect(0, 0, W, H); const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, mode === 'thermal' ? '#0B0520' : '#0A1220'); g.addColorStop(1, mode === 'thermal' ? '#1B0A3A' : '#101C30'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(0,229,255,.07)'; for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const cx = W * 0.46, cy = H * 0.5, S = H / 360, breath = Math.sin(t * 1.0 * 2 * Math.PI * 0.9), pulse = Math.sin(t * (148 / 60) * 2 * Math.PI);
      drawInfant(ctx, { cx, cy, S, t, mode, breath, pulse, heat, hotspots: HOTSPOTS });
      if (mode !== 'anatomy') { // CV landmarks belong to the camera views, not to the anatomy overlay
      const lm = [[-135, -22], [-105, -24], [-140, -12], [-118, -12], [-140, 12], [-118, 12], [-78, -14], [-78, 14], [-70, 0], [-90, -30], [-90, 30]].map(([dx, dy]) => [cx + dx * S + Math.sin(t * 2.3 + dx) * 0.6, cy + dy * S]);
      ctx.strokeStyle = '#2F80ED'; ctx.lineWidth = 1.2; ctx.shadowColor = '#2F80ED'; ctx.shadowBlur = 6; ctx.beginPath(); [[0, 1], [2, 3], [4, 5], [6, 8], [7, 8], [9, 2], [10, 4]].forEach(([a, b]) => { ctx.moveTo(lm[a][0], lm[a][1]); ctx.lineTo(lm[b][0], lm[b][1]); }); ctx.stroke();
      ctx.fillStyle = '#2F80ED'; lm.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2.4 * S, 0, Math.PI * 2); ctx.fill(); }); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,229,255,.9)'; ctx.strokeRect(cx - 160 * S, cy - 62 * S, 132 * S, 124 * S);
      ctx.strokeStyle = '#93C5FD'; ctx.setLineDash([6, 4]); ctx.strokeRect(cx - 20 * S, cy - 40 * S - breath * 3 * S, 120 * S, 100 * S + breath * 6 * S); ctx.setLineDash([]);
      ctx.font = `${11 * S}px JetBrains Mono, monospace`; ctx.fillStyle = '#2F80ED'; ctx.fillText('FACE · NFCS 2/8', cx - 160 * S, cy - 70 * S); ctx.fillStyle = '#BFE9FF'; ctx.fillText(`CHEST · RR 58 · amp ${(breath * 50 + 50).toFixed(0)}%`, cx - 20 * S, cy + 76 * S);
      }
      ctx.font = `${11 * S}px JetBrains Mono, monospace`;
      ctx.strokeStyle = '#F87171'; ctx.lineWidth = 2.5; ctx.shadowColor = '#F87171'; ctx.shadowBlur = 8; ctx.beginPath();
      const y0 = H - 40 * S, per = 150 * S, off = (t * 90) % per;
      for (let x = 0; x <= W; x += 2) { const p = ((x + off) % per) / per; let y = 0; if (p > 0.1 && p < 0.16) y = -6; else if (p > 0.18 && p < 0.21) y = 8; else if (p > 0.21 && p < 0.25) y = -34; else if (p > 0.25 && p < 0.28) y = 10; else if (p > 0.4 && p < 0.52) y = -5 * Math.sin((p - 0.4) / 0.12 * Math.PI); x === 0 ? ctx.moveTo(x, y0 + y * S) : ctx.lineTo(x, y0 + y * S); }
      ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#F87171'; ctx.fillText('ECG II · 148 bpm', 14 * S, H - 14 * S); ctx.fillStyle = '#BFE9FF'; ctx.fillText({ thermal: 'LWIR · 9 Hz · ±0.3 °C', rgb: 'CAM-07 · 1080p · 30 fps', anatomy: 'ANATOMY · synthetic' }[mode], W - 150 * S, 22 * S);
      // risk gauge overlay (top-right)
      const gx = W - 58 * S, gy = 78 * S, R = 26 * S; ctx.lineWidth = 5 * S; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(gx, gy, R, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
      const rc = risk >= 75 ? '#F87171' : risk >= 50 ? '#F59E6B' : risk >= 25 ? '#D9A85C' : '#2F80ED'; ctx.strokeStyle = rc; ctx.shadowColor = rc; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(gx, gy, R, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * (risk / 100)); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = rc; ctx.font = `bold ${15 * S}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(`${risk}%`, gx, gy + 5 * S); ctx.font = `${8 * S}px JetBrains Mono`; ctx.fillStyle = '#BFE9FF'; ctx.fillText('24H RISK', gx, gy + 36 * S); ctx.textAlign = 'left';
      const sy = (t * 60) % H; ctx.fillStyle = 'rgba(0,229,255,.06)'; ctx.fillRect(0, sy, W, 3);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw); return () => { alive = false; cancelAnimationFrame(raf); };
  }, [mode, risk]);
  return <canvas ref={ref} width={720} height={420} aria-label="Incubator telemetry HUD" style={{ display: 'block', width: '100%', height: 'auto' }} />;
}

export function IncubatorHUD({ risk = 31 }) {
  const [mode, setMode] = useState('anatomy');
  return (
    <GlassCard className="p-0 overflow-hidden" tilt={4} night>
      <div className="relative">
        <IncubatorViewport mode={mode} risk={risk} />
        <div className="absolute top-3 left-3 flex gap-2">
          <button type="button" className={`hud-btn ${mode === 'anatomy' ? 'on' : ''}`} onClick={() => setMode('anatomy')}><HeartPulse size={13} />Anatomy</button>
          <button type="button" className={`hud-btn ${mode === 'rgb' ? 'on' : ''}`} onClick={() => setMode('rgb')}><Video size={13} />RGB</button>
          <button type="button" className={`hud-btn ${mode === 'thermal' ? 'on' : ''}`} onClick={() => setMode('thermal')}><Thermometer size={13} />Thermal</button>
        </div>
      </div>
    </GlassCard>
  );
}
