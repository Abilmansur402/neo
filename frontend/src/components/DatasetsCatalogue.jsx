import { useEffect, useState } from 'react';
import { Database, ExternalLink, Globe2, ScrollText } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { Card, Badge, Stat } from '../lib/ui.jsx';
import { useT } from '../lib/i18n.jsx';
import { api } from '../services/api.js';
import { OriginPill } from './DataOrigin.jsx';

const KIND = { official: 'official', real: 'real', synthetic: 'synthetic' };

/** Catalogue of every dataset bundled with the platform: what it is, where it came from, how it is used. */
export default function DatasetsCatalogue() {
  const { t, lang } = useT();
  const [cat, setCat] = useState(null); const [mics, setMics] = useState(null);
  useEffect(() => { api.datasets().then(setCat); api.regions().then((d) => setMics(d.regions)); }, []);
  if (!cat) return <div className="muted text-sm">{t('loading')}</div>;
  const gbdRate = cat.gbd.filter((r) => r.measure === 'Deaths' && r.metric === 'Rate');
  const gbdNumber = cat.gbd.filter((r) => r.measure === 'Deaths' && r.metric === 'Number');
  const b = cat.bns_2023; const n = cat.ashyq_national; const mn = cat.mics_micro_national;
  const name = (r) => r[lang] || r.ru || r.en;
  return (
    <div className="grid gap-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`${t('ds.births')} · 2023`} value={(b.births / 1000).toFixed(1) + ' k'} unit={`БНС АСПР РК · ${t('ds.release')} ${b.release}`} tone="#0E9F9B" />
        <Stat label={`${t('an.nmr')} · 2025`} value={`${n.neonatal_mortality} ‰`} unit={`AshyqData · ${t('ds.infant')} ${n.infant_mortality} ‰`} tone="#B45309" />
        <Stat label={`MICS 2024 · ${t('ds.microdata')}`} value={`${mn.nmr} ‰`} unit={`${mn.neo_deaths} ${t('reg.events')} / ${mn.births.toLocaleString('ru-RU')} ${t('ds.birthsWord')} · ${t('ds.weighted')}`} tone="#15803D" />
        <Stat label={`WorldPop · ${t('reg.pregnancies')} 2015`} value={cat.worldpop_total.toLocaleString('ru-RU')} unit="1 km raster · DOI 10.5258/SOTON/WP00612" />
      </section>

      <Card title={<span className="flex items-center gap-2"><Database size={16} />{t('ds.title')}</span>} sub={t('ds.sub')}>
        <div className="overflow-x-auto"><table className="table"><thead><tr><th>{t('ds.dataset')}</th><th>{t('ds.kind')}</th><th>{t('ds.year')}</th><th>{t('ds.what')}</th><th>{t('ds.license')}</th><th></th></tr></thead>
          <tbody>{cat.datasets.map((d) => <tr key={d.id}><td className="font-medium whitespace-nowrap">{d.name}</td><td><OriginPill kind={KIND[d.kind] || 'estimate'}>{d.kind}</OriginPill></td><td className="mono text-xs">{d.year}</td><td className="text-xs">{d.detail}</td><td className="text-xs muted">{d.license}</td><td>{d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs"><ExternalLink size={12} />{t('ds.open')}</a>}</td></tr>)}</tbody></table></div>
        <p className="muted text-xs mt-3">{t('ds.rule')}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Globe2 size={16} />IHME GBD 2023 · {t('ds.gbd')}</span>} sub={t('ds.gbdSub')} right={<OriginPill kind="official">Global</OriginPill>}>
          <div className="h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={gbdRate.map((r, i) => ({ ...r, number: gbdNumber[i]?.val }))} margin={{ left: -14, right: 8, top: 8, bottom: 0 }}><defs><linearGradient id="gbd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#52708A" stopOpacity={.35} /><stop offset="100%" stopColor="#52708A" stopOpacity={.02} /></linearGradient></defs><CartesianGrid vertical={false} /><XAxis dataKey="year" /><YAxis domain={[0, 14]} /><Tooltip formatter={(v, k, { payload }) => (k === 'upper' ? [`${payload.lower.toFixed(1)}–${v.toFixed(1)}`, '95% UI'] : [`${v.toFixed(2)} / 100k`, 'Death rate'])} /><Area dataKey="upper" stroke="none" fill="#B8D0D8" fillOpacity={.35} isAnimationActive={false} /><Area dataKey="lower" stroke="none" fill="#fff" fillOpacity={1} isAnimationActive={false} /><Area dataKey="val" stroke="#52708A" fill="url(#gbd)" strokeWidth={2} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
          <div className="muted text-xs mt-2">{t('ds.gbdNote')} · {gbdNumber.at(-1) ? `${Math.round(gbdNumber.at(-1).val / 1000)} k ${t('ds.deathsIn')} ${gbdNumber.at(-1).year}` : ''}</div>
        </Card>
        <Card title={<span className="flex items-center gap-2"><ScrollText size={16} />ODIN 2015 · Open Data Watch</span>} sub={t('ds.odinSub')} right={<OriginPill kind="official">CC BY 4.0</OriginPill>}>
          <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={cat.odin.filter((r) => /vital|health|reproductive|gender|all/i.test(r.category))} layout="vertical" margin={{ left: 10, right: 16, top: 0, bottom: 0 }}><XAxis type="number" domain={[0, 100]} hide /><YAxis type="category" dataKey="category" width={150} tick={{ fontSize: 10 }} /><Tooltip formatter={(v, k) => [v, k]} /><Bar dataKey="coverage" name="Coverage" fill="#0E9F9B" radius={[0, 3, 3, 0]} /><Bar dataKey="openness" name="Openness" fill="#16A34A" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>
          <div className="muted text-xs mt-2">{t('ds.odinNote')}</div>
        </Card>
      </div>

      <Card title={`MICS 2024 · ${t('ds.microTitle')}`} sub={t('ds.microSub')} right={<Badge tone="moderate">{t('ds.smallN')}</Badge>}>
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={(mics || []).filter((r) => r.official?.mics_micro).map((r) => ({ id: r.id, name: name(r), nmr: r.official.mics_micro.nmr, births: r.official.mics_micro.births, deaths: r.official.mics_micro.neo_deaths, reliable: r.official.mics_micro.reliable })).sort((a, b) => b.nmr - a.nmr)} margin={{ left: -14, right: 8, top: 8, bottom: 40 }}><CartesianGrid vertical={false} /><XAxis dataKey="name" interval={0} angle={-35} textAnchor="end" tick={{ fontSize: 10 }} /><YAxis /><Tooltip formatter={(v, k, { payload }) => [`${v} ‰ (${payload.deaths} / ${payload.births})`, 'NMR · weighted']} /><Bar dataKey="nmr" radius={[3, 3, 0, 0]}>{(mics || []).filter((r) => r.official?.mics_micro).sort((a, b) => b.official.mics_micro.nmr - a.official.mics_micro.nmr).map((r) => <Cell key={r.id} fill={r.official.mics_micro.reliable ? '#0E9F9B' : '#B8D0D8'} />)}</Bar></BarChart></ResponsiveContainer></div>
        <p className="muted text-xs mt-2">{t('ds.microNote')}</p>
      </Card>
    </div>
  );
}
