/**
 * Provenance UI. Every dataset-backed component states where its numbers come from with one of these pills,
 * fed by GET /api/ml/provenance and the `sources` block of /api/analytics/regions.
 */
import { useEffect, useState } from 'react';
import { Database, Radio, Sparkles, ShieldCheck, FileSpreadsheet, ArrowRight, Cpu, BrainCircuit, ClipboardCheck, RefreshCw } from 'lucide-react';
import { api } from '../services/api.js';

const KIND = {
  official: { cls: 'origin-official', Icon: ShieldCheck },
  synthetic: { cls: 'origin-synthetic', Icon: Database },
  simulated: { cls: 'origin-simulated', Icon: Radio },
  model: { cls: 'origin-model', Icon: Cpu },
  estimate: { cls: 'origin-estimate', Icon: Sparkles },
  real: { cls: 'origin-official', Icon: Database },
};

export function OriginPill({ kind = 'estimate', children, title }) {
  const { cls, Icon } = KIND[kind] || KIND.estimate;
  return <span className={`origin ${cls}`} title={title}><Icon size={11} />{children}</span>;
}

export function useProvenance() {
  const [prov, setProv] = useState(null);
  useEffect(() => { api.provenance().then(setProv).catch(() => setProv(null)); }, []);
  return prov;
}

/** Pill describing the active tabular model and the data it was trained on. */
export function ModelOriginPill({ prov }) {
  const p = prov || useProvenance();
  if (!p) return <OriginPill kind="model">model · loading</OriginPill>;
  const t = p.tabular; const synthetic = t.baseline?.is_synthetic && !(t.uploads?.length);
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <OriginPill kind="model" title={`Active model ${t.model_version}`}>{t.model_version?.replace('xgb-24h-', 'xgb ')}</OriginPill>
      <OriginPill kind={synthetic ? 'synthetic' : 'real'} title={t.trained_on}>{synthetic ? `trained on ${t.n || 804} PICDB-shaped synthetic admissions` : `trained on ${t.trained_on}`}</OriginPill>
      {t.uploads?.length > 0 && <OriginPill kind="real">+ {t.uploads.length} local dataset{t.uploads.length > 1 ? 's' : ''}</OriginPill>}
    </span>
  );
}

/** Horizontal data-flow indicator: EHR export → schema mapper → 31 features → model → SHAP → sign-off → retrain. */
export function DataFlow({ compact = false, prov }) {
  const steps = [
    [FileSpreadsheet, 'Damumed / CSV export', 'Russian column headers'],
    [ArrowRight, 'Schema mapper', '→ 31 core EHR features'],
    [Database, prov?.tabular?.baseline?.is_synthetic ? 'Baseline + local data' : 'Local cohort', prov?.tabular?.trained_on || 'PICDB-shaped baseline'],
    [Cpu, `XGBoost ${prov?.tabular?.model_version?.replace('xgb-24h-', '') || ''}`, 'calibrated 24h risk'],
    [BrainCircuit, 'SHAP waterfall', 'feature attribution'],
    [ClipboardCheck, 'Doctor sign-off', 'human-in-the-loop'],
    [RefreshCw, 'Retrain', 'feedback + new datasets'],
  ];
  return (
    <div className={`flex ${compact ? 'gap-1' : 'gap-2'} overflow-x-auto py-1`}>
      {steps.map(([Icon, title, sub], i) => (
        <div key={title} className="flex items-center gap-2 shrink-0">
          <div className={`card ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} flex items-center gap-2`}><Icon size={14} className="text-primary" /><div><div className="text-xs font-semibold whitespace-nowrap">{title}</div>{!compact && <div className="muted text-[11px] whitespace-nowrap">{sub}</div>}</div></div>
          {i < steps.length - 1 && <ArrowRight size={12} className="text-line-strong shrink-0" />}
        </div>
      ))}
    </div>
  );
}
