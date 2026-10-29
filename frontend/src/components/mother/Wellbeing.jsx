import { useEffect, useState } from 'react';
import { HeartPulse, AlertTriangle, Phone, NotebookPen, ExternalLink, BookOpen } from 'lucide-react';
import { Card, Badge } from '../../lib/ui.jsx';
import { useT } from '../../lib/i18n.jsx';
import { api } from '../../services/api.js';
import { DANGER_SIGNS, MOODS, PARENT_MATERIALS, TOPICS, topicLabel } from '../../lib/maternalCare.js';

const LOCALE = { en: 'en-GB', ru: 'ru-RU', kz: 'kk-KZ' };
const when = (d, lang) => new Date(d).toLocaleString(LOCALE[lang] || 'ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function EmergencyBanner() {
  const { t } = useT();
  return (
    <div className="rounded-lg p-4 flex items-start gap-3 text-white" style={{ background: 'var(--color-coral)' }} role="alert">
      <Phone size={20} className="shrink-0 mt-0.5" />
      <div><div className="font-semibold text-base">{t('mom.call')}</div><div className="text-sm mt-1 opacity-95">{t('mom.call.text')}</div></div>
    </div>
  );
}

/** Mother's private postpartum check-in: mood + WHO danger signs; any sign shows the ambulance banner at once. */
export function Wellbeing() {
  const { t, lang } = useT();
  const L = (o) => o?.[lang] || o?.ru;
  const [history, setHistory] = useState([]);
  const [mood, setMood] = useState(null);
  const [flags, setFlags] = useState([]);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.checkins().then(setHistory).catch(() => {}); }, []);
  const toggle = (k) => setFlags((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));
  const submit = async (e) => {
    e.preventDefault(); if (!mood) return; setError('');
    try { const c = await api.addCheckin({ mood, flags, note }); setSaved(c); setHistory((h) => [c, ...h]); setMood(null); setFlags([]); setNote(''); } catch (err) { setError(err.message); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title={<span className="flex items-center gap-2"><HeartPulse size={16} />{t('mom.howfeel')}</span>} sub={t('mom.private')}>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-5 gap-2">{MOODS.map(([v, emoji, label]) => (
            <button type="button" key={v} onClick={() => setMood(v)} aria-pressed={mood === v} className={`tile py-2.5 grid place-items-center gap-1 ${mood === v ? 'selected' : ''}`}>
              <span className="text-2xl leading-none">{emoji}</span><span className="text-xs">{L(label)}</span>
            </button>))}</div>
          <div>
            <div className="text-sm font-medium flex items-center gap-2 mb-2"><AlertTriangle size={15} style={{ color: 'var(--color-amber)' }} />{t('mom.signs')}</div>
            <div className="grid gap-1">{DANGER_SIGNS.map(([k, label]) => (
              <label key={k} className="flex items-start gap-2.5 text-sm py-1.5 border-b border-line cursor-pointer"><input type="checkbox" checked={flags.includes(k)} onChange={() => toggle(k)} className="mt-0.5" />{L(label)}</label>))}</div>
          </div>
          {flags.length > 0 && <EmergencyBanner />}
          <textarea className="input min-h-[64px]" placeholder={t('mom.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <button type="submit" className="btn btn-primary justify-center" disabled={!mood}>{t('mom.save')}</button>
          {error && <div className="text-sm font-semibold" style={{ color: 'var(--color-coral)' }}>{error}</div>}
          {saved && !saved.urgent && <div className="text-sm" style={{ color: 'var(--color-teal)' }}>{t('mom.saved')}</div>}
          <p className="muted text-xs">{t('mom.who')}</p>
        </form>
      </Card>
      <Card title={<span className="flex items-center gap-2"><NotebookPen size={16} />{t('mom.journal')}</span>} sub={t('mom.journal.sub')} className="self-start">
        {!history.length && <div className="muted text-sm">{t('mom.nojournal')}</div>}
        <div className="grid gap-2">{history.map((c) => { const m = MOODS[c.mood - 1]; return (
          <div key={c.id} className="flex items-start gap-3 border-b border-line pb-2 last:border-b-0">
            <span className="text-2xl leading-none">{m[1]}</span>
            <div className="min-w-0"><div className="text-sm font-medium flex flex-wrap items-center gap-1.5">{L(m[2])}{c.urgent && <Badge tone="critical">{t('mom.flagged')}</Badge>}</div>
              <div className="muted text-xs">{when(c.created_at, lang)}</div>{c.note && <div className="text-sm mt-0.5">{c.note}</div>}</div>
          </div>); })}</div>
      </Card>
    </div>
  );
}

/** Parent reading list: official WHO pages only, filterable by topic. */
export function Materials() {
  const { t, lang } = useT();
  const [topic, setTopic] = useState('all');
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">{[['all', null], ...TOPICS].map(([k]) => <button type="button" key={k} className={`btn text-xs py-1.5 ${topic === k ? 'btn-dark' : ''}`} onClick={() => setTopic(k)}>{k === 'all' ? t('mom.all') : topicLabel(k, lang)}</button>)}</div>
      <div className="grid md:grid-cols-2 gap-4">{PARENT_MATERIALS.filter((m) => topic === 'all' || m.topic === topic).map((m) => (
        <a key={m.url} href={m.url} target="_blank" rel="noopener noreferrer" className="card p-5 grid gap-2 content-start transition-shadow hover:shadow-md">
          <div className="flex flex-wrap items-center gap-2"><Badge tone="primary">{topicLabel(m.topic, lang)}</Badge><Badge tone={m.lang === 'RU' ? 'low' : 'muted'}>{m.lang === 'RU' ? t('mom.inRu') : t('mom.inEn')}</Badge></div>
          <div className="font-semibold leading-snug">{m.title}</div>
          <div className="text-sm muted">{m.summary[lang] || m.summary.ru}</div>
          <div className="text-xs font-medium flex items-center gap-1 mt-1 text-primary"><BookOpen size={12} />{m.source}<ExternalLink size={12} /></div>
        </a>))}</div>
      <p className="muted text-xs">{t('mom.mat.note')}</p>
    </div>
  );
}
