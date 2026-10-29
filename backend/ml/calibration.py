"""Probability calibrators shared by training (ml/train_tabular.py) and inference (services/ml_engine.py)."""
from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression


class PlattCalibrator:
    """Sigmoid calibration p' = σ(a·logit(p) + b). Picklable; exposes .predict like IsotonicRegression."""

    def fit(self, p: np.ndarray, y: np.ndarray):
        p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
        self.lr = LogisticRegression(C=1e6).fit(np.log(p / (1 - p)).reshape(-1, 1), y)
        return self

    def predict(self, p):
        p = np.clip(np.asarray(p, dtype=float), 1e-6, 1 - 1e-6)
        return self.lr.predict_proba(np.log(p / (1 - p)).reshape(-1, 1))[:, 1]
