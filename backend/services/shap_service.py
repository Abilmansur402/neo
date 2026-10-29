"""SHAP TreeExplainer wrapper producing waterfall-ready attributions."""
from __future__ import annotations

import numpy as np
import pandas as pd
import shap

from services import ml_engine as me


def build_explainer(model):
    return shap.TreeExplainer(model)


def explain(explainer, X: pd.DataFrame) -> np.ndarray:
    values = explainer.shap_values(X)
    if isinstance(values, list):  # older shap returns per-class list
        values = values[1]
    return np.asarray(values)[0]


def _sigmoid(z: float) -> float:
    return 1.0 / (1.0 + np.exp(-z))


def waterfall(result: "me.RiskResult", top_k: int = 10) -> tuple[list[dict], int]:
    """Convert log-odds SHAP values to percentage-point contributions.

    The allocation preserves sum(pp) == (p - base) * 100 so the chart walks exactly
    from the base rate to the final probability.
    """
    base_pct = round(result.base_rate * 100)
    delta_pp = (result.probability - result.base_rate) * 100.0
    sv = result.shap_values
    total = float(np.sum(sv)) or 1e-9
    rows = []
    for i, feat in enumerate(me.ALL_FEATURES):
        raw = result.encoded.iloc[0][feat]
        if feat in me.CATEGORICAL_FEATURES:
            value = me.CATEGORICAL_FEATURES[feat][int(raw)]
        else:
            value = None if pd.isna(raw) else round(float(raw), 2)
        rows.append({"feature": feat, "label": me.LABELS[feat], "value": value, "shap": float(sv[i]), "pp": float(sv[i] / total * delta_pp)})
    rows.sort(key=lambda r: abs(r["pp"]), reverse=True)
    head = rows[:top_k]
    tail_pp = sum(r["pp"] for r in rows[top_k:])
    tail_shap = sum(r["shap"] for r in rows[top_k:])
    if rows[top_k:]:
        head.append({"feature": "other", "label": f"{len(rows) - top_k} other features", "value": "—", "shap": tail_shap, "pp": tail_pp})
    return head, base_pct
