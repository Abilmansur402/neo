import { useEffect, useState } from 'react';
import { Database, Stethoscope, Building2, Plug, Globe } from 'lucide-react';
import { Card, Badge, Gauge } from '../lib/ui.jsx';
import { api } from '../services/api.js';

const ICONS = { data: Database, spec: Stethoscope, pilot: Building2, his: Plug, open: Globe };
const KEY = 'neo.milestones';

export default function PilotChecklistTab() {
  const [vectors, setVectors] = useState([]); const [state, setState] = useState({});
  useEffect(() => {
    api.milestones().then((m) => {
      setVectors(m);
      let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
      setState(saved || Object.fromEntries(m.map((v) => [v.id, v.items.map((i) => i[1])])));
    });
  }, []);
  const toggle = (vid, i) => setState((s) => { const next = { ...s, [vid]: s[vid].map((x, j) => (j === i ? !x : x)) }; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  if (!vectors.length) return <div className="muted text-sm">Loading milestones…</div>;
  const total = vectors.reduce((a, v) => a + v.items.length, 0); const done = Object.values(state).reduce((a, arr) => a + arr.filter(Boolean).length, 0); const pct = Math.round((done / total) * 100);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card title="Pilot readiness" sub="MVP → hospital shadow-mode pilot" className="lg:sticky lg:top-20 self-start">
        <Gauge pct={pct} color="#0E9F9B" label={`${pct}%`} sub={`${done} of ${total} milestones`} full />
        <div className="grid gap-2 mt-2">{vectors.map((v) => { const d = (state[v.id] || []).filter(Boolean).length; return <div key={v.id}><div className="flex justify-between text-xs"><span>{v.title}</span><span className="mono muted">{d}/{v.items.length}</span></div><div className="meter mt-1"><span style={{ width: `${(d / v.items.length) * 100}%`, background: d === v.items.length ? '#16A34A' : '#0E9F9B' }} /></div></div>; })}</div>
        <div className="mt-4 text-xs muted">Target: shadow-mode go-live Q1 2027 at Astana NRC; Almaty and Shymkent follow after recalibration sign-off.</div>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">{vectors.map((v, idx) => { const Icon = ICONS[v.id] || Globe; const d = (state[v.id] || []).filter(Boolean).length; const full = d === v.items.length; return (
        <Card key={v.id} title={<span className="flex items-center gap-2"><span className="mono muted text-xs">0{idx + 1}</span><Icon size={16} />{v.title}</span>} right={<Badge tone={full ? 'low' : d > 0 ? 'moderate' : 'high'}>{full ? 'ready' : d > 0 ? 'in progress' : 'blocked'}</Badge>}>
          <ul className="grid gap-2">{v.items.map(([label], i) => <li key={label}><label className="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" id={`${v.id}-${i}`} checked={!!state[v.id]?.[i]} onChange={() => toggle(v.id, i)} className="mt-0.5" /><span className={state[v.id]?.[i] ? 'muted line-through' : ''}>{label}</span></label></li>)}</ul>
        </Card>); })}</div>
    </div>
  );
}
