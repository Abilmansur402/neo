/**
 * WebSocket helpers for CV telemetry and HIS gateway logs, with auto-reconnect
 * and a local synthesiser fallback when the backend is offline.
 */
import { api } from './api.js';
import { HIS_ENDPOINTS, HIS_SCRIPT } from '../lib/mock.js';

const WS_BASE = (import.meta.env.VITE_WS_URL || (import.meta.env.VITE_API_URL || window.location.origin)).replace(/^http/, 'ws');

function connect(path, onMessage, onStatus) {
  let ws, closed = false, attempt = 0;
  const open = () => {
    const url = `${WS_BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(api.token || '')}`;
    ws = new WebSocket(url);
    ws.onopen = () => { attempt = 0; onStatus?.('open'); };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore malformed */ } };
    ws.onclose = () => { onStatus?.('closed'); if (!closed) setTimeout(open, Math.min(1000 * 2 ** attempt++, 10000)); };
    ws.onerror = () => ws.close();
  };
  open();
  return () => { closed = true; ws?.close(); };
}

/** Local telemetry synthesiser mirroring backend/services/cv_engine.py */
function localTelemetry(patient, onMessage, hz = 4) {
  const t0 = Date.now(); let frame = 0;
  const v = patient.latest_vitals || {};
  const id = setInterval(() => {
    const t = (Date.now() - t0) / 1000; frame += 1;
    const hr = (v.heart_rate || 150) + 3 * Math.sin(t / 2), rr = (v.resp_rate || 55) + 2 * Math.sin(t / 3);
    const spo2 = (v.spo2 || 95) + (Math.random() - 0.5) * 0.8;
    const cyan = Math.max(0, (94 - spo2) / 14);
    const base = [[0.31, 0.44], [0.37, 0.44], [0.30, 0.47], [0.35, 0.47], [0.30, 0.53], [0.35, 0.53], [0.42, 0.46], [0.42, 0.54], [0.44, 0.50], [0.38, 0.41], [0.38, 0.59]];
    const pulse = 0.002 * Math.sin(2 * Math.PI * hr / 60 * t), jitter = 0.0015 * (patient.nfcs / 8);
    const resp_phase = Math.sin(2 * Math.PI * rr / 60 * t);
    const skin = patient.skin_temp_c || 36.4;
    const temps = { forehead: +(skin + 0.3).toFixed(1), chest: +(skin + 0.4).toFixed(1), abdomen: +(skin + 0.2).toFixed(1), hand: +(skin - 1.1).toFixed(1), foot: +(skin - 1.4).toFixed(1) };
    onMessage({ type: 'telemetry', patient_id: patient.id, frame: {
      ts: Date.now() / 1000, frame_no: frame, heart_rate: +hr.toFixed(1), resp_rate: +rr.toFixed(1), resp_phase, spo2: +spo2.toFixed(1), cyanosis_index: +cyan.toFixed(3),
      nfcs_score: patient.nfcs, landmarks: base.map(([x, y]) => [x + pulse + (Math.random() - 0.5) * jitter, y + (Math.random() - 0.5) * jitter]),
      chest_roi: [0.47, 0.37 - 0.01 * resp_phase, 0.17, 0.28 + 0.02 * resp_phase], posture: 'supine · symmetric · tone normal', surface_temps: temps, core_periph_gradient: +(temps.chest - temps.foot).toFixed(1),
    } });
  }, 1000 / hz);
  return () => clearInterval(id);
}

export function subscribeTelemetry(patient, onMessage, onStatus) {
  if (api.online) return connect(`/api/cv/ws/telemetry/${patient.id}`, onMessage, onStatus);
  onStatus?.('local');
  return localTelemetry(patient, onMessage);
}

export function subscribeHisLog(onMessage, onStatus) {
  if (api.online) return connect('/api/integration/ws/his', onMessage, onStatus);
  onStatus?.('local');
  let i = 0;
  const id = setInterval(() => {
    if (i >= HIS_SCRIPT.length) return;
    const [level, msg] = HIS_SCRIPT[i++];
    onMessage({ type: 'log', entry: { t: Date.now() / 1000, level, msg }, endpoints: HIS_ENDPOINTS.map((e) => ({ ...e, status: i >= e.ready_at ? 'live' : 'connecting' })) });
  }, 650);
  return () => clearInterval(id);
}
