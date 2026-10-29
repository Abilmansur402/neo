import { useEffect, useMemo, useState } from 'react';
import { Layers, Database, Plug, ClipboardCheck, BrainCircuit, Link2, X, Check, Flag } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LineChart, Line, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { Card, Badge, Stat, Tabs } from '../lib/ui.jsx';
import { tier, TIER_LABEL } from '../lib/risk.js';
import { api } from '../services/api.js';
import { subscribeHisLog } from '../services/websocket.js';
import { HIS_ENDPOINTS, REVIEW_SEED } from '../lib/mock.js';
import { DatasetUploader } from './ModelOpsDashboard.jsx';
import { OriginPill } from './DataOrigin.jsx';

/* ---------- Benchmarking ---------- */
function Benchmarking() {
  const [data, setData] = useState(null); const [origin, setOrigin] = useState('kz');
  useEffect(() => { api.benchmarks().then(setData); }, []);
  if (!data) return <div className="muted text-sm">Loading benchmarks…</div>;
  const b = data[origin];
  const calib = data.pic.calibration.map((row, i) => ({ bin: `${row.bin}%`, ideal: row.bin, pic: row.observed, kz: data.kz.calibration[i].observed }));
  const sites = [...data.pic.sites, ...data.kz.sites];
  return (
    <div className="grid gap-4 fade-in">
      <Card title="Data origin" sub="Reference benchmarks for the pilot protocol — these metrics are target figures from the published PIC-trained ensemble and the planned Kazakhstan validation, not live model output" right={<div className="flex border border-line-strong">{[['pic', 'PIC baseline'], ['kz', 'Kazakhstan NICU']].map(([k, l]) => <button key={k} type="button" className={`btn border-0 ${origin === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOrigin(k)}>{l}</button>)}</div>}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3"><Stat label="Cohort" value={b.n.toLocaleString()} unit="admissions" /><Stat label="AUROC" value={b.auroc.toFixed(3)} tone={b.auroc >= 0.9 ? '#16A34A' : '#B45309'} /><Stat label="AUPRC" value={b.auprc.toFixed(2)} /><Stat label="Brier" value={b.brier.toFixed(3)} /><Stat label="ECE" value={b.ece.toFixed(3)} tone={b.ece > 0.04 ? '#B45309' : '#16A34A'} /></div>
        <div className="mt-3 flex flex-wrap gap-1.5"><OriginPill kind="estimate">protocol benchmark · not live</OriginPill><OriginPill kind="model">live metrics → Model Ops</OriginPill></div>
        <p className="muted text-xs mt-3">{b.name} · {b.period} · prevalence {b.prevalence}%. {origin === 'kz' ? 'Local cohort over-estimates in mid-range bins; isotonic recalibration is queued before go-live.' : 'Baseline metrics from the original PIC-trained ensemble.'}</p>
        <div className="mt-4 pt-4 border-t border-line"><div className="eyebrow mb-2">Add a local retrospective dataset → automatic retraining</div><DatasetUploader compact /></div>
      </Card>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Discrimination by site" sub="AUROC, held-out folds"><div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={sites} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><CartesianGrid vertical={false} /><XAxis dataKey="site" /><YAxis domain={[0.7, 1]} /><Tooltip /><ReferenceLine y={0.85} stroke="#F59E0B" strokeDasharray="4 4" /><Bar dataKey="auroc" name="AUROC">{sites.map((s, i) => <Cell key={s.site} fill={i === 0 ? '#8AA0B2' : '#0E9F9B'} />)}</Bar></BarChart></ResponsiveContainer></div></Card>
        <Card title="Calibration" sub="Observed vs predicted, 10 bins"><div className="h-60"><ResponsiveContainer width="100%" height="100%"><LineChart data={calib} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}><CartesianGrid /><XAxis dataKey="bin" /><YAxis domain={[0, 100]} /><Tooltip /><Legend /><Line dataKey="ideal" name="Ideal" stroke="#8AA0B2" strokeDasharray="5 5" dot={false} isAnimationActive={false} /><Line dataKey="pic" name="PIC" stroke="#0E9F9B" strokeWidth={2} dot={false} isAnimationActive={false} /><Line dataKey="kz" name="Kazakhstan" stroke="#E5484D" strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></Card>
      </div>
    </div>
  );
}

/* ---------- Schema mapper ---------- */
function SchemaMapper() {
  const [schema, setSchema] = useState(null); const [mapping, setMapping] = useState({}); const [drag, setDrag] = useState(null); const [validation, setValidation] = useState(null);
  useEffect(() => { api.schema().then((s) => { setSchema(s); setMapping(Object.fromEntries(s.core_features.slice(0, 11).map((f) => [f.key, s.suggested_mapping[f.key]]))); }); }, []);
  const used = useMemo(() => new Set(Object.values(mapping)), [mapping]);
  if (!schema) return <div className="muted text-sm">Loading schema…</div>;
  const mapped = Object.values(mapping).filter(Boolean).length; const total = schema.core_features.length;
  const validate = async () => setValidation(await api.validateMapping(mapping));
  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-4 fade-in">
      <Card title="Damumed export columns" sub="Drag onto a feature, or use the dropdown" className="lg:sticky lg:top-20 self-start">
        <div className="flex flex-wrap gap-1.5">{schema.export_columns.map((c) => <span key={c} draggable onDragStart={() => setDrag(c)} onDragEnd={() => setDrag(null)} className={`mono text-xs px-2 py-1 border bg-surface cursor-grab ${used.has(c) ? 'opacity-40' : ''}`} style={{ borderColor: drag === c ? '#0E9F9B' : '#B8D0D8' }}>{c}</span>)}</div>
      </Card>
      <Card title={`Schema mapper · ${total} core features`} right={<div className="flex gap-2"><button type="button" className="btn" onClick={() => setMapping({ ...schema.suggested_mapping })}><BrainCircuit size={16} />Auto-map</button><button type="button" className="btn btn-ghost" onClick={() => { setMapping({}); setValidation(null); }}>Clear</button><button type="button" className="btn btn-dark" onClick={validate}>Validate</button></div>}>
        <div className="flex items-center gap-3 mb-3"><div className="meter flex-1"><span style={{ width: `${(mapped / total) * 100}%` }} /></div><span className="mono text-sm font-semibold">{mapped}/{total}</span><Badge tone={mapped === total ? 'low' : mapped >= 25 ? 'moderate' : 'high'}>{mapped === total ? 'complete' : `${total - mapped} unmapped`}</Badge></div>
        {validation && <div className={`text-xs mb-3 p-2 border ${validation.valid ? 'border-teal' : 'border-coral'}`}>Coverage {Math.round(validation.coverage * 100)}% · {validation.valid ? 'mapping valid' : `issues: ${[...validation.duplicate_columns.map((d) => `duplicate ${d}`), ...validation.unknown_columns.map((u) => `unknown ${u}`)].join(', ')}`}{validation.missing.length > 0 && ` · missing: ${validation.missing.slice(0, 6).join(', ')}${validation.missing.length > 6 ? '…' : ''}`}</div>}
        <div className="overflow-x-auto"><table className="table"><thead><tr><th>Feature</th><th>Қазақша / Русский</th><th>LOINC</th><th>Local column</th><th>Status</th></tr></thead><tbody>{schema.core_features.map((f) => { const v = mapping[f.key] || ''; return (
          <tr key={f.key} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag) setMapping((m) => ({ ...m, [f.key]: drag })); }} style={drag ? { background: 'rgba(15,76,129,.06)' } : undefined}><td><div className="font-medium">{f.en}</div><div className="mono muted text-xs">{f.key}</div></td><td className="muted text-xs">{f.kz} · {f.ru}</td><td className="mono muted text-xs">{f.loinc || '—'}</td><td><select aria-label={`Map ${f.en}`} value={v} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}><option value="">— not mapped —</option>{schema.export_columns.map((c) => <option key={c} value={c}>{c}</option>)}</select></td><td>{v ? <Badge tone={v === schema.suggested_mapping[f.key] ? 'low' : 'moderate'}>{v === schema.suggested_mapping[f.key] ? 'matched' : 'manual'}</Badge> : <Badge tone="high">missing</Badge>}</td></tr>); })}</tbody></table></div>
      </Card>
    </div>
  );
}

/* ---------- HIS simulator ---------- */
function HisSimulator({ user }) {
  const [connected, setConnected] = useState(false); const [logs, setLogs] = useState([]); const [endpoints, setEndpoints] = useState(HIS_ENDPOINTS.map((e) => ({ ...e, status: 'offline' }))); const [token, setToken] = useState(null);
  useEffect(() => { api.hisStatus().then((s) => { if (s) { setConnected(s.connected); setLogs(s.log_tail || []); setEndpoints(s.endpoints); setToken(s.token_preview); } }).catch(() => {}); }, []);
  useEffect(() => {
    if (!connected) return;
    const stop = subscribeHisLog((msg) => { if (msg.type === 'log') { setLogs((l) => [...l.slice(-200), msg.entry]); setEndpoints(msg.endpoints); } });
    return stop;
  }, [connected]);
  const toggle = async () => {
    if (api.online) { const s = connected ? await api.hisDisconnect() : await api.hisConnect(); setConnected(s.connected); setLogs(s.log_tail || []); setEndpoints(s.endpoints); setToken(s.token_preview); }
    else { setConnected((c) => !c); setLogs([]); setToken(connected ? null : 'mock_7Hq…'); if (connected) setEndpoints(HIS_ENDPOINTS.map((e) => ({ ...e, status: 'offline' }))); }
  };
  const colors = { ok: '#16A34A', warn: '#F59E0B', err: '#E5484D', info: '#60A5FA' };
  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4 fade-in">
      <Card title="Integration status" sub={user.hospital.name}>
        <button type="button" className={`btn w-full justify-center ${connected ? '' : 'btn-primary'}`} onClick={toggle}>{connected ? <X size={16} /> : <Link2 size={16} />}{connected ? 'Disconnect' : 'Connect to HIS'}</button>
        <div className="grid gap-2 mt-4">{endpoints.map((e) => <div key={e.id} className="card p-3 flex items-center gap-3"><span className={`dot ${e.status === 'live' ? 'dot-live' : ''}`} /><div className="min-w-0 flex-1"><div className="text-sm font-medium">{e.name}</div><div className="muted text-xs">{e.detail}</div></div><Badge tone={e.status === 'live' ? 'low' : 'muted'}>{e.status === 'connecting' ? '…' : e.status}</Badge></div>)}</div>
        <div className="kv mt-4"><span className="muted">Auth</span><span>OAuth2 client-credentials · SMART backend</span><span className="muted">Token</span><span className="mono">{token || '—'}</span><span className="muted">Residency</span><span>On-premise, no egress</span><span className="muted">Audit</span><span>Every read logged to hospital SIEM</span></div>
      </Card>
      <Card title="Live API connection log" sub={api.online ? 'WebSocket /api/integration/ws/his' : 'Local simulator'} right={connected && <span className="flex items-center gap-2 text-xs"><span className="dot dot-live" />streaming</span>}>
        <div className="log p-3 h-96 overflow-auto" style={{ background: '#0B2239', color: '#D9E8EC', borderRadius: 4 }}>{logs.length === 0 && <div style={{ color: '#8AA0B2' }}>No session. Press Connect to open the gateway channel.</div>}{logs.map((l, i) => <div key={i}><span style={{ color: '#8AA0B2' }}>{new Date((l.t || 0) * 1000).toLocaleTimeString('en-GB')}</span> <span style={{ color: colors[l.level] }}>[{(l.level || 'info').toUpperCase()}]</span> {l.msg}</div>)}</div>
      </Card>
    </div>
  );
}

/* ---------- Expert review loop ---------- */
function ExpertReview({ user, predictions }) {
  const [items, setItems] = useState([]); const [draft, setDraft] = useState({}); const [stats, setStats] = useState(null);
  const canReview = user.role === 'neonatologist';
  const load = async () => {
    const serverItems = await api.predictions();
    const base = serverItems.length ? serverItems.map((p) => ({ id: p.id, patient_id: p.patient_id, risk_percent: p.risk_percent, observed: p.review?.observed_outcome || 'Awaiting 24 h follow-up', review: p.review })) : REVIEW_SEED;
    const local = predictions.filter((p) => String(p.prediction_id).startsWith('local-')).map((p) => ({ id: p.prediction_id, patient_id: p.patient_id, risk_percent: p.risk_percent, observed: 'Awaiting 24 h follow-up', review: null }));
    setItems([...local.reverse(), ...base]); setStats(await api.reviewStats());
  };
  useEffect(() => { load(); }, [predictions.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const sign = async (item, status) => {
    const body = { status, note: draft[item.id] ?? item.review?.note ?? '', observed_outcome: item.observed, confidence_flag: 0 };
    if (api.online && !String(item.id).startsWith('local-') && !String(item.id).startsWith('r')) { await api.review(item.id, body); await load(); }
    else setItems((xs) => xs.map((x) => x.id === item.id ? { ...x, review: { ...body, reviewer_name: user.full_name } } : x));
  };
  const approved = stats?.approved ?? items.filter((i) => i.review?.status === 'approved').length, flagged = stats?.flagged ?? items.filter((i) => i.review?.status === 'flagged').length;
  return (
    <div className="grid gap-4 fade-in">
      <div className="grid grid-cols-3 gap-3"><Stat label="Approved" value={approved} tone="#16A34A" /><Stat label="Flagged" value={flagged} tone="#E5484D" /><Stat label="Pending" value={items.length - approved - flagged} tone="#B45309" /></div>
      <Card title="Neonatologist expert review loop" sub={canReview ? 'Validate each committed prediction against the observed 24 h outcome. Signed flags feed the retraining backlog.' : 'Read-only for your role: sign-off requires the Lead Neonatologist.'}>
        <div className="grid gap-3">{items.map((r) => { const t = tier(r.risk_percent); return (
          <div key={r.id} className="card p-3 grid md:grid-cols-[160px_1fr_auto] gap-3 items-start">
            <div><div className="mono text-sm text-primary">{r.patient_id}</div><div className="mt-1"><Badge tone={t}>{TIER_LABEL[t]} {r.risk_percent}%</Badge></div><div className="muted text-xs mt-2">Observed: {r.observed}</div>{r.review?.reviewer_name && <div className="muted text-xs mt-1">Signed: {r.review.reviewer_name}</div>}</div>
            <div className="min-w-0"><label className="eyebrow" htmlFor={`note-${r.id}`}>Clinical note</label><textarea id={`note-${r.id}`} rows={2} placeholder="Agree / disagree and why…" disabled={!canReview} value={draft[r.id] ?? r.review?.note ?? ''} onChange={(e) => setDraft((n) => ({ ...n, [r.id]: e.target.value }))} /></div>
            <div className="flex md:flex-col gap-2">{!r.review ? <><button type="button" className="btn text-ok" disabled={!canReview} onClick={() => sign(r, 'approved')}><Check size={16} />Approve</button><button type="button" className="btn text-coral" disabled={!canReview} onClick={() => sign(r, 'flagged')}><Flag size={16} />Flag</button></> : <Badge tone={r.review.status === 'approved' ? 'low' : 'critical'}>{r.review.status}</Badge>}</div>
          </div>); })}</div>
        <p className="muted text-xs mt-3">Reviewer: {user.full_name} · {user.role}</p>
      </Card>
    </div>
  );
}

export default function DatasetIntegrationTab({ user, predictions }) {
  const [tab, setTab] = useState('bench');
  return (
    <div className="grid gap-4">
      <Tabs tabs={[['bench', 'Benchmarking', Layers], ['schema', 'Schema mapper', Database], ['his', 'HIS / FHIR simulator', Plug], ['review', 'Expert review', ClipboardCheck]]} value={tab} onChange={setTab} />
      {tab === 'bench' && <Benchmarking />}
      {tab === 'schema' && <SchemaMapper />}
      {tab === 'his' && <HisSimulator user={user} />}
      {tab === 'review' && <ExpertReview user={user} predictions={predictions} />}
    </div>
  );
}
