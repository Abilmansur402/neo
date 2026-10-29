import { useEffect, useState } from 'react';
import { LogoMark } from './Logo.jsx';
import { Stethoscope, BarChart3, HeartHandshake, Building2, Check, Lock, ArrowRight, X } from 'lucide-react';
import { api } from '../services/api.js';
import { useT } from '../lib/i18n.jsx';

export const ROLES = [
  { id: 'neonatologist', Icon: Stethoscope, color: '#0E9F9B', email: 'neonatologist@neooutcome.kz', name: 'Dr. Aigerim Nurlanova' },
  { id: 'analyst', Icon: BarChart3, color: '#16A34A', email: 'analyst@neooutcome.kz', name: 'Daniyar Akhmetov' },
  { id: 'mother', Icon: HeartHandshake, color: '#52708A', email: 'mother@neooutcome.kz', name: 'Aizhan Serikova' },
  { id: 'admin', Icon: Building2, color: '#F59E0B', email: 'admin@neooutcome.kz', name: 'Gulnara Bekova' },
];

/** Multi-role onboarding modal. Each role maps to a seeded demo account and its own portal. */
export default function AuthModal({ onEnter, onClose, preset }) {
  const { t } = useT();
  const [hospitals, setHospitals] = useState([]);
  const [role, setRole] = useState(preset || 'neonatologist');
  const [hospital, setHospital] = useState('astana-nrc');
  const [name, setName] = useState(ROLES.find((r) => r.id === (preset || 'neonatologist')).name);
  const [password, setPassword] = useState('Pilot2026!');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [online, setOnline] = useState(null);

  useEffect(() => { api.hospitals().then((h) => { setHospitals(h); setOnline(api.online); }).catch(() => setOnline(false)); }, []);
  useEffect(() => { const onKey = (e) => e.key === 'Escape' && onClose?.(); window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  const ready = name.trim().length > 1 && password.length >= 8;
  const h = hospitals.find((x) => x.id === hospital);

  const submit = async (e) => {
    e.preventDefault(); if (!ready) return;
    setBusy(true); setError('');
    try { const r = await api.login({ email: ROLES.find((x) => x.id === role).email, password, full_name: name, role, hospital_id: hospital }); onEnter({ ...r.user, full_name: r.user.full_name || name }); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(15,23,42,.5)', backdropFilter: 'blur(6px)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form className="card-pop w-full max-w-lg max-h-[92vh] overflow-auto p-6 md:p-8 pop-in" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <div className="flex-1"><div className="eyebrow">NeoOutcome AI</div><h2 id="auth-title" className="text-2xl font-semibold leading-tight">{t('auth.title')}</h2></div>
          {online !== null && <span className={`badge ${online ? 'badge-low' : 'badge-moderate'}`}>{online ? 'API' : t('offline')}</span>}
          {onClose && <button type="button" className="btn btn-ghost px-2" aria-label={t('cancel')} onClick={onClose}><X size={18} /></button>}
        </div>
        <div className="grid gap-2 mt-5">{ROLES.map((r) => (
          <button type="button" key={r.id} className={`tile ${role === r.id ? 'selected' : ''}`} onClick={() => { setRole(r.id); setName(r.name); }} aria-pressed={role === r.id}>
            <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-md grid place-items-center text-white shrink-0" style={{ background: r.color }}><r.Icon size={18} /></div><div className="min-w-0 flex-1"><div className="font-semibold">{t(`role.${r.id}`)}</div><div className="muted text-xs">{t(`role.${r.id}.desc`)}</div></div>{role === r.id && <Check size={18} className="text-primary shrink-0" />}</div>
          </button>))}</div>
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          <div><label className="eyebrow block mb-1" htmlFor="name">{t('auth.name')}</label><input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="eyebrow block mb-1" htmlFor="password">{t('auth.password')}</label><input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></div>
        </div>
        <label className="eyebrow block mt-4 mb-1" htmlFor="hospital">{t('auth.hospital')}</label>
        <select id="hospital" value={hospital} onChange={(e) => setHospital(e.target.value)}>{hospitals.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.city}</option>)}</select>
        {h && <div className="muted text-xs mt-1">{h.name_kz} · HIS {h.his_vendor} · Level {h.care_level}</div>}
        {error && <div className="mt-3 text-sm font-semibold text-coral">{error}</div>}
        <button type="submit" className="btn btn-primary w-full justify-center mt-5 text-base py-3" disabled={!ready || busy}><Lock size={16} /> {busy ? '…' : t('auth.enter')} <ArrowRight size={16} /></button>
        <p className="muted text-xs mt-3">Demo accounts are seeded by the backend (password <span className="mono">Pilot2026!</span>). No real patient data is loaded.</p>
      </form>
    </div>
  );
}
