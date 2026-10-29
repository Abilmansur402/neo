import { useEffect, useState } from 'react';
import { HeartPulse, Baby, Save, Wind, Utensils, Star } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import Shell from './Shell.jsx';
import { Card, Badge, Gauge } from '../../lib/ui.jsx';
import { useT } from '../../lib/i18n.jsx';
import { TIER_COLOR } from '../../lib/risk.js';
import { api } from '../../services/api.js';

const FIELDS = [
  ['maternal_age', { en: 'Your age', ru: 'Ваш возраст', kz: 'Жасыңыз' }, 'number', 1], ['gravidity', { en: 'Pregnancies (total)', ru: 'Беременностей всего', kz: 'Жүктілік саны' }, 'number', 1], ['parity', { en: 'Previous births', ru: 'Предыдущих родов', kz: 'Бұрынғы босанулар' }, 'number', 1],
  ['gestational_age_wk', { en: 'Gestational age (weeks)', ru: 'Срок (недели)', kz: 'Мерзім (апта)' }, 'number', 0.5], ['bmi', { en: 'BMI', ru: 'ИМТ', kz: 'ДМИ' }, 'number', 0.1], ['bp_systolic', { en: 'Blood pressure, upper', ru: 'Давление, верхнее', kz: 'Қысым, жоғарғы' }, 'number', 1], ['bp_diastolic', { en: 'Blood pressure, lower', ru: 'Давление, нижнее', kz: 'Қысым, төменгі' }, 'number', 1],
  ['hemoglobin', { en: 'Haemoglobin (g/L)', ru: 'Гемоглобин (г/л)', kz: 'Гемоглобин (г/л)' }, 'number', 1], ['prom_hours', { en: 'Hours since waters broke (0 if not)', ru: 'Часов после излития вод (0 если нет)', kz: 'Су кеткеннен кейінгі сағат (жоқ болса 0)' }, 'number', 1],
  ['pre_eclampsia', { en: 'Pre-eclampsia', ru: 'Преэклампсия', kz: 'Преэклампсия' }, 'bool'], ['gestational_diabetes', { en: 'Gestational diabetes', ru: 'Гестационный диабет', kz: 'Гестациялық диабет' }, 'bool'], ['chronic_hypertension', { en: 'Chronic hypertension', ru: 'Хроническая гипертензия', kz: 'Созылмалы гипертензия' }, 'bool'],
  ['antenatal_steroids', { en: 'Antenatal steroids given', ru: 'Получала антенатальные стероиды', kz: 'Антенаталды стероидтар алды' }, 'bool'], ['magnesium_sulfate', { en: 'Magnesium sulfate given', ru: 'Получала сульфат магния', kz: 'Магний сульфатын алды' }, 'bool'], ['chorioamnionitis', { en: 'Chorioamnionitis', ru: 'Хориоамнионит', kz: 'Хориоамнионит' }, 'bool'],
  ['multiple_gestation', { en: 'Twins or more', ru: 'Двойня и более', kz: 'Егіз және одан көп' }, 'bool'], ['smoking', { en: 'Smoking', ru: 'Курение', kz: 'Темекі шегу' }, 'bool'], ['planned_delivery_mode', { en: 'Planned delivery', ru: 'Планируемые роды', kz: 'Жоспарланған босану' }, 'select'],
];

function Pregnancy() {
  const { t, lang } = useT();
  const [rec, setRec] = useState(null); const [form, setForm] = useState(null); const [preview, setPreview] = useState(null); const [saved, setSaved] = useState(false);
  useEffect(() => { api.maternal().then((r) => { setRec(r); setForm(r ? Object.fromEntries(FIELDS.map(([k]) => [k, r[k]])) : Object.fromEntries(FIELDS.map(([k, , ty]) => [k, ty === 'bool' ? false : ty === 'select' ? 'vaginal' : 0]))); }); }, []);
  useEffect(() => { if (!form) return; const id = setTimeout(() => api.maternalScreen(form).then(setPreview), 300); return () => clearTimeout(id); }, [form]);
  if (!form) return <div className="muted text-sm">{t('loading')}</div>;
  const risk = preview || rec?.risk; const L = (o) => o?.[lang] || o?.en || '';
  const save = async () => { const r = await api.saveMaternal(form); setRec(r); setSaved(true); setTimeout(() => setSaved(false), 2500); };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card title={<span className="flex items-center gap-2"><HeartPulse size={16} />{t('mom.pregnancy')}</span>} sub={`18 ${lang === 'ru' ? 'полей' : lang === 'kz' ? 'өріс' : 'fields'} · ${rec ? new Date(rec.updated_at).toLocaleDateString('ru-RU') : ''}`} right={<button type="button" className="btn btn-primary" onClick={save}><Save size={14} />{saved ? '✓' : t('mom.update')}</button>}>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
          {FIELDS.map(([k, label, type, step]) => type === 'bool' ? <label key={k} className="flex items-center justify-between gap-3 text-sm py-1 border-b border-line"><span>{L(label)}</span><input type="checkbox" checked={!!form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.checked }))} /></label>
            : type === 'select' ? <label key={k} className="text-sm"><span className="muted text-xs block">{L(label)}</span><select value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}><option value="vaginal">{lang === 'ru' ? 'Естественные' : lang === 'kz' ? 'Табиғи' : 'Vaginal'}</option><option value="cesarean">{lang === 'ru' ? 'Кесарево' : lang === 'kz' ? 'Кесарь тілігі' : 'Caesarean'}</option></select></label>
            : <label key={k} className="text-sm"><span className="muted text-xs block">{L(label)}</span><input type="number" step={step} className="input mono py-1.5" value={form[k] ?? ''} onChange={(e) => setForm((f) => ({ ...f, [k]: parseFloat(e.target.value) || 0 }))} /></label>)}
        </div>
      </Card>
      {risk && <div className="grid gap-4 self-start">
        <Card title={t('mom.screen')} sub={t('mom.screen.sub')}>
          <Gauge pct={risk.percent} color={TIER_COLOR[risk.tier]} label={`${risk.percent}%`} sub={t(`tier.${risk.tier}`)} />
          <div className="eyebrow mt-2 mb-1">{t('mom.factors')}</div>
          <div className="grid gap-1.5">{risk.factors.map((f) => <div key={f.key} className="flex items-center gap-2 text-sm"><span className="dot" style={{ background: f.direction === 'risk' ? '#D9381E' : '#00A896' }} /><span className="flex-1">{L(f.label)}</span><span className="mono text-xs muted">{f.direction === 'risk' ? '+' : '−'}</span></div>)}</div>
          <div className="eyebrow mt-4 mb-1">{t('mom.advice')}</div>
          <p className="text-sm">{L(risk.advice)}</p>
        </Card>
      </div>}
    </div>
  );
}

function BabyView() {
  const { t, lang } = useT();
  const [log, setLog] = useState(null); const [sum, setSum] = useState(null);
  useEffect(() => { api.baby().then(setLog); api.babySummary().then(setSum); }, []);
  if (log === null) return <div className="muted text-sm">{t('loading')}</div>;
  if (!log.length || !sum) return <Card title={t('mom.baby')}><p className="muted">{t('mom.nobaby')}</p></Card>;
  const last = log[log.length - 1];
  const RESP = { 'room air': { en: 'Breathing on own', ru: 'Дышит сам', kz: 'Өзі тыныс алады' }, HFNC: { en: 'Warm air through the nose', ru: 'Тёплый воздух через нос', kz: 'Мұрын арқылы жылы ауа' }, nCPAP: { en: 'Gentle pressure support', ru: 'Мягкая поддержка давлением', kz: 'Жұмсақ қысыммен қолдау' }, SIMV: { en: 'Ventilator', ru: 'Аппарат ИВЛ', kz: 'ЖВЛ аппараты' }, HFOV: { en: 'Ventilator (high-frequency)', ru: 'Аппарат ИВЛ (высокочастотный)', kz: 'ЖВЛ аппараты (жоғары жиілікті)' } };
  const FEED = { parenteral: { en: 'Nutrition by drip', ru: 'Питание через капельницу', kz: 'Тамшылатқыш арқылы' }, tube: { en: 'Milk by tube', ru: 'Молоко через зонд', kz: 'Зонд арқылы сүт' }, breast: { en: 'Breastfeeding', ru: 'Грудное', kz: 'Емізу' }, bottle: { en: 'Bottle', ru: 'Бутылочка', kz: 'Бөтелке' } };
  const L = (o) => o?.[lang] || o?.en || '—';
  return (
    <div className="grid gap-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4"><div className="eyebrow">{t('mom.day')}</div><div className="big-num text-4xl mt-1 text-primary">{sum.day_of_life}</div><div className="muted text-xs">bed {sum.bed}</div></div>
        <div className="card p-4"><div className="eyebrow">{t('mom.growth')}</div><div className="big-num text-4xl mt-1">{last.weight_g}<span className="text-base muted"> g</span></div><div className="muted text-xs">{lang === 'ru' ? 'при рождении' : lang === 'kz' ? 'туғанда' : 'at birth'} {sum.birth_weight_g} g</div></div>
        <div className="card p-4"><div className="eyebrow flex items-center gap-1"><Wind size={12} />{t('mom.breathing')}</div><div className="font-semibold text-lg mt-1">{L(RESP[last.respiratory_support])}</div><div className="muted text-xs">{last.respiratory_support}</div></div>
        <div className="card p-4"><div className="eyebrow flex items-center gap-1"><Utensils size={12} />{t('mom.feeding')}</div><div className="font-semibold text-lg mt-1">{L(FEED[last.feeding])}</div></div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={t('mom.growth')} sub={`${sum.gestational_age_wk} ${lang === 'ru' ? 'нед.' : lang === 'kz' ? 'апта' : 'wk'} · ${sum.sex === 'F' ? '♀' : '♂'}`}><div className="h-52"><ResponsiveContainer width="100%" height="100%"><LineChart data={log} margin={{ left: -10, right: 12, top: 8, bottom: 0 }}><CartesianGrid vertical={false} /><XAxis dataKey="day" tickFormatter={(d) => `${t('mom.day')} ${d}`} /><YAxis domain={['dataMin - 60', 'dataMax + 60']} /><Tooltip formatter={(v) => [`${v} g`, t('mom.growth')]} labelFormatter={(d) => `${t('mom.day')} ${d}`} /><Line dataKey="weight_g" stroke="#0F4C81" strokeWidth={2.5} dot={{ r: 4, fill: '#0F4C81' }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div></Card>
        <Card title={<span className="flex items-center gap-2"><Star size={16} />{t('mom.milestones')}</span>}><div className="grid gap-2">{log.filter((e) => e.milestone).map((e) => <div key={e.id} className="flex gap-3 text-sm"><Badge tone="low">{t('mom.day')} {e.day}</Badge><span>{e.milestone}</span></div>)}</div></Card>
      </div>
      <Card title={<span className="flex items-center gap-2"><Baby size={16} />{t('mom.diary')}</span>}><div className="grid gap-3">{[...log].reverse().map((e) => <div key={e.id} className="card p-3"><div className="flex items-center gap-2 text-xs muted"><Badge tone="primary">{t('mom.day')} {e.day}</Badge>{e.weight_g && <span className="mono">{e.weight_g} g</span>}<span>{L(RESP[e.respiratory_support])}</span></div><p className="text-sm mt-2">{e.note_for_family}</p></div>)}</div></Card>
    </div>
  );
}

export default function MotherPortal({ user, onLogout }) {
  const { t } = useT();
  const [view, setView] = useState('pregnancy');
  const NAV = [['pregnancy', t('mom.pregnancy'), HeartPulse], ['baby', t('mom.baby'), Baby]];
  const TITLES = { pregnancy: [t('mom.pregnancy'), t('mom.screen.sub')], baby: [t('mom.baby'), t('mom.diary')] };
  return (
    <Shell user={user} portalLabel={t('nav.mother')} nav={NAV} view={view} setView={setView} title={TITLES[view][0]} sub={TITLES[view][1]} onLogout={onLogout} accent="#5B6B8C">
      {view === 'pregnancy' ? <Pregnancy /> : <BabyView />}
    </Shell>
  );
}
