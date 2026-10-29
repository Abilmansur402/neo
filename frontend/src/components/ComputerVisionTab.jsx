import { useEffect, useRef, useState } from 'react';
import { Video, ScanFace, Thermometer, Eye, Upload } from 'lucide-react';
import { Card, Badge } from '../lib/ui.jsx';
import { api } from '../services/api.js';
import { subscribeTelemetry } from '../services/websocket.js';
import { seeded } from '../lib/risk.js';
import { OriginPill } from './DataOrigin.jsx';

/* ---------- helpers ---------- */
function useCanvas(draw, deps) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return; const ctx = c.getContext('2d'); let raf, alive = true; const t0 = performance.now();
    const loop = (now) => { if (!alive) return; draw(ctx, c.width, c.height, (now - t0) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop); return () => { alive = false; cancelAnimationFrame(raf); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
export function heatColor(v) {
  const stops = [[0, 10, 30], [60, 10, 110], [150, 20, 120], [220, 60, 50], [255, 150, 10], [255, 230, 120], [255, 255, 255]];
  const x = Math.max(0, Math.min(1, v)) * (stops.length - 1); const i = Math.floor(x), f = x - i; const a = stops[i], b = stops[Math.min(i + 1, stops.length - 1)];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}

/* ---------- Live incubator stream ---------- */
function LiveStream({ patient, frameRef, thermal, tracking }) {
  const ref = useCanvas((ctx, W, H, t) => {
    const f = frameRef.current; if (!f) return;
    const breath = f.resp_phase, pulse = Math.sin(t * (f.heart_rate / 60) * 2 * Math.PI), cyan = f.cyanosis_index;
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, thermal ? '#05030F' : '#163452'); g.addColorStop(1, thermal ? '#0B0520' : '#0B2239'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!thermal) { ctx.strokeStyle = 'rgba(148,163,184,.08)'; for (let x = 0; x < W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); } for (let y = 0; y < H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); } }
    const cx = W * 0.5, cy = H * 0.52, S = H / 360; const core = ((f.surface_temps?.chest ?? 36.4) - 33.4) / 4.5;
    const skin = (v) => (thermal ? heatColor(v) : `rgb(${Math.round(232 - cyan * 60)},${Math.round(190 - cyan * 40)},${Math.round(178 + cyan * 40)})`);
    const parts = [
      { x: cx + 40 * S, y: cy + 10 * S, rx: 95 * S, ry: 58 * S + breath * 3 * S, temp: core },
      { x: cx + 150 * S, y: cy - 20 * S, rx: 55 * S, ry: 20 * S, rot: -0.4, temp: core - 0.18 }, { x: cx + 150 * S, y: cy + 50 * S, rx: 55 * S, ry: 20 * S, rot: 0.4, temp: core - 0.2 },
      { x: cx - 10 * S, y: cy - 60 * S, rx: 42 * S, ry: 16 * S, rot: -0.9, temp: core - 0.12 }, { x: cx - 10 * S, y: cy + 80 * S, rx: 42 * S, ry: 16 * S, rot: 0.9, temp: core - 0.14 },
      { x: cx - 95 * S, y: cy, rx: 62 * S, ry: 56 * S, temp: core + 0.05 },
    ];
    parts.forEach((b) => { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot || 0); if (thermal) { const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(b.rx, b.ry)); rg.addColorStop(0, heatColor(b.temp + 0.1)); rg.addColorStop(0.7, heatColor(b.temp)); rg.addColorStop(1, heatColor(b.temp - 0.35)); ctx.fillStyle = rg; } else ctx.fillStyle = skin(b.temp); ctx.beginPath(); ctx.ellipse(0, 0, b.rx, b.ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); });
    if (!thermal) {
      ctx.fillStyle = '#1F2937'; [[-115, -12], [-115, 12]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.ellipse(cx + dx * S, cy + dy * S, 5 * S, 3 * S, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.strokeStyle = 'rgba(31,41,55,.7)'; ctx.lineWidth = 2 * S; ctx.beginPath(); ctx.moveTo(cx - 70 * S, cy - 8 * S); ctx.quadraticCurveTo(cx - 62 * S, cy, cx - 70 * S, cy + 8 * S); ctx.stroke();
      ctx.strokeStyle = 'rgba(226,232,240,.75)'; ctx.lineWidth = 1.5 * S; ctx.beginPath(); ctx.moveTo(cx - 90 * S, cy); ctx.lineTo(cx - 90 * S, cy - 70 * S); ctx.lineTo(cx - 160 * S, cy - 120 * S); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; [[20, -20], [60, 20]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.arc(cx + dx * S, cy + dy * S, 5 * S, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx + dx * S, cy + dy * S); ctx.lineTo(cx + (dx + 40) * S, cy + (dy + 120) * S); ctx.stroke(); });
    }
    if (tracking) {
      const lm = f.landmarks.map(([x, y]) => [x * W + pulse * S, y * H]);
      ctx.strokeStyle = '#16A34A'; ctx.lineWidth = 1; ctx.beginPath(); [[0, 1], [2, 3], [4, 5], [6, 8], [7, 8], [9, 2], [10, 4]].forEach(([a, b]) => { ctx.moveTo(lm[a][0], lm[a][1]); ctx.lineTo(lm[b][0], lm[b][1]); }); ctx.stroke();
      ctx.fillStyle = '#16A34A'; lm.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 2.2 * S, 0, Math.PI * 2); ctx.fill(); });
      const [rx, ry, rw, rh] = f.chest_roi; ctx.strokeStyle = '#0E9F9B'; ctx.setLineDash([6, 4]); ctx.strokeRect(rx * W, ry * H, rw * W, rh * H); ctx.setLineDash([]);
      ctx.fillStyle = '#0E9F9B'; ctx.font = `${11 * S}px JetBrains Mono, monospace`; ctx.fillText(`RESP ROI  RR ${f.resp_rate.toFixed(0)}  amp ${(breath * 50 + 50).toFixed(0)}%`, rx * W, ry * H - 6 * S);
      ctx.strokeStyle = 'rgba(91,107,140,.9)'; ctx.strokeRect(cx - 165 * S, cy - 90 * S, 380 * S, 185 * S); ctx.fillStyle = '#A78BFA'; ctx.fillText(`POSTURE  ${f.posture}`, cx - 165 * S, cy + 110 * S);
      ctx.strokeStyle = '#16A34A'; ctx.strokeRect(cx - 160 * S, cy - 62 * S, 132 * S, 124 * S); ctx.fillStyle = '#16A34A'; ctx.fillText(`FACE  NFCS ${f.nfcs_score}/8`, cx - 160 * S, cy - 68 * S);
      if (!thermal) { const c = cyan > 0.3 ? '#E5484D' : '#16A34A'; ctx.strokeStyle = c; ctx.strokeRect(cx + 150 * S, cy + 40 * S, 40 * S, 20 * S); ctx.fillStyle = c; ctx.fillText(`PERFUSION ${cyan > 0.3 ? 'cyanosis ' + (cyan * 100).toFixed(0) + '%' : 'pink'}`, cx + 150 * S, cy + 76 * S); }
    }
    // respiration waveform strip
    ctx.strokeStyle = 'rgba(15,76,129,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let x = 0; x < 180 * S; x += 2) { const y = H - 26 * S - Math.sin((x / (180 * S)) * Math.PI * 4 - t * (f.resp_rate / 60) * 2 * Math.PI) * 8 * S; x === 0 ? ctx.moveTo(W - 190 * S + x, y) : ctx.lineTo(W - 190 * S + x, y); } ctx.stroke();
    const sy = (t * 60) % H; ctx.fillStyle = 'rgba(0,168,150,.06)'; ctx.fillRect(0, sy, W, 2);
  }, [patient.id, thermal, tracking]);
  return <canvas ref={ref} width={720} height={360} aria-label="Live NICU video stream simulation" />;
}

/* ---------- Synthetic X-ray & ultrasound (client Grad-CAM render) ---------- */
function Xray({ finding, cam, opacity }) {
  const ref = useCanvas((ctx, W, H, t) => {
    ctx.fillStyle = '#05070D'; ctx.fillRect(0, 0, W, H); const cx = W / 2, cy = H * 0.52, S = H / 360;
    const body = ctx.createRadialGradient(cx, cy, 20 * S, cx, cy, 190 * S); body.addColorStop(0, '#3A3F4A'); body.addColorStop(1, '#0A0C12'); ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(cx, cy + 20 * S, 170 * S, 165 * S, 0, 0, Math.PI * 2); ctx.fill();
    const rds = finding === 'rds' || finding === 'ett';
    const lung = (dx, hazy) => { const lg = ctx.createRadialGradient(cx + dx, cy, 10 * S, cx + dx, cy, 90 * S); lg.addColorStop(0, hazy ? '#6B7280' : '#1F2733'); lg.addColorStop(1, hazy ? '#4B5563' : '#111827'); ctx.fillStyle = lg; ctx.beginPath(); ctx.ellipse(cx + dx, cy, 62 * S, 105 * S, 0, 0, Math.PI * 2); ctx.fill(); };
    lung(-75 * S, rds); lung(75 * S, rds && finding !== 'pneumothorax');
    if (finding === 'pneumothorax') { ctx.fillStyle = '#05070D'; ctx.beginPath(); ctx.ellipse(cx + 75 * S, cy - 60 * S, 58 * S, 45 * S, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#9CA3AF'; ctx.beginPath(); ctx.ellipse(cx + 75 * S, cy - 25 * S, 50 * S, 30 * S, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); }
    if (rds) { ctx.fillStyle = 'rgba(203,213,225,.18)'; for (let i = 0; i < 400; i++) { const a = (i * 137.5) * Math.PI / 180, r = Math.sqrt(i / 400); ctx.fillRect(cx + (i % 2 ? -75 : 75) * S + Math.cos(a) * r * 55 * S, cy + Math.sin(a) * r * 95 * S, 2, 2); } }
    ctx.fillStyle = '#5B6270'; ctx.beginPath(); ctx.ellipse(cx - 12 * S, cy + 30 * S, 48 * S, 58 * S, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9AA3B2'; for (let i = 0; i < 11; i++) ctx.fillRect(cx - 9 * S, cy - 120 * S + i * 22 * S, 18 * S, 13 * S);
    ctx.strokeStyle = 'rgba(203,213,225,.55)'; ctx.lineWidth = 4 * S; for (let i = 0; i < 8; i++) { const y = cy - 105 * S + i * 26 * S; [-1, 1].forEach((s) => { ctx.beginPath(); ctx.moveTo(cx, y); ctx.quadraticCurveTo(cx + s * 120 * S, y - 10 * S, cx + s * 150 * S, y + 40 * S); ctx.stroke(); }); }
    ctx.strokeStyle = '#D9E8EC'; ctx.lineWidth = 3 * S; ctx.beginPath(); ctx.moveTo(cx + 2 * S, 0); ctx.lineTo(cx + 2 * S, cy - (finding === 'ett' ? 38 : 72) * S); ctx.stroke();
    ctx.fillStyle = '#D9E8EC'; ctx.font = `${10 * S}px JetBrains Mono`; ctx.fillText('ETT', cx + 8 * S, cy - 76 * S); ctx.fillText('R', W - 24 * S, 20 * S); ctx.fillText('AP · supine · synthetic', 10 * S, H - 10 * S);
    if (cam) { const blobs = { rds: [[-75, 10, 95], [75, 10, 95], [0, 60, 50]], pneumothorax: [[75, -60, 70], [100, -10, 40]], ett: [[2, -45, 55], [-30, -30, 30]] }[finding] || []; const pul = 0.9 + Math.sin(t * 2) * 0.05;
      blobs.forEach(([dx, dy, r], i) => { const g = ctx.createRadialGradient(cx + dx * S, cy + dy * S, 0, cx + dx * S, cy + dy * S, r * S * pul); const base = i === 0 ? '255,45,85' : '255,149,0'; g.addColorStop(0, `rgba(${base},${0.85 * opacity})`); g.addColorStop(0.45, `rgba(255,230,0,${0.45 * opacity})`); g.addColorStop(0.75, `rgba(0,168,150,${0.25 * opacity})`); g.addColorStop(1, 'rgba(15,76,129,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }); }
  }, [finding, cam, opacity]);
  return <canvas ref={ref} width={540} height={360} aria-label="Chest X-ray with Grad-CAM overlay" />;
}
const US_NOISE = (() => { const r = seeded(7); return Array.from({ length: 2600 }, () => [r(), r(), r()]); })();
function Ultrasound({ grade, cam, opacity }) {
  const ref = useCanvas((ctx, W, H, t) => {
    ctx.fillStyle = '#05070D'; ctx.fillRect(0, 0, W, H); const ax = W / 2, ay = 14, R = H - 24, S = H / 360;
    ctx.save(); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.arc(ax, ay, R, Math.PI * 0.3, Math.PI * 0.7); ctx.closePath(); ctx.clip();
    const bg = ctx.createRadialGradient(ax, ay, 10, ax, ay, R); bg.addColorStop(0, '#2B303B'); bg.addColorStop(1, '#0B0E14'); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    US_NOISE.forEach(([a, b, c]) => { const ang = Math.PI * (0.3 + a * 0.4), rr = b * R; ctx.fillStyle = `rgba(226,232,240,${0.05 + c * 0.25})`; ctx.fillRect(ax + Math.cos(ang) * rr, ay + Math.sin(ang) * rr, 2, 2); });
    ctx.fillStyle = '#0A0D14'; [[-42, 150, 26, 62], [42, 150, 26, 62]].forEach(([dx, dy, rx, ry]) => { ctx.beginPath(); ctx.ellipse(ax + dx * S, ay + dy * S + (grade >= 3 ? 10 * S : 0), rx * S * (grade >= 3 ? 1.5 : 1), ry * S * (grade >= 3 ? 1.4 : 1), 0, 0, Math.PI * 2); ctx.fill(); });
    if (grade >= 1) { const sz = grade === 1 ? 12 : grade === 2 ? 20 : 30; const g = ctx.createRadialGradient(ax - 50 * S, ay + 130 * S, 0, ax - 50 * S, ay + 130 * S, sz * S); g.addColorStop(0, '#F3F1EA'); g.addColorStop(1, 'rgba(241,245,249,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ax - 50 * S, ay + 130 * S, sz * S, 0, Math.PI * 2); ctx.fill(); }
    if (grade >= 2) { ctx.fillStyle = 'rgba(241,245,249,.65)'; ctx.beginPath(); ctx.ellipse(ax - 42 * S, ay + 170 * S, 16 * S, 30 * S, 0, 0, Math.PI * 2); ctx.fill(); }
    if (grade === 4) { const g = ctx.createRadialGradient(ax - 95 * S, ay + 150 * S, 0, ax - 95 * S, ay + 150 * S, 34 * S); g.addColorStop(0, '#D9E8EC'); g.addColorStop(1, 'rgba(226,232,240,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ax - 95 * S, ay + 150 * S, 34 * S, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(226,232,240,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay + 20); ctx.lineTo(ax, ay + R - 10); ctx.stroke();
    if (cam && grade > 0) { const pul = 0.9 + Math.sin(t * 2) * 0.05; const r = (grade * 18 + 20) * S * pul; const g = ctx.createRadialGradient(ax - 55 * S, ay + 145 * S, 0, ax - 55 * S, ay + 145 * S, r); g.addColorStop(0, `rgba(217,56,30,${0.85 * opacity})`); g.addColorStop(0.5, `rgba(217,119,6,${0.45 * opacity})`); g.addColorStop(1, 'rgba(15,76,129,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (grade === 4) { const g2 = ctx.createRadialGradient(ax - 95 * S, ay + 150 * S, 0, ax - 95 * S, ay + 150 * S, 50 * S); g2.addColorStop(0, `rgba(91,107,140,${0.7 * opacity})`); g2.addColorStop(1, 'rgba(91,107,140,0)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H); } }
    ctx.restore();
    ctx.fillStyle = '#D9E8EC'; ctx.font = `${10 * S}px JetBrains Mono`; ctx.fillText('CORONAL · anterior fontanelle · 8 MHz · synthetic', 10 * S, H - 10 * S);
  }, [grade, cam, opacity]);
  return <canvas ref={ref} width={540} height={360} aria-label="Cranial ultrasound with IVH heatmap" />;
}

const XR_FINDINGS = [{ id: 'rds', name: 'Neonatal RDS', p: 0.91, note: 'Bilateral ground-glass, air bronchograms, low lung volumes' }, { id: 'pneumothorax', name: 'Pneumothorax risk', p: 0.34, note: 'Right apical lucency; monitor after surfactant' }, { id: 'ett', name: 'ETT placement', p: 0.78, note: 'Tip 0.6 cm above carina (T2) — within range' }];
const NFCS = ['Brow bulge', 'Eye squeeze', 'Nasolabial furrow', 'Open lips', 'Vertical mouth stretch', 'Taut tongue', 'Chin quiver', 'Lip purse'];
const IVH_LABEL = ['No haemorrhage', 'Grade I · germinal matrix', 'Grade II · intraventricular, no dilation', 'Grade III · with ventricular dilation', 'Grade IV · parenchymal extension'];

/* ---------- Upload + server Grad-CAM ---------- */
function ImageUploader({ modality, target, alpha, onResult }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const upload = async (file) => { if (!file) return; setBusy(true); setErr(''); try { onResult(await api.analyzeImage(file, modality, target, alpha)); } catch (e) { setErr(api.online === false ? 'Server Grad-CAM needs the backend running; showing the synthetic study.' : e.message); } finally { setBusy(false); } };
  return (
    <div className="flex items-center gap-3 mt-3 text-xs">
      <label className="btn cursor-pointer"><Upload size={14} />{busy ? 'Analysing…' : `Upload ${modality === 'cxr' ? 'X-ray' : 'ultrasound'} (PNG/JPEG)`}<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} /></label>
      {err && <span className="text-coral">{err}</span>}
    </div>
  );
}

export default function ComputerVisionTab({ patient }) {
  const [thermal, setThermal] = useState(false); const [tracking, setTracking] = useState(true);
  const [finding, setFinding] = useState('rds'); const [cam, setCam] = useState(true); const [opacity, setOpacity] = useState(0.75);
  const [grade, setGrade] = useState(patient.gestational_age_wk < 29 ? 2 : 0);
  const [status, setStatus] = useState('connecting'); const [frame, setFrame] = useState(null); const frameRef = useRef(null);
  const [xrResult, setXrResult] = useState(null); const [usResult, setUsResult] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { setGrade(patient.gestational_age_wk < 29 ? 2 : 0); setXrResult(null); setUsResult(null); }, [patient.id]);
  useEffect(() => {
    let n = 0;
    const stop = subscribeTelemetry(patient, (msg) => { if (msg.type === 'telemetry') { frameRef.current = msg.frame; if (n++ % 4 === 0) setFrame(msg.frame); } }, setStatus);
    const timer = setInterval(() => setTick((x) => x + 1), 1000);
    return () => { stop(); clearInterval(timer); };
  }, [patient.id]);

  const f = frame; const cyan = f?.cyanosis_index ?? 0; const nfcs = f?.nfcs_score ?? patient.nfcs;
  const temps = f?.surface_temps ? Object.entries(f.surface_temps) : [];
  const gradient = f?.core_periph_gradient ?? 0;
  const xrFindings = xrResult?.findings?.map((x) => ({ id: x.id, name: x.name, p: x.probability, note: x.note })) || XR_FINDINGS;

  return (
    <div className="grid gap-4">
      <div className="grid xl:grid-cols-[1fr_300px] gap-4">
        <Card title={<span className="flex items-center gap-2"><Video size={16} /> Live incubator stream · Bed {patient.bed} · {patient.id}</span>} sub={`WebSocket telemetry (${status === 'open' ? 'server · /api/cv/ws/telemetry' : status === 'local' ? 'local synthesiser' : status}) · NFCS landmarks, chest-wall motion, perfusion proxy, posture`} right={<div className="flex flex-wrap gap-2 items-center"><OriginPill kind="simulated">simulated · pending validation</OriginPill><button type="button" className={`btn ${tracking ? 'btn-dark' : ''}`} onClick={() => setTracking((x) => !x)}><ScanFace size={16} />Tracking</button><button type="button" className={`btn ${thermal ? 'btn-primary' : ''}`} onClick={() => setThermal((x) => !x)}><Thermometer size={16} />{thermal ? 'Thermal' : 'RGB'}</button></div>}>
          <div className="viewport">
            <LiveStream patient={patient} frameRef={frameRef} thermal={thermal} tracking={tracking} />
            <div className="hud">
              <span className="corner" style={{ top: 10, left: 10, borderWidth: '2px 0 0 2px' }} /><span className="corner" style={{ top: 10, right: 10, borderWidth: '2px 2px 0 0' }} /><span className="corner" style={{ bottom: 10, left: 10, borderWidth: '0 0 2px 2px' }} /><span className="corner" style={{ bottom: 10, right: 10, borderWidth: '0 2px 2px 0' }} />
              <div className="absolute top-3 left-8 flex items-center gap-2"><span className="dot" style={{ background: '#E5484D', boxShadow: '0 0 8px #E5484D' }} />REC · CAM-{patient.bed} · {thermal ? 'LWIR 640×512 · 9 Hz' : 'RGB 1080p · 30 fps'}</div>
              <div className="absolute top-3 right-8">{String(Math.floor(tick / 60)).padStart(2, '0')}:{String(tick % 60).padStart(2, '0')} · frame {f?.frame_no ?? 0}</div>
              <div className="absolute bottom-3 left-8 flex flex-wrap gap-x-5 gap-y-1"><span>HR <b style={{ color: '#16A34A' }}>{f ? f.heart_rate.toFixed(0) : '—'}</b></span><span>RR(cv) <b style={{ color: '#0E9F9B' }}>{f ? f.resp_rate.toFixed(0) : '—'}</b></span><span>SpO2 <b>{f ? f.spo2.toFixed(0) : '—'}</b></span><span>NFCS <b style={{ color: nfcs >= 4 ? '#E5484D' : '#16A34A' }}>{nfcs}/8</b></span><span>Perfusion <b style={{ color: cyan > 0.3 ? '#E5484D' : '#16A34A' }}>{cyan > 0.3 ? 'cyanotic' : 'pink'}</b></span>{thermal && <span>Core-periph Δ <b style={{ color: gradient > 2 ? '#F59E0B' : '#16A34A' }}>{gradient} °C</b></span>}</div>
            </div>
          </div>
        </Card>
        <div className="grid gap-4">
          <Card title="Pain · NFCS" sub="Neonatal Facial Coding System, 0–8">
            <div className="big-num text-5xl" style={{ color: nfcs >= 4 ? '#E5484D' : nfcs >= 2 ? '#F59E0B' : '#16A34A' }}>{nfcs}<span className="text-xl muted">/8</span></div>
            <div className="grid gap-1.5 mt-3 text-xs">{NFCS.map((n, i) => <div key={n} className="flex items-center gap-2"><span className="dot" style={{ background: i < nfcs ? '#E5484D' : '#D9E8EC' }} /><span className={i < nfcs ? '' : 'muted'}>{n}</span></div>)}</div>
            <p className="muted text-xs mt-3">{nfcs >= 4 ? 'Score ≥ 4 suggests procedural pain; review analgesia and handling.' : 'Below treatment threshold.'}</p>
          </Card>
          <Card title="Surface temperature" sub={thermal ? 'LWIR emissivity 0.98 · ±0.3 °C' : 'Switch to Thermal for the live map'}>
            <div className="grid gap-2">{temps.map(([n, v]) => <div key={n} className="flex items-center gap-3 text-xs"><span className="w-16 muted capitalize">{n}</span><div className="meter flex-1"><span style={{ width: `${((v - 32) / 6) * 100}%`, background: heatColor((v - 33) / 4.5) }} /></div><span className="mono w-12 text-right">{v.toFixed(1)}°</span></div>)}</div>
            <div className="flex items-center justify-between mt-3 text-xs"><span className="muted">Core-peripheral gradient</span><Badge tone={gradient > 2 ? 'moderate' : 'low'}>{gradient} °C</Badge></div>
          </Card>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Chest X-ray · Grad-CAM" sub={xrResult ? `Server inference · ${xrResult.backend}` : 'Synthetic study · upload a film for server inference'} right={<div className="flex flex-wrap gap-2 items-center"><OriginPill kind={xrResult ? 'model' : 'simulated'}>{xrResult ? 'uploaded film' : 'synthetic study'}</OriginPill><button type="button" className={`btn ${cam ? 'btn-primary' : ''}`} onClick={() => setCam((x) => !x)}><Eye size={16} />Grad-CAM</button></div>}>
          <div className="viewport">{xrResult && cam ? <img src={`data:image/png;base64,${xrResult.overlay_png_base64}`} alt="Grad-CAM overlay" /> : <Xray finding={finding} cam={cam} opacity={opacity} />}</div>
          <div className="grid gap-2 mt-3">{xrFindings.map((x, i) => <button key={x.id} type="button" className={`tile py-2 ${finding === x.id ? 'selected' : ''}`} onClick={() => setFinding(x.id)}><div className="flex items-center gap-3"><div className="big-num text-xl w-14" style={{ color: x.p > 0.7 ? '#E5484D' : x.p > 0.3 ? '#F59E0B' : '#16A34A' }}>{Math.round(x.p * 100)}%</div><div className="min-w-0 flex-1"><div className="font-semibold text-sm">{x.name}</div><div className="muted text-xs">{x.note}</div></div><Badge tone={finding === x.id ? 'primary' : 'muted'}>{finding === x.id ? 'focus' : 'view'}</Badge></div></button>)}</div>
          <div className="flex items-center gap-3 mt-3 text-xs"><label htmlFor="cam-op" className="muted">Overlay opacity</label><input id="cam-op" type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} className="flex-1" /><span className="mono w-10 text-right">{Math.round(opacity * 100)}%</span></div>
          <ImageUploader modality="cxr" target={XR_FINDINGS.findIndex((x) => x.id === finding)} alpha={opacity} onResult={setXrResult} />
        </Card>
        <Card title="Cranial ultrasound · IVH" sub={usResult ? `Server inference · ${usResult.backend}` : 'Coronal view · Papile grading · synthetic'} right={<div className="flex flex-wrap gap-2 items-center"><OriginPill kind={usResult ? 'model' : 'simulated'}>{usResult ? 'uploaded scan' : 'synthetic study'}</OriginPill><Badge tone={grade >= 3 ? 'critical' : grade >= 1 ? 'moderate' : 'low'}>{grade === 0 ? 'clear' : `IVH grade ${['', 'I', 'II', 'III', 'IV'][grade]}`}</Badge></div>}>
          <div className="viewport">{usResult && cam ? <img src={`data:image/png;base64,${usResult.overlay_png_base64}`} alt="IVH Grad-CAM overlay" /> : <Ultrasound grade={grade} cam={cam} opacity={opacity} />}</div>
          <div className="mt-3"><div className="flex justify-between text-xs mb-1"><label htmlFor="ivh" className="muted">Simulated finding</label><span className="font-semibold">{IVH_LABEL[grade]}</span></div><input id="ivh" type="range" min={0} max={4} step={1} value={grade} onChange={(e) => setGrade(parseInt(e.target.value, 10))} /></div>
          <div className="grid grid-cols-2 gap-3 mt-3 text-xs"><div className="card p-3"><div className="eyebrow">Model confidence</div><div className="big-num text-2xl mt-1">{usResult ? Math.round(Math.max(...usResult.findings.map((x) => x.probability)) * 100) : [96, 82, 88, 91, 94][grade]}%</div></div><div className="card p-3"><div className="eyebrow">Recommended</div><div className="mt-1">{['Routine screen day 7', 'Repeat scan 48 h', 'Repeat scan 48 h · neuro consult', 'Serial OFC · neurosurgery alert', 'Urgent neurosurgery review'][grade]}</div></div></div>
          <ImageUploader modality="cus" target={grade} alpha={opacity} onResult={setUsResult} />
        </Card>
      </div>
    </div>
  );
}
