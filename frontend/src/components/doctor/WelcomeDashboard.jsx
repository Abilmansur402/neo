import { useEffect, useMemo, useState } from 'react';
import { Users, AlertTriangle, Activity, ClipboardList, CalendarClock, ArrowRight, ClipboardPlus } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from 'recharts';
import { Card, Badge, Stat } from '../../lib/ui.jsx';
import { useT } from '../../lib/i18n.jsx';
import { scoreRisk, TIER_COLOR } from '../../lib/risk.js';
import { featuresFor } from '../../lib/mock.js';
import { api } from '../../services/api.js';

/**
 * Ward home (ported from the initial repository's WelcomeDashboard): patients in the unit, critical count,
 * average 24 h risk, sign-off queue; patients sorted by risk; risk distribution chart; today's appointments.
 */
export default function WelcomeDashboard({ patients, onOpenPatient, onGoIntake, streaming }) {
  const { t, lang } = useT();
  const [queue, setQueue] = useState(null); const [appts, setAppts] = useState([]);
  useEffect(() => { api.predictions().then((xs) => setQueue(xs.filter((p) => !p.review).length)).catch(() => setQueue(0)); api.appointments().then(setAppts).catch(() => setAppts([])); }, [patients]);
  const [server, setServer] = useState({});
  useEffect(() => { if (!api.online) return; let on = true; Promise.all(patients.map((p) => api.predict(p.id, {}, false).then((r) => [p.id, r]).catch(() => null))).then((rs) => { if (on) setServer(Object.fromEntries(rs.filter(Boolean))); }); return () => { on = false; }; }, [patients]);
  const scored = useMemo(() => patients.map((p) => { const r = server[p.id]; const score = r ? { risk_percent: r.risk_percent, risk_tier: r.risk_tier } : scoreRisk(featuresFor(p)); return { ...p, score }; }).sort((a, b) => b.score.risk_percent - a.score.risk_percent), [patients, server]);
  const critical = scored.filter((p) => p.score.risk_tier === 'critical' || p.score.risk_tier === 'high').length;
  const avgRisk = scored.length ? Math.round(scored.reduce((s, p) => s + p.score.risk_percent, 0) / scored.length) : 0;
  const upcoming = appts.filter((a) => a.status === 'scheduled').slice(0, 4);
  const fmt = (iso) => new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="grid gap-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={<span className="inline-flex items-center gap-1.5"><Users size={13} />{t('home.patients')}</span>} value={String(patients.length)} unit={t('home.patientsHint')} />
        <Stat label={<span className="inline-flex items-center gap-1.5"><AlertTriangle size={13} />{t('home.critical')}</span>} value={String(critical)} unit={t('home.criticalHint')} tone="#B8321B" />
        <Stat label={<span className="inline-flex items-center gap-1.5"><Activity size={13} />{t('home.avgRisk')}</span>} value={`${avgRisk}%`} unit={streaming ? t('home.live') : t('home.paused')} tone="#B45309" />
        <Stat label={<span className="inline-flex items-center gap-1.5"><ClipboardList size={13} />{t('doc.queue')}</span>} value={queue == null ? '…' : String(queue)} unit={t('home.queueHint')} tone="#0F4C81" />
      </section>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title={t('home.byRisk')} sub={t('home.byRiskSub')} right={<button type="button" className="btn whitespace-nowrap" onClick={onGoIntake}><ClipboardPlus size={14} />{t('doc.admission')}</button>}>
          <div className="grid gap-2">
            {scored.map((p) => (
              <button key={p.id} type="button" className="tile py-3 flex items-center gap-3 text-left" onClick={() => onOpenPatient(p.id)}>
                <span className="w-12 h-12 rounded-md grid place-items-center big-num text-base text-white shrink-0" style={{ background: TIER_COLOR[p.score.risk_tier] }}>{p.score.risk_percent}%</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><span className="mono text-xs text-primary">{p.id}</span><Badge tone={p.score.risk_tier}>{t(`tier.${p.score.risk_tier}`)}</Badge><span className="muted text-xs ml-auto">{t('home.bed')} {p.bed}</span></span>
                  <span className="block font-semibold text-sm mt-0.5 truncate">{p.diagnosis}</span>
                  <span className="block muted text-xs">{p.gestational_age_wk} {t('home.wk')} · {p.birth_weight_g} g · {p.postnatal_age_h} h · {p.ventilation_mode}</span>
                </span>
                <ArrowRight size={16} className="muted shrink-0" />
              </button>
            ))}
          </div>
        </Card>
        <div className="grid gap-4 self-start">
          <Card title={t('home.distribution')} sub={t('home.distributionSub')}>
            <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={scored.map((p) => ({ name: p.id.replace('KZ-2026-', '#'), risk: p.score.risk_percent, tier: p.score.risk_tier }))} margin={{ left: -18, right: 8, top: 8, bottom: 0 }}><CartesianGrid vertical={false} /><XAxis dataKey="name" /><YAxis domain={[0, 100]} /><Tooltip cursor={{ fill: 'rgba(15,76,129,.06)' }} formatter={(v) => [`${v}%`, t('doc.risk')]} /><Bar dataKey="risk" radius={[6, 6, 0, 0]}>{scored.map((p) => <Cell key={p.id} fill={TIER_COLOR[p.score.risk_tier]} />)}</Bar></BarChart></ResponsiveContainer></div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><CalendarClock size={16} />{t('appt.title')}</span>} sub={t('home.apptSub')}>
            {upcoming.length === 0 ? <div className="muted text-sm">{t('appt.none')}</div> : <div className="grid gap-2">{upcoming.map((a) => <div key={a.id} className="flex items-start gap-3 text-sm"><span className="mono text-xs text-primary whitespace-nowrap pt-0.5">{fmt(a.scheduled_at)}</span><span className="min-w-0"><span className="font-medium">{a.patient_label}</span><span className="muted block text-xs truncate">{t(`appt.type.${a.appointment_type}`)} · {a.clinician_name}</span></span></div>)}</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}
