/**
 * Client-side surrogate of the XGBoost 24h model, used for the live slider
 * estimate between server calls. The committed prediction always comes from
 * POST /api/predictions (real XGBoost + SHAP).
 */
export const BASE_LOGIT = -2.2;
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

export function contributions(p) {
  const sf = p.spo2 / (p.fio2 / 100);
  return [
    { key: 'FiO2', label: 'FiO2 (%)', value: p.fio2, c: ((p.fio2 - 21) / 79) * 2.2 },
    { key: 'S/F', label: 'SpO2/FiO2 ratio', value: Math.round(sf), c: ((264 - Math.min(sf, 470)) / 264) * 1.9 },
    { key: 'Lactate', label: 'Lactate (mmol/L)', value: p.lactate, c: ((p.lactate - 2.0) / 4) * 1.6 },
    { key: 'BE', label: 'Base excess', value: p.base_excess, c: ((-4 - p.base_excess) / 8) * 1.2 },
    { key: 'HR', label: 'Heart rate (bpm)', value: p.heart_rate, c: ((p.heart_rate - 150) / 30) * 0.9 },
    { key: 'GA', label: 'Gestational age (wk)', value: p.gestational_age_wk, c: ((32 - p.gestational_age_wk) / 6) * 1.1 },
    { key: 'Weight', label: 'Birth weight (g)', value: p.birth_weight_g, c: ((1500 - p.birth_weight_g) / 700) * 0.6 },
    { key: 'APGAR', label: 'APGAR 5 min', value: p.apgar_5, c: ((7 - p.apgar_5) / 3) * 0.7 },
    { key: 'Temp', label: 'Temperature (°C)', value: p.temperature, c: ((36.5 - p.temperature) / 0.8) * 0.5 },
  ];
}

export function scoreRisk(p) {
  const cs = contributions(p);
  const prob = sigmoid(BASE_LOGIT + cs.reduce((a, b) => a + b.c, 0));
  const base = sigmoid(BASE_LOGIT);
  const delta = (prob - base) * 100;
  const sumSigned = cs.reduce((a, b) => a + b.c, 0) || 1e-6;
  const shap = cs.map((x) => ({ feature: x.key, label: x.label, value: x.value, shap: x.c, pp: (x.c / sumSigned) * delta })).sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));
  const pct = Math.round(prob * 100);
  return { risk_probability: prob, risk_percent: pct, base_rate_percent: Math.round(base * 100), shap, risk_tier: tier(pct), recommendations: RECOMMENDATIONS[tier(pct)], model_version: 'client-surrogate' };
}

export const tier = (pct) => (pct >= 75 ? 'critical' : pct >= 50 ? 'high' : pct >= 25 ? 'moderate' : 'low');
export const TIER_LABEL = { low: 'Low', moderate: 'Moderate', high: 'High', critical: 'Critical' };
export const TIER_COLOR = { low: '#00A896', moderate: '#D97706', high: '#C2410C', critical: '#D9381E' };
export const RECOMMENDATIONS = {
  low: ['Routine monitoring', 'Reassess vitals in 4 h'],
  moderate: ['Repeat blood gas in 2 h', 'Notify attending neonatologist'],
  high: ['Senior review within 30 min', 'Prepare respiratory escalation'],
  critical: ['Immediate bedside review', 'Sepsis bundle · consider intubation'],
};

export function seeded(seed) { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
