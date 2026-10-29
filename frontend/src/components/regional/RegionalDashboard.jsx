import { useEffect, useMemo, useState } from 'react';
import { Baby, HeartPulse, BedDouble, UsersRound, Check, ChevronDown, Table as TableIcon, MapPinned, ArrowUpDown, Globe } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { Card, Badge, Stat } from '../../lib/ui.jsx';
import { useT } from '../../lib/i18n.jsx';
import { api } from '../../services/api.js';
import { METRICS, YEARS, formatMetric, metricValue, isCapacityMetric } from '../../lib/official.js';
import { OriginPill } from '../DataOrigin.jsx';
import KazakhstanChoropleth from './KazakhstanChoropleth.jsx';

const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const sum = (xs) => xs.filter((x) => x != null).reduce((a, b) => a + b, 0);

/* ---------- Region multi-select (ported) ---------- */
function RegionMultiSelect({ options, selected, onChange, name }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="relative">
      <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{selected.length ? `${t('reg.regions')}: ${selected.length}` : t('reg.allRegions')}<ChevronDown size={14} /></button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 max-h-80 overflow-auto card-pop p-2">
          <div className="flex gap-2 px-1 pb-2 border-b border-line mb-1"><button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onChange([])}>{t('reg.reset')}</button><button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onChange(options.map((o) => o.id))}>{t('reg.selectAll')}</button></div>
          {options.map((o) => <label key={o.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-cream cursor-pointer text-sm"><span className={`w-4 h-4 rounded border grid place-items-center ${selected.includes(o.id) ? 'bg-primary border-primary text-white' : 'border-line-strong'}`}>{selected.includes(o.id) && <Check size={11} />}</span><input type="checkbox" className="sr-only" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />{name(o)}</label>)}
        </div>
      )}
    </div>
  );
}

/* ---------- Year range picker (ported DateRangePicker, years 2020–2025) ---------- */
function YearRange({ from, to, onChange }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="muted">{t('reg.period')}</span>
      <select className="w-auto py-1.5" value={from} onChange={(e) => onChange([+e.target.value, Math.max(+e.target.value, to)])}>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
      <span className="muted">—</span>
      <select className="w-auto py-1.5" value={to} onChange={(e) => onChange([Math.min(from, +e.target.value), +e.target.value])}>{YEARS.map((y) => <option key={y} value={y}>{y}</option>)}</select>
    </div>
  );
}

/* ---------- Sortable region table (ported) ---------- */
function RegionTable({ regions, selected, onSelect, name, lang }) {
  const [sort, setSort] = useState({ key: 'infant_mortality', dir: -1 });
  const cols = METRICS.filter((m) => m.source === 'ashyq').concat(METRICS.filter((m) => m.key === 'nmr' || m.key === 'pregnancies'));
  const rows = useMemo(() => [...regions].sort((a, b) => { const va = metricValue(a, sort.key), vb = metricValue(b, sort.key); if (va == null) return 1; if (vb == null) return -1; return (va - vb) * sort.dir; }), [regions, sort]);
  const th = (m) => <th key={m.key} className="cursor-pointer select-none whitespace-nowrap" onClick={() => setSort((s) => ({ key: m.key, dir: s.key === m.key ? -s.dir : -1 }))}><span className="inline-flex items-center gap-1">{m.label[lang] || m.label.ru}<ArrowUpDown size={11} className={sort.key === m.key ? 'text-primary' : 'opacity-40'} /></span></th>;
  return (
    <div className="overflow-x-auto"><table className="table"><thead><tr><th>#</th><th>{lang === 'en' ? 'Region' : lang === 'kz' ? 'Өңір' : 'Регион'}</th>{cols.map(th)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id} className={`cursor-pointer ${selected === r.id ? 'bg-primary-soft' : 'hover:bg-cream'}`} onClick={() => onSelect(r.id)}><td className="mono text-xs muted">{i + 1}</td><td className="font-medium whitespace-nowrap">{name(r)}{r.growth && <span className="ml-2 origin origin-synthetic" style={{ padding: '0 6px' }}>рост</span>}</td>{cols.map((m) => { const v = metricValue(r, m.key); return <td key={m.key} className="mono text-xs text-right whitespace-nowrap">{v == null ? <span className="muted">—</span> : formatMetric(v, m.key, lang)}</td>; })}</tr>)}</tbody></table></div>
  );
}

/* ---------- Trend chart (ported RegionalTrendChart, multi-region) ---------- */
const LINE_COLORS = ['#0E9F9B', '#16A34A', '#F59E0B', '#E5484D', '#52708A', '#7C6CF6'];
function TrendChart({ trends, ids, name, byId, range, metricKey, national, compare }) {
  const { lang } = useT();
  const data = YEARS.filter((y) => y >= range[0] && y <= range[1]).map((y) => { const row = { year: String(y) }; ids.forEach((id) => { row[id] = trends[id]?.find((p) => p.year === y)?.[metricKey] ?? null; }); return row; });
  return (
    <div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ left: -10, right: 12, top: 10, bottom: 0 }}><CartesianGrid vertical={false} /><XAxis dataKey="year" /><YAxis domain={[0, 'auto']} /><Tooltip formatter={(v, n) => [v == null ? '—' : `${v} ‰`, name(byId[n]) || n]} /><Legend formatter={(id) => name(byId[id]) || id} />
      {compare && national != null && <ReferenceLine y={national} stroke="#52708A" strokeDasharray="5 5" label={{ value: `${lang === 'en' ? 'Kazakhstan' : 'РК'} 2025: ${national} ‰`, fill: '#52708A', fontSize: 10, position: 'insideTopRight' }} />}
      {ids.map((id, i) => <Line key={id} dataKey={id} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={i === 0 ? 2.5 : 1.8} dot={{ r: 3 }} connectNulls isAnimationActive={false} />)}
    </LineChart></ResponsiveContainer></div>
  );
}

/* ---------- Page ---------- */
export default function RegionalDashboard({ initialTab = 'map' }) {
  const { t, lang } = useT();
  const [data, setData] = useState(null); const [trends, setTrends] = useState(null);
  const [metric, setMetric] = useState('infant_mortality'); const [filter, setFilter] = useState([]); const [sel, setSel] = useState('kyzylorda');
  const [tab, setTab] = useState(initialTab); const [raster, setRaster] = useState(false); const [range, setRange] = useState([2020, 2025]); const [compare, setCompare] = useState(true); const [trendMetric, setTrendMetric] = useState('infant_mortality');
  useEffect(() => { api.regions().then(setData); api.regionTrends().then(setTrends); }, []);
  const name = (r) => (r ? r[lang] || r.ru || r.en : '');
  if (!data || !trends) return <div className="muted text-sm">{t('loading')}</div>;
  const all = data.regions; const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const visible = filter.length ? all.filter((r) => filter.includes(r.id)) : all;
  const selected = byId[sel] || visible[0];
  const nat = data.ashyq_national || trends.national;
  const def = METRICS.find((m) => m.key === metric);
  const top = [...visible].filter((r) => metricValue(r, metric) != null).sort((a, b) => metricValue(b, metric) - metricValue(a, metric)).slice(0, 5);
  const hotspots = visible.filter((r) => (metricValue(r, 'infant_mortality') ?? 0) > nat.infant_mortality).length;
  const trendIds = [sel, ...filter.filter((id) => id !== sel)].slice(0, 6);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <RegionMultiSelect options={all} selected={filter} onChange={setFilter} name={name} />
        <select className="w-auto" value={metric} onChange={(e) => setMetric(e.target.value)}>{METRICS.map((m) => <option key={m.key} value={m.key}>{m.label[lang] || m.label.ru}</option>)}</select>
        <OriginPill kind={def.origin}>{def.note}</OriginPill>
        <label className="ml-auto flex items-center gap-2 text-xs cursor-pointer select-none"><input type="checkbox" checked={raster} onChange={(e) => setRaster(e.target.checked)} />{t('reg.rasterLayer')}</label>
        <span className="flex border border-line-strong rounded-md overflow-hidden">{[['map', t('reg.map'), MapPinned], ['table', t('reg.table'), TableIcon]].map(([k, l, I]) => <button key={k} type="button" className={`btn border-0 rounded-none ${tab === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}><I size={14} />{l}</button>)}</span>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={<span className="inline-flex items-center gap-1.5"><Baby size={13} />{t('reg.infantAvg')}</span>} value={`${avg(visible.map((r) => metricValue(r, 'infant_mortality')))?.toFixed(2)} ‰`} unit={`${t('reg.national')}: ${nat.infant_mortality.toFixed(2)} ‰ · AshyqData 2025`} tone="#C62828" />
        <Stat label={<span className="inline-flex items-center gap-1.5"><HeartPulse size={13} />{t('reg.neonatalAvg')}</span>} value={`${avg(visible.map((r) => metricValue(r, 'neonatal_mortality')))?.toFixed(2)} ‰`} unit={`${t('reg.national')}: ${nat.neonatal_mortality.toFixed(2)} ‰`} tone="#B45309" />
        <Stat label={<span className="inline-flex items-center gap-1.5"><BedDouble size={13} />{t('reg.beds')}</span>} value={sum(visible.map((r) => metricValue(r, 'hospital_beds'))).toLocaleString('ru-RU')} unit={t('reg.inSelected')} />
        <Stat label={<span className="inline-flex items-center gap-1.5"><UsersRound size={13} />{t('reg.nursing')}</span>} value={sum(visible.map((r) => metricValue(r, 'nursing_staff'))).toLocaleString('ru-RU')} unit={`${t('reg.hotspots')}: ${hotspots}`} tone="#0E9F9B" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card title={t('reg.mapTitle')} sub={t('reg.mapSub')} right={<Badge tone="primary">AshyqData {trends.years?.[0] ?? 2020}–2025</Badge>}>
          {tab === 'map' ? <KazakhstanChoropleth regions={visible} metric={metric} selected={sel} onSelect={setSel} raster={raster} /> : <RegionTable regions={visible} selected={sel} onSelect={setSel} name={name} lang={lang} />}
          <div className="muted text-xs mt-2 flex flex-wrap gap-x-4 gap-y-1"><span>{t('source')}: AshyqData 2025 · MICS 2024 · WorldPop 2015</span><span>{t('reg.boundaries')}: © OpenStreetMap contributors (ODbL)</span></div>
        </Card>
        <div className="grid gap-3 self-start">
          <Card title={name(selected)} sub={`${selected.centre} · ${t('an.level')} ${['', 'I', 'II', 'III'][selected.level]}`} right={selected.growth && <Badge tone="moderate">{t('an.growth')}</Badge>}>
            <div className="grid grid-cols-2 gap-3">
              {METRICS.filter((m) => m.source === 'ashyq').map((m) => <div key={m.key}><div className="eyebrow">{m.label[lang] || m.label.ru}</div><div className={`${isCapacityMetric(m.key) ? 'mono text-xl font-semibold' : 'big-num text-3xl'} mt-1`} style={!isCapacityMetric(m.key) ? { color: (metricValue(selected, m.key) ?? 0) > nat[m.key] ? '#C62828' : '#15803D' } : undefined}>{formatMetric(metricValue(selected, m.key), m.key, lang)}</div>{!isCapacityMetric(m.key) && <div className="muted text-xs">{t('reg.national')} {nat[m.key]} ‰</div>}</div>)}
            </div>
            <div className="mt-3 pt-3 border-t border-line grid gap-1.5 text-xs">
              <div className="flex justify-between gap-2"><span className="muted">MICS 2024 (brief)</span><span className="mono">{selected.nmr == null ? t('reg.suppressed') : `${selected.nmr} ‰`}</span></div>
              {selected.official?.mics_micro && <div className="flex justify-between gap-2"><span className="muted">MICS microdata · n={selected.official.mics_micro.births}</span><span className="mono">{selected.official.mics_micro.nmr} ‰ {!selected.official.mics_micro.reliable && <span className="origin origin-estimate" style={{ padding: '0 5px' }}>{selected.official.mics_micro.neo_deaths} {t('reg.events')}</span>}</span></div>}
              <div className="flex justify-between gap-2"><span className="muted">WorldPop 2015 · {t('reg.pregnancies')}</span><span className="mono">{formatMetric(selected.official?.worldpop_pregnancies_2015, 'pregnancies', lang)}</span></div>
            </div>
          </Card>
          <Card title={`${t('reg.top')} · ${def.label[lang] || def.label.ru}`} sub={def.note}>
            <ol className="grid gap-1.5 text-sm">{top.map((r, i) => <li key={r.id} className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer ${r.id === sel ? 'bg-primary-soft' : 'hover:bg-cream'}`} onClick={() => setSel(r.id)}><span><span className="mono muted text-xs mr-2">{i + 1}</span>{name(r)}</span><span className="mono text-xs font-semibold">{formatMetric(metricValue(r, metric), metric, lang)}</span></li>)}</ol>
          </Card>
        </div>
      </div>

      <Card title={`${t('reg.trend')} — ${name(selected)}`} sub={t('reg.trendSub')} right={<div className="flex flex-wrap items-center gap-2"><YearRange from={range[0]} to={range[1]} onChange={setRange} /><select className="w-auto py-1.5 text-xs" value={trendMetric} onChange={(e) => setTrendMetric(e.target.value)}>{METRICS.filter((m) => m.source === 'ashyq' && m.kind === 'mortality').map((m) => <option key={m.key} value={m.key}>{m.label[lang] || m.label.ru}</option>)}</select><span className="flex border border-line-strong rounded-md overflow-hidden">{[[false, t('reg.region')], [true, t('reg.compareRK')]].map(([v, l]) => <button key={String(v)} type="button" className={`btn border-0 rounded-none py-1.5 ${compare === v ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setCompare(v)}>{l}</button>)}</span></div>}>
        <TrendChart trends={trends.trends} ids={trendIds} name={name} byId={byId} range={range} metricKey={trendMetric} national={nat[trendMetric]} compare={compare} />
        <div className="muted text-xs mt-2">{t('reg.trendHint')}</div>
      </Card>

      <Card title={t('reg.howTitle')} sub={t('reg.howSub')}>
        <div className="grid gap-3 md:grid-cols-3 text-sm">
          {[['PICDB · Асфендиярова / ML', t('reg.how1')], ['AshyqData · MICS · WorldPop', t('reg.how2')], [t('reg.how3t'), t('reg.how3')]].map(([h, p]) => <div key={h} className="rounded-lg border border-line bg-cream p-3"><div className="font-semibold mb-1">{h}</div><p className="muted">{p}</p></div>)}
        </div>
        <div className="flex flex-wrap gap-3 mt-3 text-xs">{(data.datasets || []).filter((d) => d.url).map((d) => <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary"><Globe size={12} />{d.name}</a>)}</div>
      </Card>
    </div>
  );
}
