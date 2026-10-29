import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { useT } from '../../lib/i18n.jsx';
import { METRICS, colorScale, formatMetric, metricValue } from '../../lib/official.js';

/** OSM relation id (public/data/kazakhstan-admin1.geojson) → platform region id. Ported from the initial repository. */
const OSM_TO_ID = { 214834: 'atyrau', 215441: 'west', 215683: 'aktobe', 215686: 'mangystau', 215699: 'east', 215718: 'almaty_region', 215722: 'jambyl', 215727: 'kyzylorda', 215739: 'turkestan', 215743: 'akmola', 215760: 'north', 215772: 'pavlodar', 215776: 'karaganda', 1288730: 'kostanay', 2465058: 'almaty_city', 3087155: 'astana', 3389772: 'shymkent', 14243026: 'abai', 14312169: 'jetisu', 14312737: 'ulytau' };

let geoCache = null;

/**
 * Interactive choropleth of the 20 regions (d3-geo Mercator over OSM admin-1 boundaries).
 * `regions` = rows from /api/analytics/regions; `metric` = key from lib/official METRICS.
 */
let rasterMeta = null;

/** The WorldPop pregnancies raster, pre-warped to EPSG:3857 (public/data/worldpop_pregs_2015_3857.png). Mercator is linear in
 *  projected space, so the image corners map straight onto the d3 geoMercator projection used for the polygons. */
function RasterLayer({ projection, opacity = 1 }) {
  const [meta, setMeta] = useState(rasterMeta);
  useEffect(() => { if (meta) return; fetch('/data/worldpop_pregs_2015_3857.json').then((r) => r.json()).then((m) => { rasterMeta = m; setMeta(m); }).catch(() => {}); }, [meta]);
  if (!meta || !projection) return null;
  const [w, s, e, n] = meta.bounds_lonlat;
  const tl = projection([w, n]), br = projection([e, s]);
  if (!tl || !br) return null;
  return <image href="/data/worldpop_pregs_2015_3857.png" x={tl[0]} y={tl[1]} width={br[0] - tl[0]} height={br[1] - tl[1]} preserveAspectRatio="none" opacity={opacity} style={{ mixBlendMode: 'multiply' }} pointerEvents="none" />;
}

export default function KazakhstanChoropleth({ regions, metric, selected, onSelect, height = 'min-h-[390px]', raster = false, compact = false }) {
  const { t, lang } = useT();
  const ref = useRef(null);
  const [geo, setGeo] = useState(geoCache);
  const [err, setErr] = useState(false);
  const [hover, setHover] = useState(null);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    if (geo) return;
    let on = true;
    fetch('/data/kazakhstan-admin1.geojson').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((d) => { geoCache = d; if (on) setGeo(d); }).catch(() => on && setErr(true));
    return () => { on = false; };
  }, [geo]);

  const byId = useMemo(() => Object.fromEntries(regions.map((r) => [r.id, r])), [regions]);
  const values = useMemo(() => regions.map((r) => metricValue(r, metric)), [regions, metric]);
  const scale = useMemo(() => colorScale(values, metric), [values, metric]);
  const projection = useMemo(() => (geo ? geoMercator().fitExtent([[24, 20], [976, 540]], geo) : null), [geo]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);
  const name = useCallback((r) => r[lang] || r.ru || r.en, [lang]);
  const def = METRICS.find((m) => m.key === metric);

  const moveTip = (e, r) => { const b = ref.current?.getBoundingClientRect(); if (!b) return; setTip({ x: e.clientX - b.left, y: e.clientY - b.top, r }); };

  if (err) return <div className={`grid place-items-center muted text-sm ${height}`}>{t('map.unavailable')}</div>;
  if (!geo || !path) return <div className={`grid place-items-center muted text-sm ${height}`}>{t('loading')}</div>;

  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-lg" style={{ background: 'linear-gradient(180deg,#F7FBFC,#EEF7F9)' }}>
      <svg viewBox="0 0 1000 560" className={`block w-full h-auto ${height}`} role="img" aria-label={t('an.choropleth')}>
        <defs><pattern id="choro-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M 28 0 L 0 0 0 28" fill="none" stroke="#D9E8EC" strokeWidth="0.6" opacity=".55" /></pattern></defs>
        <rect width="1000" height="560" fill="url(#choro-grid)" />
        {raster && <RasterLayer projection={projection} />}
        <g>
          {geo.features.map((f) => {
            const id = OSM_TO_ID[f.properties?.osm_id]; const r = id && byId[id]; if (!r) return null;
            const v = metricValue(r, metric); const sel = selected === id; const hov = hover === id;
            return (
              <path key={id} d={path(f) || undefined} fill={raster ? (sel || hov ? '#0E9F9B' : '#0B2239') : scale.color(v)} fillOpacity={raster ? (sel ? 0.18 : hov ? 0.1 : 0.02) : 1} stroke={raster ? '#0B2239' : sel ? '#0B2239' : '#FFFFFF'} strokeOpacity={raster ? (sel ? 1 : 0.45) : 1} strokeWidth={sel ? 2.4 : hov ? 2 : 1.1} vectorEffect="non-scaling-stroke" role="button" tabIndex={0}
                aria-label={`${name(r)}: ${formatMetric(v, metric, lang)}`} className="cursor-pointer outline-none transition-[opacity] duration-150 focus-visible:opacity-70" style={{ opacity: hover && !hov && !sel ? 0.82 : 1 }}
                onClick={() => onSelect(id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } }}
                onPointerEnter={(e) => { setHover(id); moveTip(e, r); }} onPointerMove={(e) => moveTip(e, r)} onPointerLeave={() => { setHover(null); setTip(null); }} />
            );
          })}
        </g>
        <g>
          {regions.map((r) => { const p = projection([r.lon, r.lat]); if (!p) return null; return <g key={r.id} pointerEvents="none"><circle cx={p[0]} cy={p[1]} r={2.2} fill="#0B2239" opacity=".55" /><text x={p[0]} y={p[1] - 6} textAnchor="middle" fontSize="10.5" fontFamily="Inter, system-ui" fontWeight="500" fill="#3C4660">{r.centre}</text></g>; })}
        </g>
      </svg>
      {tip && (
        <div className="pointer-events-none absolute z-10 card-pop px-3 py-2 text-xs" style={{ left: Math.min(tip.x + 14, (ref.current?.clientWidth || 600) - 200), top: tip.y + 14, minWidth: 170 }}>
          <div className="font-semibold text-sm">{name(tip.r)}</div>
          <div className="mono mt-0.5">{def?.label[lang] || def?.label.ru}: <span className="font-semibold">{formatMetric(metricValue(tip.r, metric), metric, lang)}</span></div>
          <div className="muted">{def?.note}</div>
        </div>
      )}
      {raster && !compact && <div className="absolute right-3 bottom-3 glass px-2.5 py-1.5 text-[11px] muted">WorldPop 2015 · {t('reg.pregnancies')} / km² · CC BY 4.0</div>}
      {!compact && <div className="absolute left-3 bottom-3 flex items-center gap-2 glass px-2.5 py-1.5 text-[11px]">
        <span className="muted">{formatMetric(scale.min, metric, lang)}</span>
        <span className="flex overflow-hidden rounded-sm">{scale.palette.map((c) => <span key={c} className="block h-3 w-6" style={{ background: c }} />)}</span>
        <span className="muted">{formatMetric(scale.max, metric, lang)}</span>
      </div>}
    </div>
  );
}
