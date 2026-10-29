import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, History, ClipboardCheck, ListChecks, ScanLine, Play, Pause, RefreshCw, Download, Check, X, Plus, Trash2, Bot, Baby, LayoutDashboard, ClipboardPlus, Radio, PauseCircle, FileText } from 'lucide-react';
import WelcomeDashboard from '../doctor/WelcomeDashboard.jsx';
import IntakePage, { AdmissionRiskCard } from '../doctor/IntakePage.jsx';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid, AreaChart, Area, ReferenceLine, ReferenceArea } from 'recharts';
import Shell from './Shell.jsx';
import { Card, Badge, Gauge } from '../../lib/ui.jsx';
import { useT } from '../../lib/i18n.jsx';
import { scoreRisk, TIER_COLOR } from '../../lib/risk.js';
import { featuresFor } from '../../lib/mock.js';
import { api } from '../../services/api.js';
import ComputerVisionTab from '../ComputerVisionTab.jsx';
import { ModelOriginPill, OriginPill, useProvenance } from '../DataOrigin.jsx';
import { ChevronDown } from 'lucide-react';

const TierBadge = ({ tier, pct }) => { const { t } = useT(); return <Badge tone={tier}>{t(`tier.${tier}`)}{pct != null && ` ${pct}%`}</Badge>; };

/* ---------- Intake form: 31 parameters grouped the way the ward sheet is laid out ---------- */
const GROUPS = [
  ['Demographics · Демография', [['gestational_age_wk', 'GA (wk)', 22, 44, 1], ['birth_weight_g', 'Weight (g)', 300, 6000, 10], ['apgar_1', 'APGAR 1', 0, 10, 1], ['apgar_5', 'APGAR 5', 0, 10, 1], ['age_hours', 'Age (h)', 0, 720, 1]]],
  ['Vitals · Витальные', [['heart_rate', 'HR', 60, 240, 1], ['resp_rate', 'RR', 15, 120, 1], ['spo2', 'SpO2 %', 50, 100, 1], ['fio2', 'FiO2 %', 21, 100, 1], ['map_mmhg', 'MAP', 15, 90, 1], ['temperature', 'T °C', 33, 41, 0.1]]],
  ['Blood gas · КЩС', [['ph', 'pH', 6.8, 7.7, 0.01], ['pco2', 'pCO2', 15, 120, 1], ['po2', 'pO2', 20, 200, 1], ['hco3', 'HCO3', 5, 40, 0.5], ['base_excess', 'BE', -30, 15, 0.5], ['lactate', 'Lactate', 0.2, 20, 0.1]]],
  ['Labs · Лаборатория', [['glucose', 'Glucose', 0.5, 25, 0.1], ['hemoglobin', 'Hb', 50, 250, 1], ['wbc', 'WBC', 0.5, 60, 0.1], ['platelets', 'Plt', 5, 700, 1], ['crp', 'CRP', 0, 300, 0.5], ['sodium', 'Na', 110, 170, 1], ['potassium', 'K', 2, 9, 0.1], ['creatinine', 'Creat', 10, 400, 1], ['bilirubin', 'Bili', 0, 500, 1], ['urine_output', 'UO ml/kg/h', 0, 10, 0.1]]],
];
const CATS = [['sex', 'Sex', ['F', 'M']], ['delivery_mode', 'Delivery', ['vaginal', 'cesarean']], ['vent_mode', 'Ventilation', ['room air', 'HFNC', 'nCPAP', 'SIMV', 'HFOV']]];

function fullFeatures(p) {
  const v = p.latest_vitals || {};
  return { gestational_age_wk: p.gestational_age_wk, birth_weight_g: p.birth_weight_g, sex: p.sex, apgar_1: p.apgar_1, apgar_5: p.apgar_5, delivery_mode: p.delivery_mode, age_hours: p.postnatal_age_h, vent_mode: p.ventilation_mode,
    heart_rate: v.heart_rate ?? 145, resp_rate: v.resp_rate ?? 50, spo2: v.spo2 ?? 95, fio2: v.fio2 ?? 21, map_mmhg: v.map_mmhg ?? 40, temperature: v.temperature ?? 36.8, ph: v.ph ?? 7.32, pco2: v.pco2 ?? 45, po2: v.po2 ?? 60, hco3: v.hco3 ?? 22,
    base_excess: v.base_excess ?? -2, lactate: v.lactate ?? 1.8, glucose: v.glucose ?? 4.5, hemoglobin: v.hemoglobin ?? 160, wbc: v.wbc ?? 12, platelets: v.platelets ?? 220, crp: v.crp ?? 3, sodium: v.sodium ?? 138, potassium: v.potassium ?? 4.5, creatinine: v.creatinine ?? 60, bilirubin: v.bilirubin ?? 80, urine_output: v.urine_output ?? 2.5 };
}

function PatientsView({ patients, selId, setSelId, onPrediction, user }) {
  const { t } = useT();
  const patient = patients.find((p) => p.id === selId) || patients[0];
  const [form, setForm] = useState(() => fullFeatures(patient));
  const [result, setResult] = useState(null); const [running, setRunning] = useState(false); const [pulled, setPulled] = useState(false);
  const [decision, setDecision] = useState(null); const [note, setNote] = useState(''); const [signed, setSigned] = useState(null);
  const [open, setOpen] = useState({ 0: true, 1: true, 2: false, 3: false }); const prov = useProvenance();
  useEffect(() => { setForm(fullFeatures(patient)); setResult(null); setDecision(null); setNote(''); setSigned(null); setPulled(false); }, [patient.id]);
  const live = useMemo(() => scoreRisk(featuresFor(patient, form)), [form, patient]);
  const shown = result || live;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const pull = () => { setPulled(true); setForm(fullFeatures(patient)); };
  const run = async () => { setRunning(true); try { const r = await api.predict(patient.id, form, true); setResult(r); onPrediction(r); } finally { setRunning(false); } };
  const sign = async () => {
    const body = { status: decision === 'agree' ? 'approved' : 'flagged', note, observed_outcome: '', confidence_flag: 0 };
    if (result?.prediction_id && api.online && !String(result.prediction_id).startsWith('local-')) await api.review(result.prediction_id, body);
    setSigned({ ...body, by: user.full_name, at: new Date().toLocaleString() });
  };
  const waterfall = useMemo(() => { if (!result) return []; let cum = result.base_rate_percent; const rows = [{ name: 'Base', inv: 0, val: result.base_rate_percent, kind: 'base', pp: result.base_rate_percent }]; result.shap.forEach((it) => { const next = cum + it.pp; rows.push({ name: it.feature.replace(/_/g, ' ').slice(0, 12), inv: Math.min(cum, next), val: Math.abs(it.pp), kind: it.pp >= 0 ? 'up' : 'down', pp: it.pp, detail: `${it.label}: ${it.value ?? '—'}` }); cum = next; }); rows.push({ name: 'Risk', inv: 0, val: result.risk_percent, kind: 'final', pp: result.risk_percent }); return rows; }, [result]);

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
      <Card title={t('doc.patients')} className="xl:sticky xl:top-20 self-start">
        <div className="grid gap-2">{patients.map((c) => <button key={c.id} type="button" onClick={() => setSelId(c.id)} className={`tile py-2.5 ${c.id === selId ? 'selected' : ''}`}><div className="flex items-center justify-between gap-2"><span className="mono text-xs text-primary">{c.id}</span><span className="muted text-xs">bed {c.bed}</span></div><div className="font-semibold text-sm mt-0.5">{c.diagnosis}</div><div className="muted text-xs">{c.gestational_age_wk}w · {c.birth_weight_g} g · {c.postnatal_age_h} h · {c.ventilation_mode}</div></button>)}</div>
      </Card>
      <div className="grid gap-4 min-w-0">
        <Card title={<span className="flex items-center gap-2"><Baby size={16} />{t('doc.intake')} · {patient.id}</span>} sub={t('doc.intake.sub')} right={<div className="flex gap-2"><button type="button" className="btn" title={t('intake.card')} onClick={async () => { const u = await api.patientCardUrl(patient.id).catch(() => null); if (u) window.open(u, '_blank'); }} disabled={!api.online}><FileText size={14} />PDF</button><button type="button" className={`btn ${pulled ? 'btn-teal' : ''}`} onClick={pull}><Download size={14} />{t('doc.pull')}{pulled && <Check size={14} />}</button><button type="button" className="btn btn-primary" onClick={run} disabled={running}>{running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}{t('doc.run')}</button></div>}>
          <div className="grid lg:grid-cols-2 gap-x-6 gap-y-3">
            {GROUPS.map(([g, fields], gi) => <div key={g} className="min-w-0"><button type="button" className="w-full flex items-center justify-between eyebrow mb-1.5 py-1 border-b border-line" onClick={() => setOpen((o) => ({ ...o, [gi]: !o[gi] }))} aria-expanded={!!open[gi]}><span>{g}</span><span className="flex items-center gap-2 normal-case tracking-normal"><span className="mono">{fields.filter(([k]) => form[k] != null && !Number.isNaN(form[k])).length}/{fields.length}</span><ChevronDown size={14} style={{ transform: open[gi] ? 'rotate(180deg)' : 'none', transition: 'transform .4s cubic-bezier(.22,1,.36,1)' }} /></span></button><div className="accordion-body" style={{ maxHeight: open[gi] ? 400 : 0, opacity: open[gi] ? 1 : 0 }}><div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pb-2">{fields.map(([k, l, min, max, step]) => <label key={k} className="text-xs"><span className="muted block truncate">{l}</span><input type="number" className="input px-2 py-1.5 mono" min={min} max={max} step={step} value={form[k] ?? ''} onChange={(e) => set(k, parseFloat(e.target.value))} /></label>)}</div></div></div>)}
            <div><div className="eyebrow mb-1.5">Categorical · Категории</div><div className="grid grid-cols-3 gap-2">{CATS.map(([k, l, opts]) => <label key={k} className="text-xs"><span className="muted block">{l}</span><select className="px-2 py-1.5" value={form[k]} onChange={(e) => set(k, e.target.value)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></label>)}</div></div>
          </div>
          <div className="muted text-xs mt-3">SpO2/FiO2 <span className="mono font-semibold text-fg">{Math.round(form.spo2 / (form.fio2 / 100))}</span> · live preview {live.risk_percent}% ({t(`tier.${live.risk_tier}`)})</div>
        </Card>
        <div className="grid md:grid-cols-[250px_1fr] gap-4">
          <Card title={t('doc.risk')} sub={result ? `${result.model_version}` : 'preview'}>
            <div className={shown.risk_tier === 'critical' || shown.risk_tier === 'high' ? 'breathe-glow rounded-full' : ''} style={{ '--glow': `${TIER_COLOR[shown.risk_tier]}55` }}><Gauge pct={shown.risk_percent} color={TIER_COLOR[shown.risk_tier]} label={`${shown.risk_percent}%`} sub={`prior ${shown.base_rate_percent}%`} /></div>
            <div className="flex items-center justify-between mt-1"><TierBadge tier={shown.risk_tier} /><span className="eyebrow">{result ? 'committed' : 'preview'}</span></div>
            <div className="mt-3 text-xs grid gap-1.5 border-t border-line pt-3">{shown.recommendations.map((a) => <div key={a} className="flex gap-2"><span style={{ color: TIER_COLOR[shown.risk_tier] }}>■</span>{a}</div>)}</div>
            <div className="mt-3 pt-3 border-t border-line"><ModelOriginPill prov={prov} /></div>
          </Card>
          <Card title={t('doc.shap')} sub={result ? 'Percentage points from base rate to this patient' : 'Run the assessment to see contributions'}>
            {result ? <div className="h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={waterfall} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}><CartesianGrid horizontal={false} /><XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} /><YAxis type="category" dataKey="name" width={96} /><Tooltip cursor={{ fill: 'rgba(15,76,129,.06)' }} formatter={(v, n, { payload }) => [payload.kind === 'base' || payload.kind === 'final' ? `${payload.pp.toFixed(0)}%` : `${payload.pp > 0 ? '+' : ''}${payload.pp.toFixed(1)} pp`, payload.detail || payload.name]} /><Bar dataKey="inv" stackId="w" fill="transparent" isAnimationActive={false} /><Bar dataKey="val" stackId="w">{waterfall.map((r, i) => <Cell key={i} fill={r.kind === 'up' ? '#D9381E' : r.kind === 'down' ? '#00A896' : r.kind === 'final' ? TIER_COLOR[result.risk_tier] : '#94A3B8'} />)}</Bar></BarChart></ResponsiveContainer></div>
              : <div className="h-72 grid place-items-center muted text-sm border border-dashed border-line-strong rounded-md">SHAP · TreeExplainer</div>}
          </Card>
        </div>
        <Card title={<span className="flex items-center gap-2"><ClipboardCheck size={16} />{t('doc.signoff')}</span>} sub={t('doc.signoff.sub')} right={result ? <Badge tone="primary">prediction {String(result.prediction_id).slice(0, 8)}</Badge> : <Badge>run first</Badge>}>
          {signed ? <div className="p-3 rounded-md border" style={{ borderColor: signed.status === 'approved' ? '#9EDDD4' : '#F6B8A8', background: signed.status === 'approved' ? '#E6F7F4' : '#FDECEA' }}><div className="font-semibold text-sm">{signed.status === 'approved' ? t('doc.agree') : t('doc.disagree')} — {signed.by}, {signed.at}</div>{signed.note && <div className="text-sm mt-1">{signed.note}</div>}<div className="muted text-xs mt-1">Recorded in the audit log · human-in-the-loop</div></div> : (
            <div className="grid md:grid-cols-[auto_1fr_auto] gap-3 items-start">
              <div className="flex md:flex-col gap-2"><button type="button" className={`btn ${decision === 'agree' ? 'btn-teal' : ''}`} disabled={!result} onClick={() => setDecision('agree')}><Check size={14} />{t('doc.agree')}</button><button type="button" className={`btn ${decision === 'disagree' ? 'btn-dark' : ''}`} disabled={!result} onClick={() => setDecision('disagree')}><X size={14} />{t('doc.disagree')}</button></div>
              <textarea rows={3} placeholder={t('doc.note')} value={note} onChange={(e) => setNote(e.target.value)} disabled={!result} />
              <button type="button" className="btn btn-primary" disabled={!result || !decision || (decision === 'disagree' && note.trim().length < 5)} onClick={sign}><ClipboardCheck size={14} />{t('save')}</button>
            </div>)}
        </Card>
        <AdmissionRiskCard patientId={patient.id} />
      </div>
    </div>
  );
}

/* ---------- Time machine ---------- */
function TimeMachine({ patients, selId, setSelId }) {
  const { t } = useT();
  const [data, setData] = useState(null); const [i, setI] = useState(0); const [playing, setPlaying] = useState(false); const timer = useRef(null);
  useEffect(() => { setData(null); setI(0); setPlaying(false); api.timeline(selId).then((d) => { setData(d); setI(d.points.length - 1); }).catch(() => setData({ points: [] })); }, [selId]);
  useEffect(() => { if (!playing || !data) return; timer.current = setInterval(() => setI((x) => { if (x >= data.points.length - 1) { setPlaying(false); return x; } return x + 1; }), 450); return () => clearInterval(timer.current); }, [playing, data]);
  if (!data) return <div className="muted text-sm">{t('loading')}</div>;
  const pts = data.points.map((p, idx) => ({ ...p, idx, label: new Date(p.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }));
  const cur = pts[i]; const alertIdx = pts.findIndex((p) => p.time === data.alert_at); const eventIdx = data.event_at ? pts.findIndex((p) => new Date(p.time) >= new Date(data.event_at)) : -1;
  const fmt = (iso) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—');
  return (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
      <Card title={t('doc.patients')} className="xl:sticky xl:top-20 self-start"><div className="grid gap-2">{patients.map((c) => <button key={c.id} type="button" onClick={() => setSelId(c.id)} className={`tile py-2.5 ${c.id === selId ? 'selected' : ''}`}><span className="mono text-xs text-primary">{c.id}</span><div className="font-semibold text-sm">{c.diagnosis}</div>{c.event_label && <div className="text-xs text-coral mt-0.5">{c.event_label}</div>}</button>)}</div></Card>
      <div className="grid gap-4 min-w-0">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="card p-4"><div className="eyebrow">{t('doc.alert')} (≥ 50 %)</div><div className="big-num text-3xl mt-2" style={{ color: data.alert_at ? '#D97706' : '#00A896' }}>{fmt(data.alert_at)}</div></div>
          <div className="card p-4"><div className="eyebrow">{t('doc.event')}</div><div className="big-num text-3xl mt-2" style={{ color: data.event_at ? '#D9381E' : '#64748B' }}>{fmt(data.event_at)}</div><div className="muted text-xs mt-1">{data.event_label || '—'}</div></div>
          <div className="card p-4"><div className="eyebrow">{t('doc.lead')}</div><div className="big-num text-3xl mt-2 text-primary">{data.lead_time_hours != null ? `${data.lead_time_hours} h` : '—'}</div></div>
        </div>
        <Card title={<span className="flex items-center gap-2"><History size={16} />{t('doc.timemachine')} · {selId}</span>} sub={t('doc.timemachine.sub')} right={<div className="flex gap-2"><button type="button" className="btn" onClick={() => { setI(0); setPlaying(true); }}><Play size={14} />{t('doc.play')}</button><button type="button" className="btn" onClick={() => setPlaying(false)}><Pause size={14} />{t('doc.pause')}</button></div>}>
          <div className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={pts} margin={{ left: -10, right: 12, top: 8, bottom: 0 }}><defs><linearGradient id="tm" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0F4C81" stopOpacity={.35} /><stop offset="100%" stopColor="#0F4C81" stopOpacity={.02} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="label" interval={3} /><YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v, n) => [n === 'risk_percent' ? `${v}%` : v, n]} /><ReferenceArea y1={50} y2={100} fill="#D9381E" fillOpacity={0.05} /><ReferenceLine y={50} stroke="#D97706" strokeDasharray="4 4" /><ReferenceLine y={75} stroke="#D9381E" strokeDasharray="4 4" />
            {alertIdx >= 0 && <ReferenceLine x={pts[alertIdx].label} stroke="#D97706" label={{ value: t('doc.alert'), fill: '#B45309', fontSize: 10, position: 'top' }} />}
            {eventIdx >= 0 && <ReferenceLine x={pts[eventIdx].label} stroke="#D9381E" label={{ value: t('doc.event'), fill: '#B8321B', fontSize: 10, position: 'top' }} />}
            <ReferenceLine x={cur.label} stroke="#0F172A" strokeWidth={2} />
            <Area dataKey="risk_percent" stroke="#0F4C81" fill="url(#tm)" strokeWidth={2} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
          <input type="range" min={0} max={pts.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(parseInt(e.target.value, 10)); }} className="mt-2" aria-label="Replay position" />
          <div className="grid sm:grid-cols-[auto_1fr] gap-4 mt-3 items-center">
            <div className="text-center"><div className="eyebrow">{cur.label}</div><div className="big-num text-5xl mt-1" style={{ color: TIER_COLOR[cur.tier] }}>{cur.risk_percent}%</div><div className="mt-1"><TierBadge tier={cur.tier} /></div></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">{[['HR', cur.heart_rate, 'bpm'], ['SpO2', cur.spo2, '%'], ['FiO2', cur.fio2, '%'], ['Lactate', cur.lactate, 'mmol/L']].map(([l, v, u]) => <div key={l} className="card p-3"><div className="eyebrow">{l}</div><div className="mono text-xl font-semibold">{v ?? '—'}<span className="muted text-xs ml-1">{u}</span></div></div>)}<div className="col-span-2 sm:col-span-4 text-xs muted">Top drivers: <span className="mono text-fg">{cur.drivers.join(', ')}</span></div></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Sign-off queue ---------- */
function SignoffQueue({ user, predictions }) {
  const { t } = useT();
  const [items, setItems] = useState([]); const [draft, setDraft] = useState({});
  const load = async () => { const list = await api.predictions(); setItems(list.length ? list : predictions.map((p) => ({ id: p.prediction_id, patient_id: p.patient_id, risk_percent: p.risk_percent, risk_tier: p.risk_tier, created_at: new Date().toISOString(), review: null }))); };
  useEffect(() => { load(); }, [predictions.length]); // eslint-disable-line
  const sign = async (it, status) => { const body = { status, note: draft[it.id] || '', observed_outcome: '', confidence_flag: 0 }; if (api.online && !String(it.id).startsWith('local-')) { await api.review(it.id, body); await load(); } else setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, review: { ...body, reviewer_name: user.full_name } } : x))); };
  const pending = items.filter((x) => !x.review);
  return (
    <Card title={<span className="flex items-center gap-2"><ClipboardCheck size={16} />{t('doc.queue')}</span>} sub={`${pending.length} awaiting sign-off`}>
      {items.length === 0 && <div className="muted text-sm">No predictions yet. Run an assessment on the Patients tab.</div>}
      <div className="grid gap-2">{items.map((it) => <div key={it.id} className="card p-3 grid md:grid-cols-[150px_1fr_auto] gap-3 items-start"><div><div className="mono text-sm text-primary">{it.patient_id}</div><div className="mt-1"><TierBadge tier={it.risk_tier} pct={it.risk_percent} /></div><div className="muted text-xs mt-1">{new Date(it.created_at).toLocaleString('ru-RU')}</div></div>
        {it.review ? <div className="text-sm"><Badge tone={it.review.status === 'approved' ? 'low' : 'critical'}>{it.review.status}</Badge> <span className="muted text-xs">{it.review.reviewer_name}</span>{it.review.note && <div className="mt-1">{it.review.note}</div>}</div> : <textarea rows={2} placeholder={t('doc.note')} value={draft[it.id] || ''} onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value }))} />}
        {!it.review && <div className="flex md:flex-col gap-2"><button type="button" className="btn" style={{ color: '#047A6E' }} onClick={() => sign(it, 'approved')}><Check size={14} />{t('doc.agree')}</button><button type="button" className="btn" style={{ color: '#B8321B' }} onClick={() => sign(it, 'flagged')}><X size={14} />{t('doc.disagree')}</button></div>}</div>)}</div>
    </Card>
  );
}

/* ---------- Shift tasks ---------- */
const PRIO = { critical: 'critical', high: 'high', normal: 'primary', low: 'muted' };
function Tasks({ patients }) {
  const { t } = useT();
  const [tasks, setTasks] = useState([]); const [title, setTitle] = useState(''); const [pid, setPid] = useState(''); const [prio, setPrio] = useState('normal'); const [due, setDue] = useState(60);
  const load = () => api.tasks().then(setTasks);
  useEffect(() => { load(); }, []);
  const add = async (e) => { e.preventDefault(); if (title.trim().length < 2) return; await api.addTask({ title, patient_id: pid || null, priority: prio, due_in_minutes: due }); setTitle(''); load(); };
  const dueLabel = (iso) => { if (!iso) return ''; const m = Math.round((new Date(iso) - Date.now()) / 60000); return m < 0 ? `overdue ${-m} min` : m < 60 ? `in ${m} min` : `in ${(m / 60).toFixed(1)} h`; };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card title={<span className="flex items-center gap-2"><ListChecks size={16} />{t('doc.tasks')}</span>} sub={t('doc.tasks.sub')}>
        <div className="grid gap-2">{tasks.map((x) => { const overdue = x.due_at && new Date(x.due_at) < Date.now(); return <div key={x.id} className="card p-3 flex items-center gap-3" style={overdue ? { borderColor: '#F6B8A8' } : undefined}><input type="checkbox" checked={x.done} onChange={() => api.toggleTask(x.id, !x.done).then(load)} /><div className="min-w-0 flex-1"><div className="font-medium text-sm flex items-center gap-2">{x.source === 'ai' && <Bot size={14} className="text-primary" />}{x.title}</div><div className="muted text-xs">{x.patient_id || '—'} · <span style={overdue ? { color: '#B8321B', fontWeight: 600 } : undefined}>{dueLabel(x.due_at)}</span></div></div><Badge tone={PRIO[x.priority]}>{x.priority}</Badge><button type="button" className="btn btn-ghost px-2" aria-label="Delete" onClick={() => api.deleteTask(x.id).then(load)}><Trash2 size={14} /></button></div>; })}{tasks.length === 0 && <div className="muted text-sm">No open tasks.</div>}</div>
      </Card>
      <form className="card p-4 self-start grid gap-2" onSubmit={add}><div className="eyebrow">{t('doc.task.add')}</div><input className="input" placeholder="e.g. Repeat blood gas" value={title} onChange={(e) => setTitle(e.target.value)} /><select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">— patient —</option>{patients.map((p) => <option key={p.id} value={p.id}>{p.id} · bed {p.bed}</option>)}</select><div className="grid grid-cols-2 gap-2"><select value={prio} onChange={(e) => setPrio(e.target.value)}>{['low', 'normal', 'high', 'critical'].map((o) => <option key={o}>{o}</option>)}</select><select value={due} onChange={(e) => setDue(parseInt(e.target.value, 10))}>{[[15, '15 min'], [30, '30 min'], [60, '1 h'], [120, '2 h'], [240, '4 h'], [480, '8 h']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div><button type="submit" className="btn btn-primary justify-center"><Plus size={14} />{t('doc.task.add')}</button></form>
    </div>
  );
}

/* ---------- Live stream status (ported StreamStatus): toggles periodic refresh of ward vitals ---------- */
function StreamStatus({ streaming, onToggle }) {
  const { t } = useT();
  return <button type="button" onClick={onToggle} className="btn py-1.5 px-2.5 text-xs" style={streaming ? { color: '#047A6E', borderColor: '#9EDDD4', background: '#E6F7F4' } : undefined} title={streaming ? t('home.live') : t('home.paused')}>{streaming ? <Radio size={13} className="breathe-glow rounded-full" style={{ '--glow': '#00A89655' }} /> : <PauseCircle size={13} />}<span className="hidden md:inline">{streaming ? t('home.live') : t('home.paused')}</span></button>;
}

export default function DoctorPortal({ user, onLogout }) {
  const { t } = useT();
  const [view, setView] = useState('home'); const [patients, setPatients] = useState([]); const [selId, setSelId] = useState(null); const [predictions, setPredictions] = useState([]); const [streaming, setStreaming] = useState(true);
  useEffect(() => { api.patients().then((p) => { setPatients(p); setSelId((s) => s || p[0]?.id); }); }, []);
  useEffect(() => { if (!streaming) return; const id = setInterval(() => api.patients().then(setPatients).catch(() => {}), 8000); return () => clearInterval(id); }, [streaming]);
  const NAV = [['home', t('doc.home'), LayoutDashboard], ['patients', t('doc.patients'), Users], ['admission', t('doc.admission'), ClipboardPlus], ['timemachine', t('doc.timemachine'), History], ['queue', t('doc.queue'), ClipboardCheck], ['tasks', t('doc.tasks'), ListChecks], ['imaging', t('doc.imaging'), ScanLine]];
  const TITLES = { home: [t('doc.home'), t('doc.home.sub')], patients: [t('doc.intake'), t('doc.intake.sub')], admission: [t('doc.admission'), t('doc.admission.sub')], timemachine: [t('doc.timemachine'), t('doc.timemachine.sub')], queue: [t('doc.queue'), t('doc.signoff.sub')], tasks: [t('doc.tasks'), t('doc.tasks.sub')], imaging: [t('doc.imaging'), 'Chest X-ray · cranial ultrasound · bedside telemetry'] };
  const patient = patients.find((p) => p.id === selId) || patients[0];
  return (
    <Shell user={user} portalLabel={t('nav.doctor')} nav={NAV} view={view} setView={setView} title={TITLES[view][0]} sub={TITLES[view][1]} onLogout={onLogout} headerExtra={<StreamStatus streaming={streaming} onToggle={() => setStreaming((s) => !s)} />}>
      {!patient ? <div className="muted text-sm">{t('loading')}</div> : <>
        {view === 'home' && <WelcomeDashboard patients={patients} streaming={streaming} onOpenPatient={(id) => { setSelId(id); setView('patients'); }} onGoIntake={() => setView('admission')} />}
        {view === 'admission' && <IntakePage user={user} patients={patients} />}
        {view === 'patients' && <PatientsView patients={patients} selId={patient.id} setSelId={setSelId} user={user} onPrediction={(p) => setPredictions((x) => [...x, p])} />}
        {view === 'timemachine' && <TimeMachine patients={patients} selId={patient.id} setSelId={setSelId} />}
        {view === 'queue' && <SignoffQueue user={user} predictions={predictions} />}
        {view === 'tasks' && <Tasks patients={patients} />}
        {view === 'imaging' && <ComputerVisionTab patient={patient} />}
      </>}
    </Shell>
  );
}
