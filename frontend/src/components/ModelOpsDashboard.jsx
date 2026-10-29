/**
 * ModelOpsDashboard — analyst interface for the retraining engine:
 * trigger a run, watch progress, upload a dataset (auto-retrain), compare versions, roll back / activate.
 */
import { useEffect, useRef, useState } from 'react';
import { Cpu, Play, Upload, RotateCcw, CheckCircle2, AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, ReferenceLine } from 'recharts';
import { Card, Badge, Stat } from '../lib/ui.jsx';
import { api } from '../services/api.js';

const STATUS_TONE = { active: 'low', candidate: 'primary', archived: 'muted', rolled_back: 'moderate', failed: 'critical' };
const TRIGGER_LABEL = { manual: 'manual', dataset_upload: 'dataset upload', feedback_loop: 'clinician feedback', scheduler: 'scheduler', bootstrap: 'bootstrap' };

export function DatasetUploader({ onDone, compact }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [retrain, setRetrain] = useState(true);
  const upload = async (file) => {
    if (!file) return; setBusy(true); setMsg(null);
    try { const r = await api.uploadDataset(file, retrain); setMsg({ ok: true, text: `${r.file}: ${r.rows} rows, ${r.features_present}/31 features, prevalence ${Math.round(r.prevalence * 100)}%${r.retrain_started ? ' — retraining started' : ''}` }); onDone?.(r); }
    catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  return (
    <div className={compact ? '' : 'card p-4'}>
      {!compact && <div className="eyebrow mb-2 flex items-center gap-2"><Database size={12} />Ingest retrospective dataset</div>}
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn btn-primary cursor-pointer"><Upload size={14} />{busy ? 'Uploading…' : 'Upload CSV / Parquet'}<input type="file" accept=".csv,.parquet" className="hidden" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={retrain} onChange={(e) => setRetrain(e.target.checked)} />Retrain automatically</label>
      </div>
      <p className="muted text-xs mt-2">De-identified rows with the 31 core feature columns + <span className="mono">deteriorated_24h</span>. Files with name/ИИН/phone columns are rejected. Use the schema mapper to rename Damumed columns first.</p>
      {msg && <div className={`text-sm mt-2 flex items-start gap-2 ${msg.ok ? 'text-ok' : 'text-coral'}`}>{msg.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}<span>{msg.text}</span></div>}
    </div>
  );
}

export default function ModelOpsDashboard() {
  const [status, setStatus] = useState(null); const [versions, setVersions] = useState([]); const [datasets, setDatasets] = useState([]); const [notes, setNotes] = useState(''); const [err, setErr] = useState('');
  const timer = useRef(null);
  const load = async () => { const [s, v, d] = await Promise.all([api.mlStatus(), api.mlVersions(), api.mlDatasets()]); setStatus(s); setVersions(v); setDatasets(d); return s; };
  useEffect(() => { load(); return () => clearInterval(timer.current); }, []);
  useEffect(() => { clearInterval(timer.current); if (status?.status === 'running') timer.current = setInterval(load, 1500); return () => clearInterval(timer.current); }, [status?.status]); // eslint-disable-line
  const retrain = async () => { setErr(''); try { await api.retrain({ notes, auto_activate: true }); await load(); } catch (e) { setErr(e.message); } };
  const activate = async (v) => { setErr(''); try { await api.rollback(v.version, v.active ? '' : `activated from Model Ops (was ${v.status})`); await load(); } catch (e) { setErr(e.message); } };
  if (!status) return <div className="muted text-sm">Loading…</div>;
  const running = status.status === 'running'; const act = status.active || {}; const m = act.metrics || {};
  const chart = versions.filter((v) => v.metrics?.auroc).map((v) => ({ v: v.version.replace('-kz-local', ''), auroc: v.metrics.auroc, status: v.status })).reverse();
  return (
    <div className="grid gap-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Active model" value={act.version?.replace('xgb-24h-', '') || '—'} unit={act.calibrated ? 'calibrated' : 'uncalibrated'} tone="#0E9F9B" />
        <Stat label="AUROC (CV)" value={m.auroc?.toFixed(3) ?? '—'} unit={m.sensitivity != null ? `sens ${Math.round(m.sensitivity * 100)}% · spec ${Math.round(m.specificity * 100)}%` : ''} />
        <Stat label="Versions" value={versions.length} unit={`${versions.filter((v) => v.status === 'candidate').length} candidates`} />
        <Stat label="Feedback trigger" value={`${status.feedback?.threshold ?? 25}`} unit="sign-offs → auto retrain" />
      </div>

      <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
        <Card title={<span className="flex items-center gap-2"><Cpu size={16} />Retraining engine</span>} sub="5-fold CV → final fit → calibration → evaluate vs active → register → hot-swap (no restart)">
          <div className="flex flex-wrap gap-2 items-center">
            <input className="input flex-1 min-w-[180px]" placeholder="Run notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={running} />
            <button type="button" className="btn btn-primary" disabled={running} onClick={retrain}>{running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}{running ? 'Training…' : 'Retrain now'}</button>
          </div>
          {err && <div className="text-coral text-sm mt-2">{err}</div>}
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1"><span className="muted">{status.stage || 'idle'}{status.version && ` · ${status.version}`}</span><span className="mono">{status.progress}%</span></div>
            <div className="meter"><span style={{ width: `${status.progress}%`, background: status.status === 'failed' ? '#E5484D' : status.status === 'done' ? '#16A34A' : '#0E9F9B' }} /></div>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              <Badge tone={{ idle: 'muted', running: 'primary', done: 'low', failed: 'critical' }[status.status]}>{status.status}</Badge>
              {status.trigger && <Badge>{TRIGGER_LABEL[status.trigger] || status.trigger}</Badge>}
              {status.rows > 0 && <span className="muted">{status.rows.toLocaleString('ru-RU')} rows · {status.sources?.length} sources</span>}
              {status.activated === true && <span className="text-ok font-semibold">activated</span>}{status.activated === false && status.status === 'done' && <span className="text-amber font-semibold">kept as candidate (not better than active)</span>}
            </div>
            {status.error && <div className="text-coral text-xs mt-1">{status.error}</div>}
          </div>
          <div className="log p-3 mt-3 h-40 overflow-auto rounded-md" style={{ background: '#0B2239', color: '#D9E8EC' }}>{(status.log || []).length === 0 && <span style={{ color: '#8AA0B2' }}>No run yet.</span>}{(status.log || []).map((l, i) => <div key={i}>{l}</div>)}</div>
        </Card>
        <div className="grid gap-4">
          <DatasetUploader onDone={load} />
          <Card title="Ingested datasets" sub="backend/data/uploads · included in every retrain">{datasets.length === 0 ? <div className="muted text-sm">None yet — the baseline cohort and clinician feedback are used.</div> : <table className="table"><thead><tr><th>File</th><th>Size</th></tr></thead><tbody>{datasets.map((d) => <tr key={d.file}><td className="mono text-xs">{d.file}</td><td className="mono text-xs">{d.size_kb} KB</td></tr>)}</tbody></table>}</Card>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_2fr] gap-4">
        <Card title="AUROC by version" sub="Cross-validated"><div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ left: -14, right: 8, top: 8, bottom: 0 }}><CartesianGrid vertical={false} /><XAxis dataKey="v" tick={{ fontSize: 10 }} /><YAxis domain={[0.7, 1]} /><Tooltip /><ReferenceLine y={0.85} stroke="#F59E0B" strokeDasharray="4 4" /><Bar dataKey="auroc">{chart.map((c, i) => <Cell key={i} fill={c.status === 'active' ? '#0E9F9B' : c.status === 'candidate' ? '#16A34A' : '#B8D0D8'} />)}</Bar></BarChart></ResponsiveContainer></div></Card>
        <Card title="Model registry" sub="Semantic versions · minor bump on new data or feedback, patch on manual runs">
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>Version</th><th>Status</th><th>Trigger</th><th>Rows</th><th>AUROC</th><th>F1</th><th>ECE</th><th>Trained</th><th></th></tr></thead><tbody>
            {versions.map((v) => <tr key={v.id}><td className="mono text-xs font-semibold whitespace-nowrap">{v.version}</td><td><Badge tone={STATUS_TONE[v.status] || 'muted'}>{v.status}</Badge></td><td className="text-xs">{TRIGGER_LABEL[v.trigger] || v.trigger}</td><td className="mono text-xs">{v.n_rows?.toLocaleString('ru-RU')}</td><td className="mono text-xs">{v.metrics?.auroc?.toFixed(3) ?? '—'}</td><td className="mono text-xs">{v.metrics?.f1?.toFixed(3) ?? '—'}</td><td className="mono text-xs">{(v.metrics?.ece_calibrated ?? v.metrics?.ece_raw)?.toFixed(3) ?? '—'}</td><td className="mono text-xs whitespace-nowrap">{new Date(v.trained_at).toLocaleString('ru-RU')}</td>
              <td>{!v.active && v.status !== 'failed' && <button type="button" className="btn py-1.5 px-2.5 text-xs whitespace-nowrap" onClick={() => activate(v)}><RotateCcw size={12} />{v.status === 'candidate' ? 'Activate' : 'Roll back'}</button>}</td></tr>)}
          </tbody></table></div>
        </Card>
      </div>
    </div>
  );
}
