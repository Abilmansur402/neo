import { useEffect, useMemo, useState } from 'react';
import { Heart, ArrowRight, Stethoscope, BarChart3, HeartHandshake, History, ShieldCheck, Calculator, Map, Activity, Flag, Cpu } from 'lucide-react';
import { useT, LangSwitch } from '../lib/i18n.jsx';
import { api } from '../services/api.js';
import StellarHeroCanvas from './StellarHeroCanvas.jsx';
import { GlassCard, Metric, IncubatorHUD } from './SpatialCardHUD.jsx';
import { REGIONS as MOCK_REGIONS } from '../lib/mock.js';
import { OriginPill, useProvenance } from './DataOrigin.jsx';

const L = (ru, en, kz) => ({ ru, en, kz: kz || ru });
const FEATURES = [
  { Icon: Activity, color: '#0F4C81', title: L('Риск 24 ч + SHAP', '24h risk + SHAP', '24 сағ қауіп + SHAP'), body: L('XGBoost по 31 признаку из МИС (базовая когорта 804 госпитализаций PICDB, дообучение на местных данных) и водопад от базовой частоты к пациенту.', 'XGBoost over 31 EHR features (804-admission PICDB-shaped baseline, retrained on local data) with a waterfall from base rate to patient.'), portal: 'neonatologist', tag: L('Врачи', 'Doctors', 'Дәрігерлер') },
  { Icon: Stethoscope, color: '#0F4C81', title: L('Оценка при поступлении', 'Admission-time assessment', 'Қабылдау кезіндегі бағалау'), body: L('15 признаков матери и новорождённого → риск госпитальной летальности. Обучено на 1 105 обезличенных госпитализациях КазНМУ им. Асфендиярова, проверено на 2024–2025.', '15 maternal and birth features → in-hospital mortality risk. Trained on 1,105 de-identified KazNMU Asfendiyarov admissions, tested on 2024–2025.'), portal: 'neonatologist', tag: L('Врачи', 'Doctors', 'Дәрігерлер') },
  { Icon: History, color: '#00B4D8', title: L('Машина времени', 'Time machine', 'Уақыт машинасы'), body: L('Повтор по часам: когда сработал сигнал, когда наступило ухудшение и сколько часов между ними.', 'Hour-by-hour replay: when the alert fired, when deterioration was observed, and the lead time between them.'), portal: 'neonatologist', tag: L('Врачи', 'Doctors', 'Дәрігерлер') },
  { Icon: ShieldCheck, color: '#00B4D8', title: L('Обязательная подпись врача', 'Mandatory sign-off', 'Дәрігердің міндетті қолы'), body: L('Каждый прогноз получает решение и запись врача — человек в контуре, как требует Закон № 230-VIII.', 'Every prediction gets a doctor decision and note: the human-in-the-loop record required by Law No. 230-VIII.'), portal: 'neonatologist', tag: L('Врачи', 'Doctors', 'Дәрігерлер') },
  { Icon: Map, color: '#8B5CF6', title: L('Карта детского здоровья', 'Child-health map', 'Бала денсаулығы картасы'), body: L('20 регионов: AshyqData 2025 (младенческая и неонатальная смертность, койки, персонал), MICS 2024, WorldPop, маршруты переводов в центры III уровня.', '20 regions: AshyqData 2025 (infant & neonatal mortality, beds, staff), MICS 2024, WorldPop, transfer routes to Level III hubs.'), portal: 'analyst', tag: L('Аналитики', 'Analysts', 'Талдаушылар') },
  { Icon: Cpu, color: '#3B82F6', title: L('Самообучающаяся модель', 'Self-retraining model', 'Өзін-өзі оқытатын модель'), body: L('Новые местные наборы и подписи врачей переобучают XGBoost в фоне, версионируют и подменяют модель без остановки.', 'New local datasets and clinician sign-offs retrain XGBoost in the background, version it, and hot-swap it live.'), portal: 'analyst', tag: L('Аналитики', 'Analysts', 'Талдаушылар') },
  { Icon: HeartHandshake, color: '#D97706', title: L('Мамы и семьи', 'Mothers & families', 'Аналар мен отбасылар'), body: L('Карта беременности из 18 полей с понятным скринингом риска и спокойный дневник после рождения.', 'An 18-field pregnancy record with a plain-language risk screen, and a calm daily log after birth.'), portal: 'mother', tag: L('Мамы', 'Mothers', 'Аналар') },
  { Icon: BarChart3, color: '#00A896', title: L('Экономика в тенге', 'Economics in tenge', 'Теңгедегі экономика'), body: L('Калькулятор койко-дней ОРИТН и переводов по тарифам ОСМС, журнал аудита и карточка модели с источниками.', 'NICU bed-day and transfer calculator at OSMS tariffs, audit log and a model card with sources.'), portal: 'analyst', tag: L('Аналитики', 'Analysts', 'Талдаушылар') },
];

export default function Landing({ onLaunch }) {
  const { t, lang } = useT();
  const [regions, setRegions] = useState(MOCK_REGIONS);
  const [hovered, setHovered] = useState(null);
  const [tick, setTick] = useState(0);
  const prov = useProvenance();
  useEffect(() => { api.regions().then(setRegions).catch(() => {}); const id = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(id); }, []);
  const byId = useMemo(() => Object.fromEntries(regions.regions.map((r) => [r.id, r])), [regions]);
  const focus = byId[hovered] || byId.astana;
  const name = (r) => r?.[lang] || r?.en;
  const live = { hr: 148 + Math.round(Math.sin(tick / 2) * 3), spo2: 94 + Math.round(Math.sin(tick / 3)), fio2: 35 };

  return (
    <div className="stellar min-h-full">
      <header className="sticky top-0 z-20 px-4 md:px-8 py-3 flex items-center gap-3 glass-dark rounded-none border-x-0 border-t-0">
        <div className="w-9 h-9 rounded-md grid place-items-center text-white" style={{ background: 'linear-gradient(135deg,#0F4C81,#00B4D8)', boxShadow: '0 8px 18px -8px rgba(0,180,216,.6)' }}><Heart size={18} /></div>
        <div className="font-semibold text-lg">NeoOutcome AI</div>
        <nav className="hidden md:flex gap-1 ml-6 text-sm">{[['#portals', 'Portals'], ['#features', 'Platform'], ['/api/docs', 'API']].map(([h, n]) => <a key={n} href={h} className="hud-link">{n}</a>)}</nav>
        <div className="ml-auto flex items-center gap-2"><LangSwitch /><button type="button" className="hud-cta" onClick={() => onLaunch()}>{t('auth.enter')} <ArrowRight size={16} /></button></div>
      </header>

      {/* ---- Hero spatial viewport ---- */}
      <section className="relative px-4 md:px-8 pt-10 md:pt-16 pb-16 max-w-7xl mx-auto grid lg:grid-cols-[1fr_1.15fr] gap-8 items-center">
        <div className="relative z-10">
          <div className="flex flex-wrap gap-2 mb-6">{[['Kazakhstan pilot · Закон № 230-VIII', '#D97706'], ['XGBoost + SHAP', '#00B4D8'], ['Damumed · KazHealth FHIR', '#8B5CF6'], ['Қаз · Рус · Eng', '#64748B']].map(([p, c], i) => <span key={p} className="hud-pill pop-in" style={{ '--glow': c, animationDelay: `${i * 120}ms` }}>{p}</span>)}</div>
          <h1 className="text-[44px] md:text-[60px] font-semibold leading-[1.02]" style={{ letterSpacing: '-0.03em', color: '#0B132B' }}>Spatial Intelligence for Every <span className="hud-gradient-text">Perinatal Centre</span> in Kazakhstan</h1>
          <p className="mt-6 text-lg max-w-xl" style={{ color: '#475569' }}>{t('hero.sub')}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <OriginPill kind={prov?.tabular?.baseline?.is_synthetic ? 'synthetic' : 'real'}>Tabular · {prov?.tabular?.trained_on || '804 PICDB-shaped admissions'}</OriginPill>
            <OriginPill kind="official">Regional · MICS 2024 + UN IGME</OriginPill>
            <OriginPill kind="simulated">CV telemetry · simulated, pending validation</OriginPill>
          </div>
          <div id="portals" className="mt-8 flex flex-wrap gap-3">
            <button type="button" className="hud-portal" style={{ '--glow': '#00B4D8' }} onClick={() => onLaunch('neonatologist')}><Stethoscope size={18} />{t('role.neonatologist')}</button>
            <button type="button" className="hud-portal" style={{ '--glow': '#8B5CF6' }} onClick={() => onLaunch('analyst')}><BarChart3 size={18} />{t('role.analyst')}</button>
            <button type="button" className="hud-portal" style={{ '--glow': '#D97706' }} onClick={() => onLaunch('mother')}><HeartHandshake size={18} />{t('role.mother')}</button>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">{[[prov?.tabular?.metrics?.auroc ? prov.tabular.metrics.auroc.toFixed(2) : '—', 'AUROC · CV'], ['31', 'core features'], ['3.94‰', 'NMR 2024 · UN IGME']].map(([v, l]) => <GlassCard key={l} className="p-3" tilt={5}><div className="hud-num text-2xl">{v}</div><div className="hud-label mt-1">{l}</div></GlassCard>)}</div>
        </div>

        <div className="relative">
          <StellarHeroCanvas className="stellar-canvas mb-8" regions={regions.regions} routes={regions.transfer_routes} hoveredId={hovered} onHover={setHovered} />
          {/* floating telemetry cards */}
          <GlassCard className="absolute -top-3 -left-2 md:-left-8 p-3 min-w-[132px] float" glow="#00B4D8" tilt={10}><Metric label="SpO2 · simulated" value={live.spo2} unit="%" color="#00A896" /></GlassCard>
          <GlassCard className="absolute top-[14%] -right-2 md:-right-8 p-3 min-w-[132px] float-2" glow="#8B5CF6" tilt={10}><Metric label="Heart rate" value={live.hr} unit="bpm" color="#8B5CF6" /></GlassCard>
          <GlassCard className="absolute bottom-[14%] -left-2 md:-left-8 p-3 min-w-[132px] float-2" glow="#3B82F6" tilt={10}><Metric label="FiO2" value={live.fio2} unit="%" color="#3B82F6" sub="S/F 269" /></GlassCard>
          {/* hovered node panel */}
          <GlassCard className="absolute -bottom-10 right-2 md:-right-6 p-4 min-w-[240px]" glow={hovered ? '#00B4D8' : '#8B5CF6'} tilt={5} night>
            <div className="hud-label flex items-center justify-between"><span>{hovered ? 'Node · live' : 'Hover a centre'}</span><span className="hud-dot" /></div>
            <div className="font-semibold text-lg mt-1" style={{ color: '#fff' }}>{name(focus)}</div>
            <div className="hud-sub">{focus.centre} · Level {['', 'I', 'II', 'III'][focus.level]}{focus.growth ? ' · growth region' : ''}</div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Metric label="NMR · MICS 2024" value={focus.nmr ?? 'n/a'} unit={focus.nmr != null ? '‰' : ''} color={focus.nmr == null ? '#94A3B8' : focus.nmr >= 6 ? '#E8788A' : focus.nmr >= 4 ? '#F5C26B' : '#00B4D8'} sub={focus.nmr == null ? 'suppressed (<250 py)' : 'official'} />
              <Metric label="NICU beds" value={focus.nicu_beds} unit="" color="#A5B4FC" sub={`${focus.utilisation}% · estimate`} />
              <Metric label="Level" value={['', 'I', 'II', 'III'][focus.level]} unit="" color="#E2E8F0" sub="estimate" />
            </div>
          </GlassCard>
        </div>
      </section>

      {/* ---- Incubator HUD + ticker ---- */}
      <section className="px-4 md:px-8 pb-16 max-w-7xl mx-auto grid lg:grid-cols-[1.2fr_1fr] gap-6 items-start">
        <IncubatorHUD risk={31} />
        <div className="grid gap-3">
          <GlassCard className="p-5" glow="#00B4D8" tilt={5}><div className="flex items-center justify-between gap-2"><div className="hud-label">Live telemetry · Bed 07</div><OriginPill kind="simulated">simulated</OriginPill></div><div className="grid grid-cols-3 gap-4 mt-3"><Metric label="NFCS" value="2" unit="/8" /><Metric label="RR (cv)" value="58" unit="" color="#8B5CF6" /><Metric label="Core–periph Δ" value="1.8" unit="°C" color="#D97706" /></div><div className="hud-sub mt-3">Non-contact landmarks, chest-wall motion and perfusion proxy streamed from the bedside edge node over WebSocket.</div></GlassCard>
          <GlassCard className="p-5" glow="#8B5CF6" tilt={5}><div className="hud-label">Pilot programme</div><div className="font-semibold text-lg mt-1">Astana NRC · Almaty PC1 · Shymkent RPC · Karaganda RPC</div><div className="hud-sub mt-1">Shadow-mode go-live Q1 2027. On-premise data residency; every PHI read audited.</div><button type="button" className="hud-cta mt-4" onClick={() => onLaunch('admin')}><Flag size={16} />Readiness tracker</button></GlassCard>
        </div>
      </section>

      {/* ---- Feature grid ---- */}
      <section id="features" className="px-4 md:px-8 pb-20 max-w-7xl mx-auto">
        <div className="hud-label mb-3">Three portals, one platform</div>
        <h2 className="text-3xl md:text-4xl font-semibold max-w-2xl" style={{ color: '#0B132B' }}>Doctors decide. Analysts see the whole country. Mothers understand.</h2>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f, i) => (
            <button type="button" key={f.title.en} className="glass-dark p-5 text-left pop-in hud-feature" style={{ '--glow': f.color, animationDelay: `${i * 70}ms` }} onClick={() => onLaunch(f.portal)}>
              <div className="flex items-center justify-between"><div className="w-10 h-10 rounded-md grid place-items-center" style={{ background: `${f.color}14`, color: f.color }}><f.Icon size={18} /></div><span className="hud-pill" style={{ '--glow': f.color }}>{f.tag[lang] || f.tag.en}</span></div>
              <div className="font-semibold text-lg mt-4">{f.title[lang] || f.title.en}</div>
              <p className="text-sm mt-2" style={{ color: '#64748B' }}>{f.body[lang] || f.body.ru}</p>
            </button>
          ))}
        </div>
      </section>

      <footer className="px-4 md:px-8 py-6 border-t border-line flex flex-wrap items-center gap-4 text-xs muted">
        <span className="font-semibold text-fg">NeoOutcome AI</span><span>{t('disclaimer')}</span><span className="ml-auto mono">v2.0 · KZ pilot</span>
      </footer>
    </div>
  );
}
