/**
 * REST client for the FastAPI backend with a transparent offline fallback.
 * `api.online` tells the UI which mode it is in.
 */
import * as mock from '../lib/mock.js';
import * as im from '../lib/intakeMock.js';
import { offlineOverlay } from '../lib/official.js';

const BASE = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'neo.token';
let token = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
let online = null; // null = unknown, true/false after first probe

async function request(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* ignore */ }
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

export async function probe() {
  if (online !== null) return online;
  try { await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2500) }).then((r) => { if (!r.ok) throw new Error(); }); online = true; }
  catch { online = false; }
  return online;
}

export const api = {
  get online() { return online; },
  get token() { return token; },
  setToken(t) { token = t; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } },

  async hospitals() { return (await probe()) ? request('/api/auth/hospitals') : mock.HOSPITALS; },

  async login({ email, password, full_name, role, hospital_id }) {
    if (!(await probe())) {
      const hospital = mock.HOSPITALS.find((h) => h.id === hospital_id) || mock.HOSPITALS[0];
      return { access_token: null, user: { id: 'local', email, full_name, role, hospital } };
    }
    // accounts are issued by the hospital; a wrong password must not fall through to sign-up
    const r = await request('/api/auth/login/json', { method: 'POST', body: { email, password } });
    api.setToken(r.access_token); return r;
  },
  async me() { return request('/api/auth/me'); },
  logout() { api.setToken(null); },

  async patients() { return (await probe()) ? request('/api/patients') : mock.PATIENTS; },
  async vitals(patientId, hours = 24) { return (await probe()) ? request(`/api/patients/${patientId}/vitals?hours=${hours}`) : []; },

  async predict(patientId, overrides = {}, persist = true) {
    if (!(await probe())) return mock.mockPredict(patientId, overrides);
    return request('/api/predictions', { method: 'POST', body: { patient_id: patientId, overrides, persist } });
  },
  async predictions() { return (await probe()) ? request('/api/predictions') : []; },
  async review(predictionId, body) { return request(`/api/predictions/${predictionId}/review`, { method: 'POST', body }); },
  async reviewStats() { return (await probe()) ? request('/api/predictions/stats/review') : null; },

  async cvModels() { return (await probe()) ? request('/api/cv/models') : { gradcam_backend: 'client-canvas' }; },
  async analyzeImage(file, modality, target, alpha = 0.55) {
    const form = new FormData(); form.append('file', file); form.append('modality', modality); if (target != null) form.append('target', String(target)); form.append('alpha', String(alpha));
    return request('/api/cv/imaging/analyze', { method: 'POST', form });
  },

  async benchmarks() { return (await probe()) ? request('/api/integration/benchmarks') : mock.BENCHMARKS; },
  async schema() { return (await probe()) ? request('/api/integration/schema') : mock.SCHEMA; },
  async validateMapping(mapping) {
    if (!(await probe())) { const mapped = Object.values(mapping).filter(Boolean).length; return { mapped, total: 31, coverage: mapped / 31, valid: true, missing: [], duplicate_columns: [], unknown_columns: [] }; }
    return request('/api/integration/schema/validate', { method: 'POST', body: { mapping } });
  },
  async hisStatus() { return (await probe()) ? request('/api/integration/his/status') : null; },
  async hisConnect() { return request('/api/integration/his/connect', { method: 'POST' }); },
  async hisDisconnect() { return request('/api/integration/his/disconnect', { method: 'POST' }); },

  async regions() { if (await probe()) return request('/api/analytics/regions'); return { ...mock.REGIONS, regions: mock.REGIONS.regions.map((r) => ({ ...r, official: offlineOverlay(r.id) })), datasets: im.DATASETS_CATALOGUE.datasets, ashyq_national: im.DATASETS_CATALOGUE.ashyq_national }; },
  async regionTrends() { if (await probe()) return request('/api/analytics/regions/trends'); const { ASHYQ } = await import('../lib/official.js'); return { source_id: 'ashyq', years: [2020, 2021, 2022, 2023, 2024, 2025], national: ASHYQ.national, trends: ASHYQ.trends, regions: ASHYQ.regions }; },
  async datasets() { return (await probe()) ? request('/api/analytics/datasets') : im.DATASETS_CATALOGUE; },
  async milestones() { return (await probe()) ? request('/api/analytics/milestones') : mock.MILESTONES; },

  // Portal 1 extras
  async timeline(patientId) { return (await probe()) ? request(`/api/predictions/timeline/${patientId}`) : mock.mockTimeline(patientId); },
  async tasks() { return (await probe()) ? request('/api/tasks') : mock.taskStore.list(); },
  async addTask(body) { return (await probe()) ? request('/api/tasks', { method: 'POST', body }) : mock.taskStore.add(body); },
  async toggleTask(id, done) { return (await probe()) ? request(`/api/tasks/${id}?done=${done}`, { method: 'PATCH' }) : mock.taskStore.toggle(id, done); },
  async deleteTask(id) { return (await probe()) ? request(`/api/tasks/${id}`, { method: 'DELETE' }) : mock.taskStore.remove(id); },

  // Portal 2 extras
  async audit(params = '') { return (await probe()) ? request(`/api/analytics/audit${params}`) : mock.AUDIT; },
  async modelQuality() { return (await probe()) ? request('/api/analytics/model-quality') : mock.QUALITY; },
  async economics(body) { return (await probe()) ? request('/api/analytics/economics', { method: 'POST', body }) : mock.mockEconomics(body); },

  // MLOps
  async provenance() { return (await probe()) ? request('/api/ml/provenance') : mock.PROVENANCE; },
  async mlStatus() { return (await probe()) ? request('/api/ml/status') : mock.mlops.status(); },
  async mlVersions() { return (await probe()) ? request('/api/ml/versions') : mock.mlops.versions(); },
  async mlDatasets() { return (await probe()) ? request('/api/ml/datasets') : mock.mlops.datasets(); },
  async retrain(body) { return (await probe()) ? request('/api/ml/retrain', { method: 'POST', body }) : mock.mlops.retrain(body); },
  async rollback(version, reason) { return (await probe()) ? request('/api/ml/rollback', { method: 'POST', body: { version, reason } }) : mock.mlops.rollback(version); },
  async uploadDataset(file, retrain = true) {
    if (!(await probe())) return mock.mlops.upload(file, retrain);
    const form = new FormData(); form.append('file', file);
    return request(`/api/ml/datasets/upload?retrain_now=${retrain}`, { method: 'POST', form });
  },

  // Intake (ported from the initial repository): admission model, bundle import, PDF card, appointments
  async admissionInfo() { return (await probe()) ? request('/api/predictions/admission/info') : im.ADMISSION_INFO; },
  async predictAdmission(features, patientId = null, persist = false) { return (await probe()) ? request('/api/predictions/admission', { method: 'POST', body: { features, patient_id: patientId, persist } }) : im.mockAdmission(features); },
  async intakeDemo() { return (await probe()) ? request('/api/intake/demo') : im.mockScoreBundle(im.SYNTHETIC_BUNDLE); },
  async intakeImport(file) {
    if (!(await probe())) return im.mockScoreBundle(im.parseBundleFile(file.name, await file.text()));
    const form = new FormData(); form.append('file', file);
    return request('/api/intake/import', { method: 'POST', form });
  },
  async intakeScore(bundle) { return (await probe()) ? request('/api/intake/score', { method: 'POST', body: { bundle } }) : im.mockScoreBundle(bundle); },
  /** Returns an object URL of the PDF card (null when offline). */
  async cardPdfUrl(bundle) {
    if (!(await probe())) return null;
    const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/api/intake/card.pdf`, { method: 'POST', headers, body: JSON.stringify({ bundle }) });
    if (!res.ok) throw new Error('PDF generation failed');
    return URL.createObjectURL(await res.blob());
  },
  async patientCardUrl(patientId) {
    if (!(await probe())) return null;
    const headers = {}; if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${BASE}/api/intake/patients/${patientId}/card.pdf`, { headers });
    if (!res.ok) throw new Error('PDF generation failed');
    return URL.createObjectURL(await res.blob());
  },
  async appointments(patientRef) { return (await probe()) ? request(`/api/intake/appointments${patientRef ? `?patient_ref=${encodeURIComponent(patientRef)}` : ''}`) : im.appointmentStore.list(); },
  async addAppointment(body) { return (await probe()) ? request('/api/intake/appointments', { method: 'POST', body }) : im.appointmentStore.add(body); },
  async patchAppointment(id, status) { return (await probe()) ? request(`/api/intake/appointments/${id}`, { method: 'PATCH', body: { status } }) : im.appointmentStore.patch(id, status); },

  // Portal 3
  async maternal() { return (await probe()) ? request('/api/maternal/me') : mock.maternalStore.get(); },
  async saveMaternal(body) { return (await probe()) ? request('/api/maternal/me', { method: 'PUT', body }) : mock.maternalStore.save(body); },
  async maternalScreen(body) { return (await probe()) ? request('/api/maternal/screen', { method: 'POST', body }) : mock.maternalScore(body); },
  async baby() { return (await probe()) ? request('/api/maternal/baby') : mock.BABY_LOG; },
  async babySummary() { return (await probe()) ? request('/api/maternal/baby/summary') : mock.BABY_SUMMARY; },
  // postpartum self-check; offline it lives only in this tab's memory
  async checkins() { return (await probe()) ? request('/api/maternal/checkins') : [...offlineCheckins]; },
  async addCheckin(body) {
    if (await probe()) return request('/api/maternal/checkins', { method: 'POST', body });
    const c = { id: `local-${Date.now()}`, ...body, created_at: new Date().toISOString(), urgent: body.flags.length > 0 };
    offlineCheckins.unshift(c); return c;
  },
};
const offlineCheckins = [];
