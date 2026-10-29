"""
Tabular 24-hour deterioration risk engine.

An XGBoost classifier over the 31 core features. On first start, if no trained
artifact exists under `settings.model_dir`, the engine trains on a synthetic
NICU cohort whose generating process mirrors published PIC-database effect
sizes, then caches the model. Replace `artifacts/xgb-24h.json` with the model
trained on the Kazakhstan retrospective cohort to go live.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass

import numpy as np
import pandas as pd
import xgboost as xgb

from config import get_settings

MODEL_VERSION = "xgb-24h-v3.1"  # overridden by artifacts/xgb-24h.meta.json when a trained model is loaded

NUMERIC_FEATURES = [
    "gestational_age_wk", "birth_weight_g", "apgar_1", "apgar_5", "age_hours", "heart_rate", "resp_rate", "spo2", "fio2",
    "sf_ratio", "map_mmhg", "temperature", "ph", "pco2", "po2", "hco3", "base_excess", "lactate", "glucose", "hemoglobin",
    "wbc", "platelets", "crp", "sodium", "potassium", "creatinine", "bilirubin", "urine_output",
]
CATEGORICAL_FEATURES = {"sex": ["F", "M"], "delivery_mode": ["vaginal", "cesarean"], "vent_mode": ["room air", "HFNC", "nCPAP", "SIMV", "HFOV"]}
ALL_FEATURES = NUMERIC_FEATURES + list(CATEGORICAL_FEATURES)  # 31

LABELS = {
    "gestational_age_wk": "Gestational age (wk)", "birth_weight_g": "Birth weight (g)", "apgar_1": "APGAR 1 min", "apgar_5": "APGAR 5 min",
    "age_hours": "Postnatal age (h)", "heart_rate": "Heart rate (bpm)", "resp_rate": "Respiratory rate", "spo2": "SpO2 (%)", "fio2": "FiO2 (%)",
    "sf_ratio": "SpO2/FiO2 ratio", "map_mmhg": "Mean arterial pressure", "temperature": "Temperature (°C)", "ph": "pH", "pco2": "pCO2", "po2": "pO2",
    "hco3": "HCO3", "base_excess": "Base excess (mmol/L)", "lactate": "Lactate (mmol/L)", "glucose": "Glucose", "hemoglobin": "Hemoglobin",
    "wbc": "WBC", "platelets": "Platelets", "crp": "CRP", "sodium": "Sodium", "potassium": "Potassium", "creatinine": "Creatinine",
    "bilirubin": "Bilirubin", "urine_output": "Urine output (mL/kg/h)", "sex": "Sex", "delivery_mode": "Delivery mode", "vent_mode": "Ventilation mode",
}

TIERS = [(75, "critical"), (50, "high"), (25, "moderate"), (0, "low")]
RECOMMENDATIONS = {
    "low": ["Routine monitoring", "Reassess vitals in 4 h"],
    "moderate": ["Repeat blood gas in 2 h", "Notify attending neonatologist"],
    "high": ["Senior review within 30 min", "Prepare escalation of respiratory support"],
    "critical": ["Immediate bedside review", "Sepsis bundle; consider intubation"],
}


def tier_for(percent: float) -> str:
    for threshold, name in TIERS:
        if percent >= threshold:
            return name
    return "low"


@dataclass
class RiskResult:
    probability: float
    base_rate: float
    shap_values: np.ndarray  # log-odds per feature, order = ALL_FEATURES
    encoded: pd.DataFrame


class RiskEngine:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.model: xgb.XGBClassifier | None = None
        self.base_rate = 0.10
        self.medians: dict[str, float] = {}  # cohort medians used to impute features the HIS does not supply
        self.calibrator = None               # isotonic calibrator from ml/train_tabular.py (optional)
        self.version = MODEL_VERSION
        self.metrics: dict = {}
        self.data_source: str = ""
        self._explainer = None

    # ---------- feature handling ----------
    def to_frame(self, features: dict) -> pd.DataFrame:
        row = {}
        f = dict(features)
        if not f.get("sf_ratio"):
            f["sf_ratio"] = float(f.get("spo2", 95)) / (max(float(f.get("fio2", 21)), 21) / 100.0)
        for k in NUMERIC_FEATURES:
            v = f.get(k)
            row[k] = float(v) if v is not None and v != "" else self.medians.get(k, np.nan)
        for k, cats in CATEGORICAL_FEATURES.items():
            val = str(f.get(k, cats[0]))
            row[k] = cats.index(val) if val in cats else 0
        return pd.DataFrame([row], columns=ALL_FEATURES)

    # ---------- baseline cohort ----------
    BASELINE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ml", "baseline")

    @classmethod
    def baseline_manifest(cls) -> dict | None:
        p = os.path.join(cls.BASELINE_DIR, "manifest.json")
        if os.path.exists(p):
            with open(p) as fh:
                return json.load(fh)
        return None

    @classmethod
    def baseline_cohort(cls) -> tuple[pd.DataFrame, np.ndarray, str]:
        """The shipped baseline (ml/baseline/*.csv + manifest.json) when present, else the synthetic generator."""
        m = cls.baseline_manifest()
        if m:
            from ml.train_tabular import LABEL, encode
            raw = pd.read_csv(os.path.join(cls.BASELINE_DIR, m["file"]))
            return encode(raw), raw[LABEL].astype(int).to_numpy(), m["origin_label"]
        X, y = cls.synthetic_cohort(n=6000, seed=42)
        return X, y, "synthetic cohort (n=6000)"

    # ---------- synthetic cohort ----------
    @staticmethod
    def synthetic_cohort(n: int = 6000, seed: int = 42) -> tuple[pd.DataFrame, np.ndarray]:
        rng = np.random.default_rng(seed)
        ga = rng.normal(32, 4, n).clip(23, 42)
        bw = (ga - 22) * 150 + rng.normal(0, 250, n)
        fio2 = np.where(rng.random(n) < 0.55, 21, rng.uniform(25, 95, n))
        spo2 = (97 - (fio2 - 21) * 0.12 + rng.normal(0, 3, n)).clip(70, 100)
        lact = np.exp(rng.normal(0.6, 0.5, n)).clip(0.4, 14)
        be = rng.normal(-3, 4, n).clip(-22, 6)
        hr = rng.normal(148, 16, n).clip(90, 220)
        temp = rng.normal(36.7, 0.5, n).clip(34.5, 39)
        apgar5 = rng.integers(2, 11, n)
        df = pd.DataFrame({
            "gestational_age_wk": ga, "birth_weight_g": bw.clip(350, 5500), "apgar_1": (apgar5 - rng.integers(0, 3, n)).clip(0, 10), "apgar_5": apgar5,
            "age_hours": rng.integers(1, 168, n), "heart_rate": hr, "resp_rate": rng.normal(55, 10, n).clip(25, 95), "spo2": spo2, "fio2": fio2,
            "sf_ratio": spo2 / (fio2 / 100), "map_mmhg": rng.normal(42, 8, n), "temperature": temp, "ph": rng.normal(7.3, 0.07, n), "pco2": rng.normal(46, 9, n),
            "po2": rng.normal(60, 15, n), "hco3": rng.normal(22, 3, n), "base_excess": be, "lactate": lact, "glucose": rng.normal(4.5, 1.3, n),
            "hemoglobin": rng.normal(160, 22, n), "wbc": rng.normal(12, 5, n).clip(1, 40), "platelets": rng.normal(220, 70, n).clip(20, 500), "crp": np.exp(rng.normal(1, 1, n)).clip(0, 150),
            "sodium": rng.normal(138, 4, n), "potassium": rng.normal(4.6, 0.6, n), "creatinine": rng.normal(60, 20, n), "bilirubin": rng.normal(90, 50, n).clip(0, 400),
            "urine_output": rng.normal(2.5, 1, n).clip(0, 7), "sex": rng.integers(0, 2, n), "delivery_mode": rng.integers(0, 2, n), "vent_mode": rng.integers(0, 5, n),
        })
        logit = (-3.4 + (df.fio2 - 21) / 79 * 2.2 + (264 - df.sf_ratio.clip(upper=470)) / 264 * 1.9 + (df.lactate - 2) / 4 * 1.6 + (-4 - df.base_excess) / 8 * 1.2
                 + (df.heart_rate - 150) / 30 * 0.9 + (32 - df.gestational_age_wk) / 6 * 1.1 + (1500 - df.birth_weight_g) / 700 * 0.6 + (7 - df.apgar_5) / 3 * 0.7
                 + (36.5 - df.temperature) / 0.8 * 0.5 + (df.crp - 10) / 40 * 0.4 + (2 - df.urine_output) / 2 * 0.3 + rng.normal(0, 0.6, n))
        y = (rng.random(n) < 1 / (1 + np.exp(-logit))).astype(int)
        return df[ALL_FEATURES], y

    # ---------- lifecycle ----------
    def load_or_train(self) -> None:
        os.makedirs(self.settings.model_dir, exist_ok=True)
        path = os.path.join(self.settings.model_dir, "xgb-24h.json")
        meta_path = os.path.join(self.settings.model_dir, "xgb-24h.meta.json")
        self.model = xgb.XGBClassifier(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.9, colsample_bytree=0.8, eval_metric="logloss")
        if os.path.exists(path) and os.path.exists(meta_path):
            self.model.load_model(path)
            with open(meta_path) as fh:
                meta = json.load(fh)
            self.base_rate, self.medians = meta["base_rate"], meta.get("medians", {})
            self.version, self.metrics = meta.get("version", MODEL_VERSION), meta.get("metrics", {})
            self.data_source = meta.get("data_source", "")
            calib_path = os.path.join(self.settings.model_dir, "xgb-24h.calib.joblib")
            if os.path.exists(calib_path):
                import joblib
                import ml.calibration  # noqa: F401  (PlattCalibrator must be importable for unpickling)
                self.calibrator = joblib.load(calib_path)
            print(f"[ml] loaded {self.version} from {path} · calibrated={self.calibrator is not None} · source={meta.get('data_source', 'n/a')}")
        else:  # first boot: run the full pipeline (5-fold CV + calibration) so metrics are honest from the start
            X, y, source = self.baseline_cohort()
            from ml.train_tabular import run_training
            meta = run_training(X, y, self.settings.model_dir, MODEL_VERSION, source, log=lambda m: None)
            self.model.load_model(path)
            self.base_rate, self.medians, self.metrics, self.data_source = meta["base_rate"], meta["medians"], meta["metrics"], source
            import joblib
            import ml.calibration  # noqa: F401
            self.calibrator = joblib.load(os.path.join(self.settings.model_dir, "xgb-24h.calib.joblib"))
            print(f"[ml] trained {MODEL_VERSION} on {source} (n={len(y)}, AUROC {meta['metrics']['auroc']:.3f}, calibrated) → {path}")
            self._explainer = __import__("services.shap_service", fromlist=["build_explainer"]).build_explainer(self.model)
            return
        from services.shap_service import build_explainer
        self._explainer = build_explainer(self.model)

    def hot_swap(self, artifact_dir) -> None:
        """Atomically replace the in-memory model/calibrator/explainer with the artifact set in `artifact_dir`.
        Readers hold a reference to the old objects until they finish, so no request sees a half-loaded model."""
        import joblib
        import ml.calibration  # noqa: F401
        from services.shap_service import build_explainer
        d = str(artifact_dir)
        model = xgb.XGBClassifier()
        model.load_model(os.path.join(d, "xgb-24h.json"))
        with open(os.path.join(d, "xgb-24h.meta.json")) as fh:
            meta = json.load(fh)
        calib = joblib.load(os.path.join(d, "xgb-24h.calib.joblib")) if os.path.exists(os.path.join(d, "xgb-24h.calib.joblib")) else None
        explainer = build_explainer(model)
        # swap in one assignment block (GIL makes attribute writes atomic; readers use local refs via predict())
        self.model, self.calibrator, self._explainer = model, calib, explainer
        self.base_rate, self.medians = meta["base_rate"], meta.get("medians", {})
        self.version, self.metrics = meta.get("version", MODEL_VERSION), meta.get("metrics", {})
        self.data_source = meta.get("data_source", "")
        for f in ("xgb-24h.json", "xgb-24h.meta.json", "xgb-24h.calib.joblib"):  # keep artifacts/ pointing at the active set for restarts
            src = os.path.join(d, f)
            if os.path.exists(src) and os.path.abspath(src) != os.path.abspath(os.path.join(self.settings.model_dir, f)):
                import shutil
                shutil.copy(src, os.path.join(self.settings.model_dir, f))
        print(f"[ml] hot-swapped → {self.version} (AUROC {self.metrics.get('auroc', 'n/a')})")

    @staticmethod
    def encoded_features(result: "RiskResult") -> list[str]:
        return list(result.encoded.columns)

    # ---------- inference ----------
    def predict(self, features: dict) -> RiskResult:
        model, calib, explainer = self.model, self.calibrator, self._explainer  # local refs: safe across a hot-swap
        assert model is not None, "engine not initialised"
        X = self.to_frame(features)
        prob = float(model.predict_proba(X)[0, 1])
        if calib is not None:
            prob = float(np.clip(calib.predict([prob])[0], 0.001, 0.999))
        from services.shap_service import explain
        shap_values = explain(explainer, X)
        return RiskResult(probability=prob, base_rate=self.base_rate, shap_values=shap_values, encoded=X)


risk_engine = RiskEngine()
