#!/usr/bin/env python3
"""Train the NeoOutcome *admission* model on the Asfendiyarov dataset.

Ported from the initial NeoOutcome repository (``train_asfendiyarov.py``) and
made importable so the API can train the artifact on first boot.

Target: in-hospital death. In the source file ``event = 1`` means survived /
discharged alive and ``event = 0`` means death (confirmed by the data: death
share falls from 73% at <=25 weeks to 6% at 32-33 weeks, and from 100% at
Apgar 1 to 0% at Apgar 9). Here we use ``death = 1 - event``.

Only information available at NICU admission is used (maternal + birth
features). Excluded on purpose:
  - oc_*  : in-hospital complications (IVH, NEC, DIC...) -> outcome leakage;
  - b_patent, b_pneumonia, b_hemorrhagic, b_anemia : diagnoses usually
    established during the stay -> likely leakage (see --with-diagnoses);
  - duration, Year.

Validation is temporal (no random split):
  train 2021-2022 -> tune threshold on 2023 -> final fit 2021-2023 -> test 2024-2025.
Mortality falls over time (2021: 46% -> 2025: 15%), so recent years get higher
sample weights (2023 x3, 2022 x2, 2021 x1) and the alert threshold is chosen
for 80% sensitivity on 2023 rather than a fixed 0.5.

Research/demo only. Not for clinical use.

Usage:
  python -m ml.train_admission
  python -m ml.train_admission --with-diagnoses   # leakage comparison for the paper
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    roc_auc_score,
    roc_curve,
)

ML_ROOT = Path(__file__).resolve().parent
DEFAULT_DATA = ML_ROOT / "asfendiyarov" / "asfendiyarov_deidentified.csv"
DEFAULT_MODEL_NAME = "neooutcome_admission_xgb.joblib"
DEFAULT_REPORT_NAME = "asfendiyarov_metrics.json"

ADMISSION_FEATURES = [
    "m_age",
    "m_obstetric",
    "m_preeclampsia",
    "m_chorioamnionitis",
    "m_intrauterine",
    "m_birth",
    "b_gender",
    "b_weight",
    "b_apgar",
    "b_gestational",
    "b_respiratory_failure",
    "b_heart_rate",
    "b_saturation",
    "b_blood",
    "b_rhesus",
]
DIAGNOSIS_FEATURES = ["b_patent", "b_pneumonia", "b_hemorrhagic", "b_anemia"]
COMPLICATION_FEATURES = [
    "oc_respiratory",
    "oc_intraventricular",
    "oc_intravascular",
    "oc_necrotizing",
]

# Physiologically plausible ranges; values outside become NaN (then median-imputed).
PLAUSIBLE = {
    "m_age": (14, 55),
    "b_weight": (300, 6000),
    "b_apgar": (0, 10),
    "b_gestational": (22, 42),
    "b_respiratory_failure": (0, 3),
    "b_heart_rate": (40, 250),
    "b_saturation": (20, 100),
    "duration": (0, 365),
}

PARAMS = dict(
    n_estimators=300,
    max_depth=3,
    learning_rate=0.03,
    subsample=0.8,
    colsample_bytree=0.8,
    min_child_weight=5,
    reg_lambda=2.0,
    eval_metric="logloss",
    random_state=42,
)


def load_clean(path: Path) -> tuple[pd.DataFrame, dict[str, int]]:
    raw = pd.read_csv(path, dtype=str)
    raw.columns = [c.strip() for c in raw.columns]  # "m_birth " -> "m_birth"
    cleaned = raw.apply(
        lambda s: pd.to_numeric(
            s.str.replace("\xa0", "", regex=False)
            .str.strip()
            .str.replace(",", ".", regex=False),
            errors="coerce",
        )
    )
    report: dict[str, int] = {}
    for col, (low, high) in PLAUSIBLE.items():
        if col in cleaned:
            bad = cleaned[col].notna() & ~cleaned[col].between(low, high)
            report[col] = int(bad.sum())
            cleaned.loc[bad, col] = np.nan
    cleaned = cleaned.dropna(subset=["event", "Year"])
    cleaned["death"] = (1 - cleaned["event"]).astype(int)
    return cleaned, report


def threshold_at_sensitivity(y: np.ndarray, p: np.ndarray, sens: float = 0.80) -> float:
    _, tpr, thr = roc_curve(y, p)
    return float(thr[int(np.argmax(tpr >= sens))])


def recency_weights(years: pd.Series) -> np.ndarray:
    newest = years.max()
    return np.clip(3 - (newest - years.to_numpy()), 1, 3).astype(float)


def evaluate(y: np.ndarray, p: np.ndarray, threshold: float) -> dict[str, float]:
    pred = p >= threshold
    tp = int((pred & (y == 1)).sum())
    fn = int((~pred & (y == 1)).sum())
    tn = int((~pred & (y == 0)).sum())
    fp = int((pred & (y == 0)).sum())
    logit = np.log(np.clip(p, 1e-6, 1 - 1e-6) / np.clip(1 - p, 1e-6, 1))
    slope, intercept = np.polyfit(logit, y, 1) if len(set(y)) > 1 else (np.nan, np.nan)
    return {
        "n": int(len(y)),
        "deaths": int(y.sum()),
        "auroc": round(float(roc_auc_score(y, p)), 4),
        "auprc": round(float(average_precision_score(y, p)), 4),
        "brier": round(float(brier_score_loss(y, p)), 4),
        "observed_mortality": round(float(y.mean()), 4),
        "mean_predicted": round(float(p.mean()), 4),
        "sensitivity": round(tp / max(tp + fn, 1), 4),
        "specificity": round(tn / max(tn + fp, 1), 4),
        "ppv": round(tp / max(tp + fp, 1), 4),
        "calibration_linear_slope": round(float(slope), 4),
        "calibration_linear_intercept": round(float(intercept), 4),
    }


def bootstrap_auc(y: np.ndarray, p: np.ndarray, n: int = 1000) -> list[float]:
    rng = np.random.default_rng(42)
    scores = []
    for _ in range(n):
        idx = rng.integers(0, len(y), len(y))
        if len(set(y[idx])) > 1:
            scores.append(roc_auc_score(y[idx], p[idx]))
    return [round(float(np.percentile(scores, 2.5)), 4), round(float(np.percentile(scores, 97.5)), 4)]


def fit(df: pd.DataFrame, features: list[str], medians: dict[str, float]) -> xgb.XGBClassifier:
    model = xgb.XGBClassifier(**PARAMS)
    model.fit(df[features].fillna(medians), df["death"], sample_weight=recency_weights(df["Year"]))
    return model


def train_admission(
    data: Path = DEFAULT_DATA,
    out_dir: Path | None = None,
    *,
    with_diagnoses: bool = False,
    log=print,
) -> dict:
    """Train and persist the admission model. Returns the metrics report."""
    out_dir = Path(out_dir or ML_ROOT.parent / "artifacts")
    out_dir.mkdir(parents=True, exist_ok=True)
    model_path = out_dir / DEFAULT_MODEL_NAME
    report_path = out_dir / DEFAULT_REPORT_NAME

    df, cleaning = load_clean(Path(data))
    features = ADMISSION_FEATURES + (DIAGNOSIS_FEATURES if with_diagnoses else [])

    dev, val, test = df[df.Year <= 2022], df[df.Year == 2023], df[df.Year >= 2024]
    train_full = df[df.Year <= 2023]

    med_dev = dev[features].median().to_dict()
    m_dev = fit(dev, features, med_dev)
    p_val = m_dev.predict_proba(val[features].fillna(med_dev))[:, 1]
    threshold = threshold_at_sensitivity(val["death"].to_numpy(), p_val, 0.80)

    medians = train_full[features].median().to_dict()
    model = fit(train_full, features, medians)
    p_test = model.predict_proba(test[features].fillna(medians))[:, 1]
    y_test = test["death"].to_numpy()
    test_metrics = evaluate(y_test, p_test, threshold)
    test_metrics["auroc_95ci"] = bootstrap_auc(y_test, p_test)

    leak_feats = ADMISSION_FEATURES + DIAGNOSIS_FEATURES + COMPLICATION_FEATURES
    leak_med = train_full[leak_feats].median().to_dict()
    leak_model = fit(train_full, leak_feats, leak_med)
    leak_auc = roc_auc_score(y_test, leak_model.predict_proba(test[leak_feats].fillna(leak_med))[:, 1])

    importance = dict(
        sorted(
            ((f, round(float(v), 4)) for f, v in zip(features, model.feature_importances_)),
            key=lambda kv: -kv[1],
        )
    )

    report = {
        "model_name": "neooutcome_admission_xgb",
        "target": "in-hospital death (death = 1 - event)",
        "features": features,
        "split": {
            "train": "2021-2023",
            "threshold_tuning": "2023 (model trained on 2021-2022)",
            "test": "2024-2025",
            "n_train": int(len(train_full)),
            "n_test": int(len(test)),
        },
        "n_rows": int(len(df)),
        "cleaning_values_set_to_nan": cleaning,
        "threshold": round(threshold, 4),
        "threshold_rule": "80% sensitivity on 2023 validation",
        "sample_weights": "2023 x3, 2022 x2, 2021 x1",
        "test_metrics": test_metrics,
        "leakage_reference_auroc_with_complications": round(float(leak_auc), 4),
        "feature_importance_gain": importance,
        "mortality_by_year": {int(k): float(v) for k, v in df.groupby("Year")["death"].mean().round(3).items()},
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "source": "KazNMU n.a. S.D. Asfendiyarov de-identified NICU extract, 2021-2025 (hackathon use)",
    }

    ranges = {f: [float(df[f].min()), float(df[f].max())] for f in features}
    joblib.dump(
        {
            "model": model,
            "features": features,
            "threshold": threshold,
            "median_values": medians,
            "feature_ranges": ranges,
            "metrics": test_metrics,
            "train_mortality": float(train_full["death"].mean()),
            "report": report,
        },
        model_path,
    )
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    m = test_metrics
    log(
        f"admission model saved: {model_path.name} | test 2024-2025 n={m['n']} deaths={m['deaths']} "
        f"AUROC {m['auroc']} (95% CI {m['auroc_95ci'][0]}-{m['auroc_95ci'][1]}) "
        f"sens {m['sensitivity']} spec {m['specificity']} thr {threshold:.3f} | leakage ref AUROC {report['leakage_reference_auroc_with_complications']}"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--out", type=Path, default=None, help="artifacts dir (default backend/artifacts)")
    parser.add_argument("--with-diagnoses", action="store_true", help="Also add in-stay diagnoses (leakage check)")
    args = parser.parse_args()
    train_admission(args.data, args.out, with_diagnoses=args.with_diagnoses)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
