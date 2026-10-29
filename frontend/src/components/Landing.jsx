import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Stethoscope, BarChart3, HeartHandshake, History, ShieldCheck, Calculator, Map, Activity, Flag, Cpu } from 'lucide-react';
import { useT, LangSwitch } from '../lib/i18n.jsx';
import { api } from '../services/api.js';
import KazakhstanChoropleth from './regional/KazakhstanChoropleth.jsx';
import Logo from './Logo.jsx';
import SoundToggle from './SoundToggle.jsx';
import { GlassCard, Metric, IncubatorHUD } from './SpatialCardHUD.jsx';
import { REGIONS as MOCK_RAW } from '../lib/mock.js';
import { offlineOverlay } from '../lib/official.js';
const MOCK_REGIONS = { ...MOCK_RAW, regions: MOCK_RAW.regions.map((r) => ({ ...r, official: offlineOverlay(r.id) })) };
import { OriginPill, useProvenance } from './DataOrigin.jsx';

const L = (ru, en, kz) => ({ ru, en, kz: kz || ru });
const FEATURES = [
  { Icon: Activity, color: '#0E9F9B', title: L('Риск 24 ч + SHAP', '24h risk + SHAP', '24 сағ қауіп + SHAP'), body: L('XGBoost по 31 признаку из МИС (базовая когорта 804 госпитализаций PICDB, дообучение на местных данных) и водопад от базовой частоты к пациенту.', 'XGBoost over 31 EHR features (804-admission PICDB-shaped baseline, retrained on local data) with a waterfall from base rate to patient.'), portal: 'neonatologist', tag: L('Врачи', 'Doctors', 'Дәрігерлер') },
  { Icon: Stethoscope, color: '#0E9F9B', title: L('Оценка при поступлении', 'Admission-time assessment', 'Қабылдау кезіндегі бағалау'), body: L('15 признаков матери и новорождённого → риск госпитальной летальности. Обучено на 1 105 обезличенных госпитализациях КазНМУ им. Асфендиярова, проверено на 2024–2025.', '15 maternal and birth features → in-hospital mortality risk. Trained on 1,105 de-identified KazNMU Asfendiyarov admissions, tested on 2024–2025.'), portal: 'neonatologist', tag: L('Врачи', 'Doctors', 'Дәрігерлер') },
  { Icon: History, color: '#2F80ED', title: L('Машина времени', 'Time machine', 'Уақыт машинасы'), body: L('Повтор по часам: когда сработал сигнал, когда наступило ухудшение и сколько часов между ними.', 'Hour-by-hour replay: when the alert fired, when deterioration was observed, and the lead time between them.'), portal: 'neonatologist', tag: L('Врачи', 'Doctors', 'Дәрігерлер') },
  { Icon: ShieldCheck, color: '#2F80ED', title: L('Обязательная подпись врача', 'Mandatory sign-off', 'Дәрігердің міндетті қолы'), body: L('Каждый прогноз получает решение и запись врача — человек в контуре, как требует Закон № 230-VIII.', 'Every prediction gets a doctor decision and note: the human-in-the-loop record required by Law No. 230-VIII.'), portal: 'neonatologist', tag: L('Врачи', 'Doctors', 'Дәрігерлер') },
  { Icon: Map, color: '#7C6CF6', title: L('Карта детского здоровья', 'Child-health map', 'Бала денсаулығы картасы'), body: L('20 регионов: AshyqData 2025 (младенческая и неонатальная смертность, койки, персонал), MICS 2024, WorldPop, маршруты переводов в центры III уровня.', '20 regions: AshyqData 2025 (infant & neonatal mortality, beds, staff), MICS 2024, WorldPop, transfer routes to Level III hubs.'), portal: 'analyst', tag: L('Аналитики', 'Analysts', 'Талдаушылар') },
  { Icon: Cpu, color: '#0E9F9B', title: L('Самообучающаяся модель', 'Self-retraining model', 'Өзін-өзі оқытатын модель'), body: L('Новые местные наборы и подписи врачей переобучают XGBoost в фоне, версионируют и подменяют модель без остановки.', 'New local datasets and clinician sign-offs retrain XGBoost in the background, version it, and hot-swap it live.'), portal: 'analyst', tag: L('Аналитики', 'Analysts', 'Талдаушылар') },
  { Icon: HeartHandshake, color: '#F59E0B', title: L('Мамы и семьи', 'Mothers & families', 'Аналар мен отбасылар'), body: L('Карта беременности из 18 полей с понятным скринингом риска и спокойный дневник после рождения.', 'An 18-field pregnancy record with a plain-language risk screen, and a calm daily log after birth.'), portal: 'mother', tag: L('Мамы', 'Mothers', 'Аналар') },
  { Icon: BarChart3, color: '#16A34A', title: L('Экономика в тенге', 'Economics in tenge', 'Теңгедегі экономика'), body: L('Калькулятор койко-дней ОРИТН и переводов по тарифам ОСМС, журнал аудита и карточка модели с источниками.', 'NICU bed-day and transfer calculator at OSMS tariffs, audit log and a model card with sources.'), portal: 'analyst', tag: L('Аналитики', 'Analysts', 'Талдаушылар') },
];

const STEPS = [
  { Icon: Stethoscope, portal: 'neonatologist', n: L('Шаг 1', 'Step 1', '1-қадам'), title: L('Врач', 'Doctor', 'Дәрігер'), body: L('Приём, риск 24 ч с объяснением, оценка при поступлении, подпись врача.', 'Intake, 24 h risk with explanations, admission-time score, sign-off.', 'Қабылдау, 24 сағ қауіп, қабылдаудағы баға, дәрігер қолы.') },
  { Icon: BarChart3, portal: 'analyst', n: L('Шаг 2', 'Step 2', '2-қадам'), title: L('Аналитик', 'Analyst', 'Талдаушы'), body: L('Карта регионов, аудит, качество модели, экономика в тенге.', 'Regional map, audit log, model quality, economics in tenge.', 'Өңірлер картасы, аудит, модель сапасы, экономика.') },
  { Icon: HeartHandshake, portal: 'mother', n: L('Шаг 3', 'Step 3', '3-қадам'), title: L('Мама', 'Mother', 'Ана'), body: L('Карта беременности, понятный скрининг риска, дневник малыша.', 'Pregnancy record, plain-language risk screen, baby diary.', 'Жүктілік картасы, түсінікті скрининг, сәби күнделігі.') },
];
const HERO = {
  title: L('Раннее предупреждение для каждого новорождённого в реанимации.', 'Early warning for every newborn in intensive care.', 'Реанимациядағы әр нәресте үшін ерте ескерту.'),
  sub: L('NeoOutcome AI показывает риск ухудшения за 24 часа, объясняет его и оставляет решение за врачом. Три портала — для врачей, аналитиков и мам.', 'NeoOutcome AI shows the 24-hour deterioration risk, explains it and leaves the decision with the doctor. Three portals: doctors, analysts, mothers.', 'NeoOutcome AI 24 сағаттық нашарлау қаупін көрсетіп, түсіндіреді, шешімді дәрігерге қалдырады.'),
  how: L('Как это работает', 'How it works', 'Қалай жұмыс істейді'),
  map: L('20 регионов на одной карте', '20 regions on one map', 'Бір картадағы 20 өңір'),
  mapSub: L('Перинатальные центры по уровням, маршруты переводов и регионы роста смертности. Наведите на центр.', 'Perinatal centres by level, transfer routes and growth regions. Hover a centre.', 'Деңгей бойынша перинаталдық орталықтар, ауыстыру бағыттары. Орталыққа меңзеңіз.'),
  features: L('Что внутри', 'What is inside', 'Ішінде не бар'),
  featuresSub: L('Врачи решают. Аналитики видят всю страну. Мамы понимают.', 'Doctors decide. Analysts see the whole country. Mothers understand.', 'Дәрігерлер шешеді. Талдаушылар бүкіл елді көреді. Аналар түсінеді.'),
  telemetry: L('Телеметрия у кувеза', 'Bedside telemetry', 'Кувез жанындағы телеметрия'),
};

export default function Landing({ onLaunch }) {
  const { t, lang } = useT();
  const [regions, setRegions] = useState(MOCK_REGIONS);
  const [hovered, setHovered] = useState(null); const [sel, setSel] = useState('astana'); const [metric, setMetric] = useState('neonatal_mortality');
  const prov = useProvenance();
  useEffect(() => { api.regions().then(setRegions).catch(() => {}); }, []);
  const byId = useMemo(() => Object.fromEntries(regions.regions.map((r) => [r.id, r])), [regions]);
  const focus = byId[sel] || byId[hovered] || byId.astana;
  const name = (r) => r?.[lang] || r?.en;
  const T = (o) => o[lang] || o.ru;

  return (
    <div className="stellar min-h-full">
      <header className="sticky top-0 z-20 px-4 md:px-8 py-3 flex items-center gap-3" style={{ background: 'rgba(246,244,239,.86)', backdropFilter: 'blur(10px)', borderBottom: '1px solid #D9E8EC' }}>
        <Logo size={36} />
        <nav className="hidden md:flex gap-1 ml-6 text-sm">{[['#how', T(HERO.how)], ['#map', T(HERO.map)], ['#features', T(HERO.features)], ['/api/docs', 'API']].map(([h, n]) => <a key={n} href={h} className="hud-link">{n}</a>)}</nav>
        <div className="ml-auto flex items-center gap-2"><LangSwitch /><SoundToggle /><button type="button" className="hud-cta py-2.5 px-4 text-sm" onClick={() => onLaunch()}>{t('auth.enter')} <ArrowRight size={16} /></button></div>
      </header>

      {/* ---- Hero ---- */}
      <section className="px-4 md:px-8 pt-12 md:pt-20 pb-10 max-w-6xl mx-auto grid lg:grid-cols-[1.05fr_1fr] gap-10 items-center">
        <div>
          <h1 className="text-[36px] md:text-[48px] leading-[1.12] max-w-[15em]">{T(HERO.title)}</h1>
          <p className="mt-5 text-[17px] max-w-xl" style={{ color: '#52708A' }}>{T(HERO.sub)}</p>
          <div id="portals" className="mt-7 flex flex-wrap gap-3">
            <button type="button" className="hud-cta" onClick={() => onLaunch('neonatologist')}><Stethoscope size={18} />{t('role.neonatologist')}</button>
            <button type="button" className="hud-portal" onClick={() => onLaunch('analyst')}><BarChart3 size={18} />{t('role.analyst')}</button>
            <button type="button" className="hud-portal" onClick={() => onLaunch('mother')}><HeartHandshake size={18} />{t('role.mother')}</button>
          </div>
          <div className="mt-6 flex flex-wrap gap-1.5">
            <OriginPill kind={prov?.tabular?.baseline?.is_synthetic ? 'synthetic' : 'real'}>24 h · {prov?.tabular?.trained_on || '804 PICDB-shaped admissions'}</OriginPill>
            <OriginPill kind="real">Асфендиярова · 1 105 · 2021–2025</OriginPill>
            <OriginPill kind="official">AshyqData 2025 · MICS 2024 · UN IGME</OriginPill>
            <OriginPill kind="simulated">CV · simulated</OriginPill>
          </div>
        </div>
        <div className="card p-3 md:p-4">
          <div className="flex items-center justify-between gap-2 px-1 pb-2"><div className="hud-label">{lang === 'en' ? 'Where babies are born' : lang === 'kz' ? 'Нәрестелер қайда туады' : 'Где рождаются дети'}</div><OriginPill kind="official">WorldPop 2015 · 1 km</OriginPill></div>
          <KazakhstanChoropleth regions={regions.regions} metric={metric} selected={sel} onSelect={setSel} raster compact height="min-h-[300px]" />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-xs muted"><span>{lang === 'en' ? 'Pregnancies per km² (WorldPop raster) · boundaries © OpenStreetMap' : 'Беременности на км² (растр WorldPop) · границы © OpenStreetMap'}</span><span className="font-semibold text-fg">{name(focus)}: {focus.official?.ashyq?.neonatal_mortality ?? '—'} ‰ · AshyqData 2025</span></div>
        </div>
      </section>

      {/* ---- Three steps (portals) ---- */}
      <section id="how" className="px-4 md:px-8 pb-14 max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-4">
          {STEPS.map((s, i) => (
            <button type="button" key={s.portal} className="glass-dark step-card p-6 text-left hud-feature" onClick={() => onLaunch(s.portal)}>
              <div className="ico"><s.Icon size={26} /></div>
              <div className="hud-label mt-5">{T(s.n)}</div>
              <div className="display text-[22px] mt-1">{T(s.title)}</div>
              <p className="text-sm mt-1.5" style={{ color: '#52708A' }}>{T(s.body)}</p>
              {i < 2 && <span className="arrow"><ArrowRight size={18} /></span>}
            </button>
          ))}
        </div>
      </section>

      {/* ---- Regional constellation ---- */}
      <section id="map" className="px-4 md:px-8 pb-14 max-w-6xl mx-auto">
        <div className="glass-dark p-5 md:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
            <div><h2 className="text-[26px]">{T(HERO.map)}</h2><p className="mt-1 text-sm" style={{ color: '#52708A' }}>{T(HERO.mapSub)}</p></div>
            <div className="flex gap-3 text-sm">{[[prov?.tabular?.metrics?.auroc ? prov.tabular.metrics.auroc.toFixed(2) : '—', 'AUROC'], ['31', lang === 'en' ? 'features' : 'признак'], ['3.94‰', 'NMR 2024']].map(([v, l]) => <div key={l} className="text-right"><div className="hud-num text-2xl">{v}</div><div className="hud-sub">{l}</div></div>)}</div>
          </div>
          <div className="grid lg:grid-cols-[1fr_300px] gap-4">
            <div>
              <div className="flex flex-wrap gap-2 mb-3">{[['neonatal_mortality', lang === 'en' ? 'Neonatal mortality' : 'Неонатальная смертность'], ['infant_mortality', lang === 'en' ? 'Infant mortality' : 'Младенческая смертность'], ['hospital_beds', lang === 'en' ? 'Hospital beds' : 'Койки'], ['pregnancies', lang === 'en' ? 'Pregnancies 2015' : 'Беременности 2015']].map(([k, l]) => <button key={k} type="button" className={`btn py-1.5 ${metric === k ? 'btn-primary' : ''}`} onClick={() => setMetric(k)}>{l}</button>)}</div>
              <KazakhstanChoropleth regions={regions.regions} metric={metric} selected={sel} onSelect={setSel} height="min-h-[420px]" />
            </div>
            <div className="card p-5 self-start">
              <div className="hud-label">{lang === 'en' ? 'Region' : 'Регион'}</div>
              <div className="display text-[22px] mt-1">{name(focus)}</div>
              <div className="muted text-sm">{focus.centre} · {t('an.level')} {['', 'I', 'II', 'III'][focus.level]}{focus.growth ? ` · ${t('an.growth')}` : ''}</div>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <Metric label={lang === 'en' ? 'Neonatal ‰' : 'Неонат. ‰'} value={focus.official?.ashyq?.neonatal_mortality ?? '—'} unit="" color="#E5484D" sub="AshyqData 2025" />
                <Metric label={lang === 'en' ? 'Infant ‰' : 'Млад. ‰'} value={focus.official?.ashyq?.infant_mortality ?? '—'} unit="" color="#0B2239" sub="AshyqData 2025" />
                <Metric label="NMR · MICS" value={focus.nmr ?? '—'} unit={focus.nmr != null ? '‰' : ''} color="#0E9F9B" sub={focus.nmr == null ? (lang === 'en' ? 'suppressed' : 'скрыто') : 'MICS 2024'} />
                <Metric label={lang === 'en' ? 'Pregnancies' : 'Беременности'} value={focus.official?.worldpop_pregnancies_2015?.toLocaleString('ru-RU') ?? '—'} unit="" color="#16A34A" sub="WorldPop 2015" />
              </div>
              <div className="muted text-xs mt-4">{lang === 'en' ? 'Transfers to' : 'Переводы в'}: <span className="font-semibold text-fg">{regions.transfer_routes.filter(([a]) => a === focus.id).map(([, b]) => byId[b]?.centre).join(', ') || (lang === 'en' ? 'Level III hub' : 'центр III уровня')}</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- Bedside telemetry (simulated) ---- */}
      <section className="px-4 md:px-8 pb-14 max-w-6xl mx-auto grid lg:grid-cols-[1.2fr_1fr] gap-5 items-start">
        <IncubatorHUD risk={31} />
        <div className="grid gap-4">
          <GlassCard className="p-5" tilt={0}><div className="flex items-center justify-between gap-2"><div className="hud-label">{T(HERO.telemetry)} · Bed 07</div><OriginPill kind="simulated">simulated</OriginPill></div><div className="grid grid-cols-3 gap-4 mt-3"><Metric label="NFCS" value="2" unit="/8" /><Metric label="Skin T" value="36.4" unit="°C" /><Metric label="S/F" value="269" unit="" /></div><p className="hud-sub mt-3">{lang === 'en' ? 'Frames are synthesised: the camera pipeline is pending clinical validation and is shown as a next stage.' : 'Кадры синтезируются: видеоконвейер ожидает клинической валидации и показан как следующий этап.'}</p></GlassCard>
          <GlassCard className="p-5" tilt={0}><div className="hud-label">{lang === 'en' ? 'Pilot programme' : 'Пилотная программа'}</div><div className="display text-lg mt-1">Astana NRC · Almaty PC1 · Shymkent RPC · Karaganda RPC</div><div className="hud-sub mt-1">{lang === 'en' ? 'Shadow-mode go-live Q1 2027. On-premise data residency; every PHI read audited.' : 'Теневой режим с I квартала 2027. Данные остаются в периметре больницы; каждое чтение ПДн — в аудите.'}</div></GlassCard>
        </div>
      </section>

      {/* ---- Feature grid ---- */}
      <section id="features" className="px-4 md:px-8 pb-20 max-w-6xl mx-auto">
        <div className="hud-label mb-2">{T(HERO.features)}</div>
        <h2 className="text-[28px] md:text-[34px] max-w-2xl">{T(HERO.featuresSub)}</h2>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <button type="button" key={f.title.en} className="glass-dark p-5 text-left hud-feature" onClick={() => onLaunch(f.portal)}>
              <div className="flex items-center justify-between"><div className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: '#DDF5F4', color: '#0B2239' }}><f.Icon size={18} /></div><span className="hud-pill">{f.tag[lang] || f.tag.en}</span></div>
              <div className="display text-[19px] mt-4">{f.title[lang] || f.title.en}</div>
              <p className="text-sm mt-2" style={{ color: '#52708A' }}>{f.body[lang] || f.body.ru}</p>
            </button>
          ))}
        </div>
      </section>

      <footer className="px-4 md:px-8 py-6 border-t border-line flex flex-wrap items-center gap-4 text-xs muted max-w-6xl mx-auto">
        <span className="font-semibold text-fg">NeoOutcome AI</span><span>{t('disclaimer')}</span><span className="ml-auto">v2.1 · KZ pilot</span>
      </footer>
    </div>
  );
}
