import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FlaskConical, FileText, Baby, AlertTriangle, RefreshCw, CalendarPlus, Check, X, Download, ShieldAlert } from 'lucide-react';
import { Card, Badge } from '../../lib/ui.jsx';
import { useT } from '../../lib/i18n.jsx';
import { api } from '../../services/api.js';
import { sfx } from '../../lib/fx.js';
import { OriginPill } from '../DataOrigin.jsx';
import { ADMISSION_FIELDS, ADMISSION_DEFAULTS, BUNDLE_FEATURES, BUNDLE_LABELS } from '../../lib/intakeMock.js';

const BAND_TONE = { low: 'low', moderate: 'moderate', elevated: 'high', high: 'critical' };
const BAND_COLOR = { low: '#16A34A', moderate: '#F59E0B', elevated: '#F97316', high: '#E5484D' };
const fmtVal = (v) => (v == null || v === '' ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(2)) : v);

/* ---------- Admission-time risk card (ported AdmissionRiskCard, 15 Asfendiyarov features) ---------- */
export function AdmissionRiskCard({ patientId }) {
  const { t, lang } = useT();
  const [form, setForm] = useState(ADMISSION_DEFAULTS); const [res, setRes] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [info, setInfo] = useState(null);
  useEffect(() => { api.admissionInfo().then(setInfo).catch(() => {}); }, []);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const run = async () => { setBusy(true); setErr(null); try { const r = await api.predictAdmission(form, patientId, !!patientId); setRes(r); (r.risk_band === 'high' ? sfx.alert : r.risk_band === 'elevated' ? sfx.warn : sfx.success)(); } catch (e) { setErr(e.message); sfx.error(); } finally { setBusy(false); } };
  const L = (f) => f.label[lang] || f.label.ru;
  const field = (f) => (
    <label key={f.key} className="text-xs min-w-0"><span className="muted block truncate">{L(f)}{f.unit ? ` · ${f.unit}` : ''}</span>
      {f.kind === 'number' ? <input type="number" className="input px-2 py-1.5 mono" min={f.min} max={f.max} step={f.step || 1} value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value === '' ? '' : parseFloat(e.target.value))} />
        : <select className="px-2 py-1.5" value={form[f.key]} onChange={(e) => set(f.key, e.target.value)}>{(f.kind === 'yesno' ? [{ value: '0', label: t('no') }, { value: '1', label: t('yes') }] : f.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}
    </label>
  );
  const v = res?.validation || info?.metrics;
  return (
    <Card title={<span className="flex items-center gap-2"><Baby size={16} />{t('adm.title')}</span>} sub={t('adm.sub')} right={<div className="flex items-center gap-2"><OriginPill kind="real">Асфендиярова · 1 105 · 2021–2025</OriginPill><button type="button" className="btn btn-primary" onClick={run} disabled={busy}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <FlaskConical size={14} />}{t('adm.run')}</button></div>}>
      <div className="grid lg:grid-cols-[1fr_300px] gap-5">
        <div className="grid gap-3">
          <div><div className="eyebrow mb-1.5 pb-1 border-b border-line">{t('adm.newborn')}</div><div className="grid grid-cols-3 sm:grid-cols-5 gap-2">{ADMISSION_FIELDS.filter((f) => f.group === 'newborn').map(field)}</div></div>
          <div><div className="eyebrow mb-1.5 pb-1 border-b border-line">{t('adm.maternal')}</div><div className="grid grid-cols-3 sm:grid-cols-6 gap-2">{ADMISSION_FIELDS.filter((f) => f.group === 'maternal').map(field)}</div></div>
          <p className="muted text-xs">{t('adm.codes')}</p>
        </div>
        <div className="grid gap-3 self-start">
          {err && <div className="text-xs p-2 rounded border" style={{ borderColor: '#FCA5A5', background: '#FEE2E2', color: '#C62828' }}>{err}</div>}
          {res ? (
            <>
              <div className="rounded-lg border p-4 text-center" style={{ borderColor: BAND_COLOR[res.risk_band] + '66', background: BAND_COLOR[res.risk_band] + '14' }}>
                <div className="eyebrow">{t('adm.risk')}</div>
                <div className="big-num text-5xl mt-1" style={{ color: BAND_COLOR[res.risk_band] }}>{res.risk_percent}%</div>
                <div className="mt-2 flex items-center justify-center gap-2"><Badge tone={BAND_TONE[res.risk_band]}>{t(`adm.band.${res.risk_band}`)}</Badge><span className="mono text-xs muted">{t('adm.threshold')} {(res.operating_threshold * 100).toFixed(1)}%</span></div>
                {res.threshold_crossed && <div className="mt-2 text-xs font-semibold flex items-center justify-center gap-1" style={{ color: '#C62828' }}><AlertTriangle size={13} />{t('adm.crossed')}</div>}
              </div>
              <div><div className="eyebrow mb-1">{t('adm.factors')}</div><div className="grid gap-1">{res.top_factors.map((f) => <div key={f.feature} className="flex items-center gap-2 text-xs"><span className="w-20 h-1.5 rounded-full bg-line overflow-hidden shrink-0"><span className="block h-full" style={{ width: `${Math.min(100, Math.abs(f.contribution) * 120)}%`, background: f.direction === 'raises' ? '#E5484D' : '#16A34A' }} /></span><span className="truncate flex-1">{lang === 'en' && f.label_en ? f.label_en : f.label}</span><span className="mono muted">{fmtVal(f.value)}{f.unit ? ` ${f.unit}` : ''}</span><span className="mono font-semibold" style={{ color: f.direction === 'raises' ? '#C62828' : '#15803D' }}>{f.contribution > 0 ? '+' : ''}{f.contribution.toFixed(2)}</span></div>)}</div></div>
              {res.input_warnings?.length > 0 && <details className="text-xs"><summary className="muted cursor-pointer">{res.input_warnings.length} {t('adm.warnings')}</summary><ul className="mt-1 grid gap-0.5 muted list-disc pl-4">{res.input_warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>}
            </>
          ) : <div className="h-40 grid place-items-center muted text-sm border border-dashed border-line-strong rounded-md text-center px-4">{t('adm.empty')}</div>}
          {v && <div className="text-xs grid grid-cols-2 gap-x-3 gap-y-1 pt-3 border-t border-line"><span className="muted">{t('adm.test')}</span><span className="mono">{res?.validation?.test_period || '2024–2025'}{v.n_test || v.n ? ` · n=${v.n_test || v.n}` : ''}</span><span className="muted">AUROC</span><span className="mono">{v.auroc?.toFixed(3)}{v.auroc_95ci ? ` (${v.auroc_95ci[0]}–${v.auroc_95ci[1]})` : ''}</span><span className="muted">{t('adm.sens')}</span><span className="mono">{v.sensitivity != null ? Math.round(v.sensitivity * 100) + '%' : '—'} / {v.specificity != null ? Math.round(v.specificity * 100) + '%' : '—'}</span></div>}
          <p className="muted text-[11px] leading-snug">{res?.disclaimer || info?.disclaimer || ''}</p>
        </div>
      </div>
    </Card>
  );
}

/* ---------- Appointments (ported from the Supabase appointments table) ---------- */
function Appointments({ patientRef, patientLabel, clinician }) {
  const { t, lang } = useT();
  const [items, setItems] = useState([]); const [form, setForm] = useState({ scheduled_at: '', appointment_type: 're-examination', reason: '' }); const [busy, setBusy] = useState(false);
  const load = () => api.appointments().then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);
  const add = async (e) => { e.preventDefault(); if (!form.scheduled_at || form.reason.trim().length < 2) return; setBusy(true); try { await api.addAppointment({ ...form, patient_ref: patientRef, patient_label: patientLabel, clinician_name: clinician, scheduled_at: new Date(form.scheduled_at).toISOString() }); setForm((f) => ({ ...f, reason: '' })); await load(); } finally { setBusy(false); } };
  const fmt = (iso) => new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const TYPES = ['re-examination', 'consultation', 'transfer', 'family', 'other'];
  return (
    <Card title={<span className="flex items-center gap-2"><CalendarPlus size={16} />{t('appt.title')}</span>} sub={t('appt.sub')}>
      <form className="grid sm:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-end" onSubmit={add}>
        <label className="text-xs"><span className="muted block">{t('appt.when')}</span><input type="datetime-local" className="input py-1.5" value={form.scheduled_at} onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))} required /></label>
        <label className="text-xs"><span className="muted block">{t('appt.type')}</span><select className="py-1.5" value={form.appointment_type} onChange={(e) => setForm((f) => ({ ...f, appointment_type: e.target.value }))}>{TYPES.map((x) => <option key={x} value={x}>{t(`appt.type.${x}`)}</option>)}</select></label>
        <label className="text-xs"><span className="muted block">{t('appt.reason')}</span><input className="input py-1.5" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t('appt.reasonPh')} /></label>
        <button type="submit" className="btn btn-primary" disabled={busy}><CalendarPlus size={14} />{t('appt.add')}</button>
      </form>
      <div className="muted text-xs mt-1">{t('appt.for')}: <span className="mono text-fg">{patientRef}</span> · {clinician}</div>
      <div className="grid gap-2 mt-3">
        {items.length === 0 && <div className="muted text-sm">{t('appt.none')}</div>}
        {items.map((a) => <div key={a.id} className="card p-3 flex items-center gap-3 text-sm" style={a.status !== 'scheduled' ? { opacity: .6 } : undefined}><span className="mono text-xs text-primary whitespace-nowrap">{fmt(a.scheduled_at)}</span><span className="min-w-0 flex-1"><span className="font-medium">{a.patient_label}</span> <Badge tone={a.status === 'scheduled' ? 'primary' : a.status === 'completed' ? 'low' : 'muted'}>{t(`appt.status.${a.status}`)}</Badge><span className="muted block text-xs truncate">{t(`appt.type.${a.appointment_type}`)} · {a.reason} · {a.clinician_name}</span></span>{a.status === 'scheduled' && <span className="flex gap-1"><button type="button" className="btn px-2 py-1" title={t('appt.status.completed')} onClick={() => api.patchAppointment(a.id, 'completed').then(load)}><Check size={13} /></button><button type="button" className="btn px-2 py-1" title={t('appt.status.cancelled')} onClick={() => api.patchAppointment(a.id, 'cancelled').then(load)}><X size={13} /></button></span>}</div>)}
      </div>
    </Card>
  );
}

/* ---------- Page: bundle import + 12-h aggregate scoring + PDF card ---------- */
export default function IntakePage({ user, patients }) {
  const { t, lang } = useT();
  const [source, setSource] = useState('demo'); const [bundle, setBundle] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [pdf, setPdf] = useState(null); const fileRef = useRef(null);
  const loadDemo = async () => { setBusy(true); setErr(null); try { setBundle(await api.intakeDemo()); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  useEffect(() => { loadDemo(); }, []); // eslint-disable-line
  useEffect(() => { let url; if (!bundle) { setPdf(null); return; } api.cardPdfUrl(bundle).then((u) => { url = u; setPdf(u); }).catch(() => setPdf(null)); return () => { if (url) URL.revokeObjectURL(url); }; }, [bundle]);
  const onFile = async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); setErr(null); try { setBundle(await api.intakeImport(f)); setSource('upload'); } catch (x) { setErr(x.message); } finally { setBusy(false); e.target.value = ''; } };
  const p = bundle?.prediction; const pat = bundle?.patient; const enc = bundle?.encounter;
  const vitals = BUNDLE_FEATURES.slice(2, 12), labs = BUNDLE_FEATURES.slice(12);
  const flag = (k, v) => v == null ? null : ((k === 'ph_min' && v < 7.25) || (k === 'lactate_max' && v > 4) || (k === 'base_excess_min' && v < -8) || (k === 'glucose_min' && v < 3) || (k === 'hr_max' && v > 200));
  const missing = useMemo(() => new Set(p?.missing_features || []), [p]);
  return (
    <div className="grid gap-4">
      <Card title={t('intake.source')} sub={t('intake.sourceSub')} right={<OriginPill kind={bundle?.synthetic ? 'synthetic' : 'real'}>{bundle?.synthetic ? t('intake.synthetic') : t('intake.imported')}</OriginPill>}>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className={`btn ${source === 'demo' ? 'btn-primary' : ''}`} onClick={() => { setSource('demo'); loadDemo(); }} disabled={busy}><FlaskConical size={14} />{t('intake.demo')}</button>
          <button type="button" className={`btn ${source === 'upload' ? 'btn-primary' : ''}`} onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={14} />{t('intake.upload')}</button>
          <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={onFile} />
          {busy && <RefreshCw size={14} className="animate-spin muted" />}
          <span className="muted text-xs ml-auto flex items-center gap-1"><ShieldAlert size={12} />{t('intake.pii')}</span>
        </div>
        {err && <div className="mt-2 text-xs p-2 rounded border" style={{ borderColor: '#FCA5A5', background: '#FEE2E2', color: '#C62828' }}>{err}</div>}
        <p className="muted text-xs mt-2">{t('intake.formats')}</p>
      </Card>

      {bundle && p && (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-4 min-w-0">
            <Card title={<span className="flex items-center gap-2"><Baby size={16} />{pat.full_name}</span>} sub={`${pat.patient_id} · ${enc.encounter_id} · ${enc.institution}`} right={<Badge tone={BAND_TONE[p.risk_band]}>{t(`adm.band.${p.risk_band}`)} {p.risk_percent}%</Badge>}>
              <div className="grid sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                {[[t('intake.sexDob'), `${pat.sex} / ${pat.date_of_birth || '—'}`], [t('intake.ga'), pat.gestational_age || '—'], [t('intake.weight'), pat.birth_weight_g ? `${pat.current_weight_g ?? pat.birth_weight_g} g (${t('intake.atBirth')} ${pat.birth_weight_g} g)` : '—'], [t('intake.dept'), enc.department], [t('intake.admitted'), enc.admitted_at || '—'], [t('intake.window'), `12 h → ${enc.prediction_time || '—'}`], [t('intake.dx'), enc.admission_diagnosis], [t('intake.clinician'), enc.attending_clinician || user.full_name]].map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1 border-b border-line"><span className="muted">{k}</span><span className="text-right font-medium truncate">{v}</span></div>)}
              </div>
            </Card>
            <div className="grid md:grid-cols-2 gap-4">
              {[[t('intake.vitals'), vitals], [t('intake.labs'), labs]].map(([title, keys]) => <Card key={title} title={title} sub={`${keys.filter((k) => !missing.has(k)).length}/${keys.length} ${t('intake.present')}`}>
                <table className="table"><tbody>{keys.map((k) => { const v = bundle.features[k]; const f = flag(k, v); return <tr key={k}><td className="text-xs py-1.5">{BUNDLE_LABELS[k]}</td><td className="mono text-xs text-right py-1.5">{fmtVal(v)}</td><td className="py-1.5 text-right">{missing.has(k) ? <span className="origin origin-estimate" style={{ padding: '0 6px' }}>{t('intake.imputed')}</span> : f ? <span className="origin origin-synthetic" style={{ padding: '0 6px' }}>{t('intake.check')}</span> : null}</td></tr>; })}</tbody></table>
              </Card>)}
            </div>
            {pdf ? <Card title={<span className="flex items-center gap-2"><FileText size={16} />{t('intake.card')}</span>} sub={t('intake.cardSub')} right={<a className="btn" href={pdf} download={`${pat.patient_id}_patient_card.pdf`}><Download size={14} />PDF</a>}><iframe title={t('intake.card')} src={pdf} className="w-full h-[620px] rounded-md border border-line" /></Card>
              : <div className="card p-4 muted text-sm flex items-center gap-2"><FileText size={16} />{t('intake.pdfOffline')}</div>}
          </div>
          <div className="grid gap-4 self-start">
            <Card title={t('intake.assessment')} sub={`${p.model_name} · ${p.model_version}`} right={<OriginPill kind="model">24 h</OriginPill>}>
              <div className="text-center rounded-lg border p-4" style={{ borderColor: BAND_COLOR[p.risk_band] + '66', background: BAND_COLOR[p.risk_band] + '14' }}><div className="big-num text-5xl" style={{ color: BAND_COLOR[p.risk_band] }}>{p.risk_percent}%</div><div className="mono text-xs muted mt-2">{t('adm.threshold')} {(p.operating_threshold * 100).toFixed(1)}% · {t('intake.base')} {Math.round((p.shap_base_probability || 0) * 100)}%</div></div>
              <div className="mt-3"><div className="eyebrow mb-1">{t('adm.factors')}</div><div className="grid gap-1">{p.top_factors.map((f) => <div key={f.feature} className="flex items-center gap-2 text-xs"><span className="truncate flex-1">{f.label}</span><span className="mono muted">{fmtVal(f.value)}</span><span className="mono font-semibold" style={{ color: f.direction === 'raises' ? '#C62828' : '#15803D' }}>{f.contribution > 0 ? '+' : ''}{f.contribution.toFixed(2)}</span></div>)}</div></div>
              {missing.size > 0 && <p className="muted text-[11px] mt-3">{missing.size} {t('intake.missingNote')}</p>}
              {(p.caveats || []).map((c) => <p key={c} className="muted text-[11px] mt-2">{c}</p>)}
            </Card>
            <Card title={t('intake.actions')} sub={t('intake.actionsSub')}><ol className="grid gap-1.5 text-sm list-decimal pl-5">{p.review_actions.map((a) => <li key={a}>{a}</li>)}</ol><p className="muted text-[11px] mt-3">{p.disclaimer}</p></Card>
          </div>
        </div>
      )}

      <AdmissionRiskCard patientId={null} />
      {bundle && <Appointments patientRef={pat.patient_id} patientLabel={pat.full_name} clinician={user.full_name} />}
    </div>
  );
}
