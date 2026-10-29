/**
 * Offline fallbacks for the intake page (synthetic bundle, admission scorecard, appointments).
 * Mirrors backend/services/patient_card.py and services/admission_engine.py closely enough for a demo;
 * the server versions are authoritative when the API is online.
 */
import { scoreRisk } from './risk.js';

export const ADMISSION_FIELDS = [
  { key: 'b_gestational', label: { ru: 'Срок гестации', kz: 'Гестация мерзімі', en: 'Gestational age' }, kind: 'number', unit: 'нед', min: 22, max: 42, group: 'newborn' },
  { key: 'b_weight', label: { ru: 'Масса при рождении', kz: 'Туған кездегі салмақ', en: 'Birth weight' }, kind: 'number', unit: 'г', min: 300, max: 6000, step: 10, group: 'newborn' },
  { key: 'b_apgar', label: { ru: 'Апгар', kz: 'Апгар', en: 'Apgar' }, kind: 'number', unit: 'балл', min: 0, max: 10, group: 'newborn' },
  { key: 'b_respiratory_failure', label: { ru: 'Дыхательная недостаточность', kz: 'Тыныс жеткіліксіздігі', en: 'Respiratory failure' }, kind: 'select', options: ['0', '1', '2', '3'].map((v) => ({ value: v, label: `${v} степень` })), group: 'newborn' },
  { key: 'b_heart_rate', label: { ru: 'ЧСС', kz: 'ЖСЖ', en: 'Heart rate' }, kind: 'number', unit: 'уд/мин', min: 40, max: 250, group: 'newborn' },
  { key: 'b_saturation', label: { ru: 'SpO₂', kz: 'SpO₂', en: 'SpO₂' }, kind: 'number', unit: '%', min: 20, max: 100, group: 'newborn' },
  { key: 'b_gender', label: { ru: 'Пол (код)', kz: 'Жынысы (код)', en: 'Sex (code)' }, kind: 'select', options: [{ value: '1', label: 'Код 1' }, { value: '2', label: 'Код 2' }], group: 'newborn' },
  { key: 'b_blood', label: { ru: 'Группа крови', kz: 'Қан тобы', en: 'Blood group' }, kind: 'select', options: ['1', '2', '3', '4'].map((v) => ({ value: v, label: `Код ${v}` })), group: 'newborn' },
  { key: 'b_rhesus', label: { ru: 'Резус (код)', kz: 'Резус (код)', en: 'Rhesus (code)' }, kind: 'select', options: [{ value: '0', label: 'Код 0' }, { value: '1', label: 'Код 1' }], group: 'newborn' },
  { key: 'm_age', label: { ru: 'Возраст матери', kz: 'Ана жасы', en: 'Maternal age' }, kind: 'number', unit: 'лет', min: 14, max: 55, group: 'maternal' },
  { key: 'm_birth', label: { ru: 'Родоразрешение (код)', kz: 'Босану тәсілі (код)', en: 'Delivery (code)' }, kind: 'select', options: [{ value: '1', label: 'Код 1' }, { value: '2', label: 'Код 2' }], group: 'maternal' },
  { key: 'm_obstetric', label: { ru: 'Отягощённый акуш. анамнез', kz: 'Ауыр акушерлік анамнез', en: 'Adverse obstetric history' }, kind: 'yesno', group: 'maternal' },
  { key: 'm_preeclampsia', label: { ru: 'Преэклампсия', kz: 'Преэклампсия', en: 'Pre-eclampsia' }, kind: 'yesno', group: 'maternal' },
  { key: 'm_chorioamnionitis', label: { ru: 'Хориоамнионит', kz: 'Хориоамнионит', en: 'Chorioamnionitis' }, kind: 'yesno', group: 'maternal' },
  { key: 'm_intrauterine', label: { ru: 'Внутриутробная инфекция', kz: 'Жатырішілік инфекция', en: 'Intrauterine infection' }, kind: 'yesno', group: 'maternal' },
];

export const ADMISSION_DEFAULTS = { b_gestational: 32, b_weight: 1700, b_apgar: 6, b_respiratory_failure: '2', b_heart_rate: 150, b_saturation: 90, b_gender: '1', b_blood: '2', b_rhesus: '1', m_age: 28, m_birth: '2', m_obstetric: '0', m_preeclampsia: '0', m_chorioamnionitis: '0', m_intrauterine: '0' };

const ADMISSION_NOTICE = 'Модель обучена на обезличенных данных КазНМУ им. Асфендиярова (2021–2023), проверена на 2024–2025. Исследовательский прототип, не является диагнозом или медицинской рекомендацией.';

/** Client-side logistic surrogate of the admission model (offline only). Weights follow the trained model's gain ordering. */
export function mockAdmission(f) {
  const n = (k, d) => { const v = parseFloat(f[k]); return Number.isFinite(v) ? v : d; };
  const terms = [
    ['b_saturation', (88 - n('b_saturation', 90)) * 0.06, 'SpO₂ при поступлении', n('b_saturation', null), '%'],
    ['b_apgar', (6 - n('b_apgar', 6)) * 0.35, 'Апгар', n('b_apgar', null), 'балл'],
    ['b_respiratory_failure', (n('b_respiratory_failure', 2) - 1.5) * 0.6, 'Дыхательная недостаточность, степень', n('b_respiratory_failure', null), ''],
    ['b_gestational', (31 - n('b_gestational', 32)) * 0.18, 'Срок гестации', n('b_gestational', null), 'нед'],
    ['b_weight', (1600 - n('b_weight', 1700)) / 900, 'Масса при рождении', n('b_weight', null), 'г'],
    ['b_heart_rate', Math.abs(n('b_heart_rate', 150) - 145) * 0.012, 'ЧСС при поступлении', n('b_heart_rate', null), 'уд/мин'],
    ['m_chorioamnionitis', n('m_chorioamnionitis', 0) * 0.5, 'Хориоамнионит', n('m_chorioamnionitis', null), ''],
    ['m_intrauterine', n('m_intrauterine', 0) * 0.4, 'Внутриутробная инфекция', n('m_intrauterine', null), ''],
    ['m_preeclampsia', n('m_preeclampsia', 0) * 0.25, 'Преэклампсия', n('m_preeclampsia', null), ''],
    ['m_obstetric', n('m_obstetric', 0) * 0.2, 'Отягощённый акушерский анамнез', n('m_obstetric', null), ''],
    ['m_age', Math.abs(n('m_age', 28) - 28) * 0.015, 'Возраст матери', n('m_age', null), 'лет'],
  ];
  const logit = -1.4 + terms.reduce((a, t) => a + t[1], 0);
  const risk = 1 / (1 + Math.exp(-logit));
  const threshold = 0.4055;
  const rows = terms.map(([feature, c, label, value, unit]) => ({ feature, label, value, unit, contribution: Math.round(c * 1e5) / 1e5, direction: c >= 0 ? 'raises' : 'lowers' })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const band = risk >= threshold ? 'high' : risk >= threshold * 0.5 ? 'elevated' : risk >= 0.1 ? 'moderate' : 'low';
  return { model_name: 'neooutcome_admission_xgb', model_version: 'asfendiyarov-2021-2023 (client surrogate)', outcome: 'in_hospital_death', risk_probability: risk, risk_percent: Math.round(risk * 1000) / 10, operating_threshold: threshold, threshold_crossed: risk >= threshold, risk_band: band, top_factors: rows.slice(0, 6), shap_values: rows, input_warnings: [], validation: { test_period: '2024–2025', n_test: 290, auroc: 0.826, auroc_95ci: [0.77, 0.87], sensitivity: 0.71, specificity: 0.78 }, disclaimer: ADMISSION_NOTICE, generated_at: new Date().toISOString() };
}

export const ADMISSION_INFO = { ready: true, model_name: 'neooutcome_admission_xgb', model_version: 'asfendiyarov-2021-2023', threshold: 0.4055, metrics: { n: 290, auroc: 0.826, auroc_95ci: [0.77, 0.87], sensitivity: 0.71, specificity: 0.78, brier: 0.14 }, report: { split: { train: '2021-2023', test: '2024-2025', n_train: 815, n_test: 290 }, n_rows: 1105, source: 'KazNMU n.a. S.D. Asfendiyarov de-identified NICU extract, 2021-2025' }, disclaimer: ADMISSION_NOTICE };

export const SYNTHETIC_BUNDLE = {
  schema_version: '1.0', synthetic: true,
  patient: { patient_id: 'SYN-NICU-0001', full_name: 'Демо-пациент N-0001', sex: 'F', date_of_birth: '2026-07-12', gestational_age: '32 недели 4 дня', birth_weight_g: 1780, current_weight_g: 1740, blood_group: 'не определена' },
  encounter: { encounter_id: 'SYN-HADM-0001', institution: 'NeoOutcome Demonstration NICU', department: 'Отделение реанимации и интенсивной терапии новорождённых', admitted_at: '2026-07-17T08:15:00+05:00', prediction_time: '2026-07-17T20:15:00+05:00', admission_diagnosis: 'Респираторный дистресс, динамическое наблюдение', attending_clinician: 'Демо-врач А. Каримова' },
  features: { gender: 0, age_days_at_admission: 5, hr_mean: 165, hr_min: 130, hr_max: 205, rr_mean: 52, rr_min: 35, rr_max: 78, temp_mean: 36.7, temp_max: 37.4, sbp_mean: 52, vitals_count_12h: 96, ph_mean: 7.21, ph_min: 7.12, lactate_mean: 3.8, lactate_max: 5.2, po2_mean: 64, po2_min: 48, pco2_mean: 52, base_excess_mean: -6.5, base_excess_min: -10, glucose_mean: 4.5, glucose_min: 2.8, glucose_max: 7.1, hemoglobin_mean: 145, platelets_min: 155, wbc_mean: 18, wbc_max: 21, sodium_mean: 137, potassium_mean: 4.7, labs_count_12h: 22 },
};

export const BUNDLE_FEATURES = ['gender', 'age_days_at_admission', 'hr_mean', 'hr_min', 'hr_max', 'rr_mean', 'rr_min', 'rr_max', 'temp_mean', 'temp_max', 'sbp_mean', 'vitals_count_12h', 'ph_mean', 'ph_min', 'lactate_mean', 'lactate_max', 'po2_mean', 'po2_min', 'pco2_mean', 'base_excess_mean', 'base_excess_min', 'glucose_mean', 'glucose_min', 'glucose_max', 'hemoglobin_mean', 'platelets_min', 'wbc_mean', 'wbc_max', 'sodium_mean', 'potassium_mean', 'labs_count_12h'];
export const BUNDLE_LABELS = { gender: 'Пол (M=1, F=0)', age_days_at_admission: 'Возраст при поступлении, дней', hr_mean: 'ЧСС, среднее', hr_min: 'ЧСС, минимум', hr_max: 'ЧСС, максимум', rr_mean: 'ЧДД, среднее', rr_min: 'ЧДД, минимум', rr_max: 'ЧДД, максимум', temp_mean: 'Температура, средняя', temp_max: 'Температура, максимум', sbp_mean: 'Систолическое АД, среднее', vitals_count_12h: 'Измерений витальных', ph_mean: 'pH, среднее', ph_min: 'pH, минимум', lactate_mean: 'Лактат, среднее', lactate_max: 'Лактат, максимум', po2_mean: 'pO2, среднее', po2_min: 'pO2, минимум', pco2_mean: 'pCO2, среднее', base_excess_mean: 'BE, среднее', base_excess_min: 'BE, минимум', glucose_mean: 'Глюкоза, средняя', glucose_min: 'Глюкоза, минимум', glucose_max: 'Глюкоза, максимум', hemoglobin_mean: 'Гемоглобин', platelets_min: 'Тромбоциты, минимум', wbc_mean: 'Лейкоциты, среднее', wbc_max: 'Лейкоциты, максимум', sodium_mean: 'Натрий', potassium_mean: 'Калий', labs_count_12h: 'Лабораторных измерений' };

const AGG = { hr_mean: 'heart_rate', rr_mean: 'resp_rate', temp_mean: 'temperature', sbp_mean: 'map_mmhg', ph_mean: 'ph', lactate_mean: 'lactate', po2_mean: 'po2', pco2_mean: 'pco2', base_excess_mean: 'base_excess', glucose_mean: 'glucose', hemoglobin_mean: 'hemoglobin', platelets_min: 'platelets', wbc_mean: 'wbc', sodium_mean: 'sodium', potassium_mean: 'potassium' };

export function mockScoreBundle(bundle) {
  const f = bundle.features || {};
  const eng = { sex: bundle.patient?.sex === 'M' || f.gender === 1 ? 'M' : 'F', gestational_age_wk: parseFloat(bundle.patient?.gestational_age) || 32, birth_weight_g: bundle.patient?.birth_weight_g || 1800, apgar_1: 6, apgar_5: 7, age_hours: (f.age_days_at_admission || 5) * 24, spo2: 93, fio2: 30, vent_mode: 'nCPAP', delivery_mode: 'cesarean', hco3: 20, crp: 8, creatinine: 60, bilirubin: 90, urine_output: 2 };
  Object.entries(AGG).forEach(([s, d]) => { if (f[s] != null) eng[d] = f[s]; });
  const r = scoreRisk(eng);
  const threshold = 0.389;
  const risk = r.risk_probability;
  const band = risk >= threshold ? 'high' : risk >= threshold * 0.7 ? 'elevated' : risk >= threshold * 0.35 ? 'moderate' : 'low';
  const actions = ['Сверить загруженные значения с первичной медицинской документацией.'];
  if (risk >= threshold) actions.push('Передать оценку старшему врачу для приоритетного клинического осмотра по локальному протоколу.', 'Продолжить непрерывный мониторинг и задокументировать повторную оценку состояния.');
  else if (risk >= threshold * 0.35) actions.push('Запланировать повторный врачебный осмотр и обновить оценку после новых измерений.');
  else actions.push('Продолжить плановое наблюдение по протоколу отделения.');
  if ((f.ph_min ?? 9) < 7.25 || (f.base_excess_min ?? 0) < -8) actions.push('Повторно проверить газовый состав крови и кислотно-основное состояние.');
  if ((f.lactate_max ?? 0) > 4) actions.push('Проверить динамику лактата и сопоставить её с клиническими признаками перфузии.');
  if ((f.glucose_min ?? 99) < 3) actions.push('Повторно измерить глюкозу и оценить динамику по локальному протоколу.');
  if ((f.hr_max ?? 0) > 200) actions.push('Проверить эпизоды тахикардии по исходной записи мониторинга.');
  const missing = BUNDLE_FEATURES.filter((k) => f[k] == null || f[k] === '');
  const top = r.shap.map((s) => ({ feature: s.feature, label: s.label, value: s.value, unit: '', contribution: Math.round(s.shap * 1e5) / 1e5, direction: s.shap >= 0 ? 'raises' : 'lowers' }));
  return { ...bundle, prediction: { model_name: 'neooutcome_xgb', model_version: 'client-surrogate', prediction_window_hours: 24, risk_probability: risk, risk_percent: Math.round(risk * 1000) / 10, operating_threshold: threshold, threshold_crossed: risk >= threshold, risk_band: band, tier: r.risk_tier, top_factors: top.slice(0, 6), shap_values: top, shap_base_probability: r.base_rate_percent / 100, missing_features: missing, caveats: ['12-часовой контракт не содержит SpO₂/FiO₂, режима вентиляции и Апгар — подставлены медианы когорты.'], review_actions: actions.slice(0, 7), disclaimer: bundle.synthetic ? 'Синтетические данные. Исследовательский прототип.' : 'Поддержка решений. Окончательное решение принимает врач.', generated_at: new Date().toISOString() } };
}

export function parseBundleFile(name, text) {
  if (name.toLowerCase().endsWith('.json')) {
    const data = JSON.parse(text);
    return data.features ? data : { ...SYNTHETIC_BUNDLE, synthetic: false, patient: { ...SYNTHETIC_BUNDLE.patient, patient_id: name.replace(/\.json$/i, '').toUpperCase(), full_name: 'Импорт из JSON' }, features: data };
  }
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',').map((s) => s.trim());
  const row = lines[1] ? lines[1].split(',').map((s) => s.trim()) : [];
  let feats = {};
  if (head[0] === 'feature' && head[1] === 'value') lines.slice(1).forEach((l) => { const [k, v] = l.split(','); feats[k.trim()] = parseFloat(v); });
  else head.forEach((k, i) => { feats[k] = row[i] === '' || row[i] == null ? null : (Number.isFinite(parseFloat(row[i])) ? parseFloat(row[i]) : row[i]); });
  const pid = feats.patient_id || name.replace(/\.csv$/i, '').toUpperCase(); delete feats.patient_id;
  const lowered = Object.keys(feats).map((k) => k.toLowerCase());
  const pii = lowered.filter((k) => ['name', 'фио', 'iin', 'иин', 'phone', 'телефон', 'address', 'адрес', 'passport', 'паспорт'].includes(k));
  if (pii.length) throw new Error(`Файл содержит персональные поля: ${pii.join(', ')}. Удалите их перед загрузкой.`);
  return { schema_version: '1.0', synthetic: String(pid).startsWith('SYN'), patient: { patient_id: String(pid), full_name: `Импорт ${pid}`, sex: String(feats.gender) === '1' ? 'M' : 'F', date_of_birth: '' }, encounter: { encounter_id: '—', institution: '—', department: 'ОРИТН', admitted_at: '', prediction_time: '', admission_diagnosis: 'Импорт из CSV' }, features: feats };
}

export const appointmentStore = (() => {
  let items = [];
  return {
    list: async () => [...items].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
    add: async (b) => { const a = { ...b, id: `local-${Date.now()}`, status: 'scheduled', created_at: new Date().toISOString() }; items.push(a); return a; },
    patch: async (id, status) => { items = items.map((a) => (a.id === id ? { ...a, status } : a)); return items.find((a) => a.id === id); },
  };
})();

export const DATASETS_CATALOGUE = {
  datasets: [
    { id: 'ashyq', name: 'AshyqData 2025 · Минздрав РК', kind: 'official', year: 2025, detail: 'Infant & neonatal mortality, hospital beds and nursing staff by region; 2020–2025 trends', url: 'https://data.egov.kz', license: 'Open data of the Republic of Kazakhstan' },
    { id: 'mics_micro', name: 'MICS Kazakhstan 2024 · microdata (bh.sav)', kind: 'official', year: 2024, detail: 'Birth-history recode: weighted NMR/IMR for births in the 60 months before interview', url: 'https://mics.unicef.org/surveys', license: 'UNICEF MICS data-use terms' },
    { id: 'worldpop', name: 'WorldPop · pregnancies 2015 (1 km)', kind: 'official', year: 2015, detail: 'KAZ_pregs_pp_v1_2015.tif summed per admin-1 polygon', url: 'https://dx.doi.org/10.5258/SOTON/WP00612', license: 'CC BY 4.0 — WorldPop (2018)' },
    { id: 'gbd', name: 'IHME GBD 2023 · neonatal preterm birth (Global)', kind: 'official', year: 2023, detail: 'Deaths, DALYs — global benchmark 2015–2023', url: 'https://vizhub.healthdata.org/gbd-results/', license: 'IHME non-commercial user agreement' },
    { id: 'odin', name: 'Open Data Watch · ODIN 2015 Kazakhstan', kind: 'official', year: 2015, detail: 'Openness/coverage scores per statistical category', url: 'https://odin.opendatawatch.com', license: 'CC BY 4.0' },
    { id: 'bns2023', name: 'БНС АСПР РК · Естественное движение населения, 2023', kind: 'official', year: 2023, detail: 'Births 387.9 k, deaths 130.6 k; release 09.02.2024', url: 'https://stat.gov.kz', license: 'Open government data' },
    { id: 'asfendiyarov', name: 'KazNMU n.a. S.D. Asfendiyarov · de-identified NICU extract', kind: 'real', year: 2025, detail: '1 105 admissions 2021–2025, 25 columns; admission model', url: null, license: 'Hackathon use only' },
  ],
  bns_2023: { year: 2023, births: 387900, deaths: 130600, natural_increase: 257400, marriages: 120900, divorces: 16800, highest_birth_rate: { region: 'mangystau', value: 26.78 }, highest_death_rate: { region: 'north', value: 11.08 }, release: '2024-02-09' },
  ashyq_national: { infant_mortality: 5.85, neonatal_mortality: 3.04, hospital_beds: 105789, nursing_staff: 188470, year: 2025 },
  mics_micro_national: { births: 6233, neo_deaths: 20, inf_deaths: 35, nmr: 3.63, imr: 5.99 },
  worldpop_total: 560814,
  gbd: [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023].map((y, i) => ({ measure: 'Deaths', metric: 'Rate', location: 'Global', year: y, val: [11.3, 10.91, 10.45, 9.94, 9.36, 8.89, 8.39, 8.06, 7.73][i], upper: [12.69, 12.23, 11.89, 11.31, 10.81, 10.46, 9.85, 9.45, 9.11][i], lower: [9.99, 9.62, 9.07, 8.53, 7.98, 7.51, 7.03, 6.6, 6.32][i] })),
  odin: [['Population and vital statistics', 30, 20, 25], ['Health facilities', 40, 20, 30], ['Health outcomes', 40, 20, 30], ['Reproductive health', 40, 20, 30], ['Gender statistics', 40, 40, 40], ['Education facilities', 60, 20, 40], ['All categories', 45.7, 17.1, 30.3]].map(([category, coverage, openness, overall]) => ({ category, coverage, openness, overall })),
};
