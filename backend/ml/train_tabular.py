"""
Train the 24-hour deterioration risk model (XGBoost + isotonic calibration).

Usage
  python -m ml.train_tabular                                   # synthetic cohort (demo / CI)
  python -m ml.train_tabular --data data/kz_nicu_2023_2025.csv  # Kazakhstan retrospective extract
  python -m ml.train_tabular --data data/pic.csv --version v3.2 --push

Input CSV: one admission per row, the 31 core feature columns (see services.ml_engine.ALL_FEATURES,
categoricals as text: sex F/M, delivery_mode vaginal/cesarean, vent_mode "room air"/HFNC/nCPAP/SIMV/HFOV)
plus a binary `deteriorated_24h` label. Missing values are allowed. Extra columns are ignored.

Outputs (in --out, default backend/artifacts):
  xgb-24h.json          XGBoost booster
  xgb-24h.calib.joblib  calibrator (Platt sigmoid by default, --calibration isotonic) fitted on the held-out fold
  xgb-24h.meta.json     version, metrics (CV AUROC/AUPRC/Brier/ECE), medians, feature list, data source
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, train_test_split

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ml.calibration import PlattCalibrator  # noqa: E402
from services.ml_engine import ALL_FEATURES, CATEGORICAL_FEATURES, NUMERIC_FEATURES, RiskEngine  # noqa: E402

LABEL = "deteriorated_24h"


def ece_score(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    ece = 0.0
    for b in range(bins):
        m = idx == b
        if m.any():
            ece += m.mean() * abs(p[m].mean() - y[m].mean())
    return float(ece)


def encode(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    for k in NUMERIC_FEATURES:
        out[k] = pd.to_numeric(df[k], errors="coerce") if k in df else np.nan
    if "sf_ratio" not in df or out["sf_ratio"].isna().all():
        out["sf_ratio"] = out["spo2"] / (out["fio2"].clip(lower=21) / 100.0)
    for k, cats in CATEGORICAL_FEATURES.items():
        col = df[k].astype(str) if k in df else pd.Series(cats[0], index=df.index)
        out[k] = col.map({c: i for i, c in enumerate(cats)}).fillna(0).astype(int)
    return out[ALL_FEATURES]


def load(args) -> tuple[pd.DataFrame, np.ndarray, str]:
    if args.data:
        raw = pd.read_csv(args.data)
        if LABEL not in raw:
            raise SystemExit(f"CSV must contain a binary '{LABEL}' column")
        return encode(raw), raw[LABEL].astype(int).to_numpy(), os.path.basename(args.data)
    X, y = RiskEngine.synthetic_cohort(n=args.n, seed=args.seed)
    return X, y, f"synthetic(n={args.n}, seed={args.seed})"


def make_model(trees=400, depth=4, lr=0.04, seed=42) -> xgb.XGBClassifier:
    return xgb.XGBClassifier(n_estimators=trees, max_depth=depth, learning_rate=lr, subsample=0.9, colsample_bytree=0.8,
                             min_child_weight=3, reg_lambda=1.0, eval_metric="logloss", random_state=seed, n_jobs=-1)


def run_training(X: pd.DataFrame, y: np.ndarray, out: Path, version: str, source: str, *, calibration="sigmoid", trees=400, depth=4, lr=0.04, seed=42, progress=None, log=print) -> dict:
    """Full pipeline: stratified 5-fold CV → final fit on 80 % → calibration on held-out 20 % → artifacts + meta.
    `progress(pct, stage)` is called as the pipeline advances (used by services/retraining_engine.py)."""
    def step(pct, stage):
        if progress:
            progress(pct, stage)
    log(f"[train] {source} · {len(y)} rows · prevalence {y.mean():.3f}")
    step(5, "cross-validation")
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    oof = np.zeros(len(y))
    for i, (tr, va) in enumerate(skf.split(X, y)):
        m = make_model(trees, depth, lr, seed); m.fit(X.iloc[tr], y[tr]); oof[va] = m.predict_proba(X.iloc[va])[:, 1]
        log(f"  fold {i + 1}: AUROC {roc_auc_score(y[va], oof[va]):.3f}")
        step(5 + (i + 1) * 12, f"fold {i + 1}/5")
    yhat = (oof >= 0.5).astype(int)
    tp, fp, fn, tn = int(((yhat == 1) & (y == 1)).sum()), int(((yhat == 1) & (y == 0)).sum()), int(((yhat == 0) & (y == 1)).sum()), int(((yhat == 0) & (y == 0)).sum())
    cv = {"auroc": roc_auc_score(y, oof), "auprc": average_precision_score(y, oof), "brier": brier_score_loss(y, oof), "ece_raw": ece_score(y, oof),
          "sensitivity": tp / max(tp + fn, 1), "specificity": tn / max(tn + fp, 1), "f1": 2 * tp / max(2 * tp + fp + fn, 1)}
    step(70, "final fit")
    Xtr, Xcal, ytr, ycal = train_test_split(X, y, test_size=0.2, stratify=y, random_state=seed)
    model = make_model(trees, depth, lr, seed); model.fit(Xtr, ytr)
    step(85, "calibration")
    raw_cal = model.predict_proba(Xcal)[:, 1]
    calib = IsotonicRegression(out_of_bounds="clip").fit(raw_cal, ycal) if calibration == "isotonic" else PlattCalibrator().fit(raw_cal, ycal)
    cv["ece_calibrated"] = ece_score(ycal, calib.predict(raw_cal))
    cv["brier_calibrated"] = brier_score_loss(ycal, calib.predict(raw_cal))
    step(92, "saving artifacts")
    out = Path(out); out.mkdir(parents=True, exist_ok=True)
    model.save_model(out / "xgb-24h.json")
    joblib.dump(calib, out / "xgb-24h.calib.joblib")
    meta = {
        "version": version if version.startswith("xgb-24h-") else f"xgb-24h-{version}", "trained_at": datetime.now(timezone.utc).isoformat(), "data_source": source, "n": int(len(y)),
        "base_rate": float(y.mean()), "medians": {k: float(X[k].median()) for k in NUMERIC_FEATURES}, "features": ALL_FEATURES,
        "metrics": {k: round(float(v), 4) for k, v in cv.items()}, "hyperparams": {"trees": trees, "depth": depth, "lr": lr, "calibration": calibration},
        "feature_importance": {k: float(v) for k, v in zip(ALL_FEATURES, model.feature_importances_)},
    }
    (out / "xgb-24h.meta.json").write_text(json.dumps(meta, indent=2))
    log(f"[train] metrics {meta['metrics']}")
    log(f"[train] saved → {out}")
    step(100, "done")
    return meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data"); ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "artifacts"))
    ap.add_argument("--version", default="v3.1"); ap.add_argument("--push", action="store_true", help="upload to the S3 registry")
    ap.add_argument("--n", type=int, default=8000); ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--calibration", choices=["sigmoid", "isotonic"], default="sigmoid")
    ap.add_argument("--trees", type=int, default=400); ap.add_argument("--depth", type=int, default=4); ap.add_argument("--lr", type=float, default=0.04)
    args = ap.parse_args()
    X, y, source = load(args)
    run_training(X, y, Path(args.out), args.version, source, calibration=args.calibration, trees=args.trees, depth=args.depth, lr=args.lr, seed=args.seed)
    if args.push:
        from ml.registry import push
        print("[train] pushed", push("xgb-24h", args.version, args.out))


if __name__ == "__main__":
    main()
