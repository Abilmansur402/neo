"""
Automated retraining orchestration.

Triggers
  • manual        POST /api/ml/retrain                     (analyst / admin)
  • dataset_upload  a new CSV lands in backend/data/uploads  (POST /api/ml/datasets/upload)
  • feedback_loop   N new clinician sign-offs since the last retrain (settings.retrain_feedback_threshold)
  • scheduler     optional: POST /api/ml/retrain from cron / deploy.sh

Flow
  gather data  →  validate schema (31 core features)  →  run_training (5-fold CV, final fit, calibration)
  →  evaluate against the active model's AUROC  →  register version (DB + artifacts/versions/<v>)
  →  hot-swap into RiskEngine (atomic, no restart)  →  optional S3 push
A version whose CV AUROC is below the active model by more than `min_auroc_delta` is registered as
`candidate` but NOT activated; an analyst can activate it explicitly or roll back at any time.
"""
from __future__ import annotations

import asyncio
import glob
import json
import os
import re
import shutil
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sqlalchemy import func, select, update

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from config import get_settings
from database import SessionLocal
from models.model_registry import ModelVersion
from models.telemetry import ExpertReview, Prediction
from services.ml_engine import ALL_FEATURES, RiskEngine, risk_engine

settings = get_settings()
DATA_DIR = Path(settings.model_dir).parent / "data" / "uploads"
VERSIONS_DIR = Path(settings.model_dir) / "versions"
POSITIVE_RE = re.compile(r"deteriorat|escalat|intubat|hfov|inotrop|transfer|sepsis|died|death|nec\b", re.I)
NEGATIVE_RE = re.compile(r"stable|stepped down|improv|discharg|room air", re.I)


@dataclass
class TrainState:
    status: str = "idle"          # idle | running | done | failed
    progress: int = 0
    stage: str = ""
    trigger: str = ""
    version: str = ""
    started_at: float | None = None
    finished_at: float | None = None
    rows: int = 0
    sources: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    activated: bool | None = None
    error: str = ""
    log: list[str] = field(default_factory=list)


def _run_in_private_loop(coro_factory):
    """Run DB work from the worker thread on its own event loop with its own engine/pool.
    The app's asyncpg pool belongs to the server loop and must never be touched from another loop."""
    async def wrapped():
        engine = create_async_engine(settings.database_url, poolclass=__import__("sqlalchemy.pool", fromlist=["NullPool"]).NullPool)
        Session = async_sessionmaker(engine, expire_on_commit=False)
        try:
            return await coro_factory(Session)
        finally:
            await engine.dispose()
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(wrapped())
    finally:
        loop.close()


class RetrainingEngine:
    def __init__(self) -> None:
        self.state = TrainState()
        self._lock = threading.Lock()
        self.min_auroc_delta = -0.02         # candidate must not be worse than active by more than 2 pp
        self.feedback_threshold = int(os.getenv("NEO_RETRAIN_FEEDBACK_THRESHOLD", "25"))
        self._reviews_at_last_retrain = 0

    # ---------------- public API ----------------
    def status(self) -> dict:
        s = asdict(self.state)
        s["log"] = s["log"][-40:]
        s["feedback"] = {"threshold": self.feedback_threshold, "since_last_retrain": None}
        return s

    def start(self, trigger: str, user_id: str | None = None, notes: str = "", auto_activate: bool = True) -> bool:
        """Kick off a background training thread. Returns False if one is already running."""
        with self._lock:
            if self.state.status == "running":
                return False
            self.state = TrainState(status="running", trigger=trigger, started_at=time.time(), stage="queued")
        threading.Thread(target=self._run, args=(trigger, user_id, notes, auto_activate), daemon=True).start()
        return True

    async def maybe_trigger_from_feedback(self) -> bool:
        """Called after every clinician sign-off: retrain once `feedback_threshold` new reviews have accrued."""
        async with SessionLocal() as db:
            total = (await db.execute(select(func.count()).select_from(ExpertReview))).scalar() or 0
        if total - self._reviews_at_last_retrain >= self.feedback_threshold and self.state.status != "running":
            self._reviews_at_last_retrain = total
            return self.start("feedback_loop", notes=f"{total} clinician sign-offs accumulated")
        return False

    # ---------------- data gathering ----------------
    def _gather(self) -> tuple[pd.DataFrame, np.ndarray, list[str]]:
        from ml.train_tabular import LABEL, encode
        frames, labels, sources = [], [], []
        # 1. baseline cohort (PIC-shaped synthetic until the PIC extract is dropped in uploads/)
        Xb, yb, src = RiskEngine.baseline_cohort()
        frames.append(Xb); labels.append(yb); sources.append(src)
        # 2. uploaded retrospective datasets
        for f in sorted(glob.glob(str(DATA_DIR / "*.csv")) + glob.glob(str(DATA_DIR / "*.parquet"))):
            raw = pd.read_parquet(f) if f.endswith(".parquet") else pd.read_csv(f)
            if LABEL not in raw:
                self._log(f"skip {os.path.basename(f)}: no '{LABEL}' column"); continue
            frames.append(encode(raw)); labels.append(raw[LABEL].astype(int).to_numpy()); sources.append(f"{os.path.basename(f)} (n={len(raw)})")
        # 3. clinician feedback: reviewed predictions whose observed outcome is explicit become labelled rows
        fb_rows, fb_y = [], []
        preds = _run_in_private_loop(self._reviewed_predictions)
        for feats, outcome, status in preds:
            label = 1 if POSITIVE_RE.search(outcome or "") else 0 if NEGATIVE_RE.search(outcome or "") else None
            if label is None:
                continue
            fb_rows.append({k: feats.get(k) for k in ALL_FEATURES}); fb_y.append(label)
        if fb_rows:
            fb = pd.DataFrame(fb_rows)
            fb["deteriorated_24h"] = fb_y
            frames.append(encode(fb)); labels.append(np.array(fb_y)); sources.append(f"clinician_feedback (n={len(fb_y)})")
        X = pd.concat(frames, ignore_index=True)[ALL_FEATURES]
        y = np.concatenate(labels)
        return X, y, sources

    async def _reviewed_predictions(self, Session):
        async with Session() as db:
            rows = (await db.execute(select(Prediction.features, ExpertReview.observed_outcome, ExpertReview.status).join(ExpertReview, ExpertReview.prediction_id == Prediction.id))).all()
        return [(r[0] or {}, r[1], r[2]) for r in rows]

    # ---------------- versioning ----------------
    @staticmethod
    def _next_version(existing: list[str], trigger: str) -> str:
        """Semantic version: feedback/upload bump minor, manual bumps patch. Suffix marks the data mix."""
        best = (1, 0, 0)
        for v in existing:
            m = re.match(r"v(\d+)\.(\d+)\.(\d+)", v)
            if m:
                best = max(best, tuple(int(x) for x in m.groups()))
        major, minor, patch = best
        if trigger in ("dataset_upload", "feedback_loop"):
            minor, patch = minor + 1, 0
        else:
            patch += 1
        return f"v{major}.{minor}.{patch}-kz-local"

    # ---------------- worker ----------------
    def _log(self, msg: str) -> None:
        self.state.log.append(f"{datetime.now(timezone.utc).strftime('%H:%M:%S')} {msg}")

    def _progress(self, pct: int, stage: str) -> None:
        self.state.progress, self.state.stage = pct, stage

    def _run(self, trigger: str, user_id: str | None, notes: str, auto_activate: bool) -> None:
        from ml.train_tabular import run_training
        try:
            self._progress(2, "gathering data")
            existing = _run_in_private_loop(self._existing_versions)
            version = self._next_version(existing, trigger)
            self.state.version = version
            X, y, sources = self._gather()
            self.state.rows, self.state.sources = int(len(y)), sources
            self._log(f"{version} · {len(y)} rows from {len(sources)} sources")
            self._progress(4, "validating schema")
            missing = [c for c in ALL_FEATURES if c not in X.columns]
            if missing:
                raise ValueError(f"schema validation failed, missing: {missing}")
            out = VERSIONS_DIR / version
            meta = run_training(X, y, out, version, " + ".join(sources), progress=self._progress, log=self._log)
            self.state.metrics = meta["metrics"]
            # evaluate vs active
            active_auroc = float(risk_engine.metrics.get("auroc") or 0)
            delta = meta["metrics"]["auroc"] - active_auroc
            ok = delta >= self.min_auroc_delta
            self._log(f"AUROC {meta['metrics']['auroc']:.3f} vs active {active_auroc:.3f} (Δ {delta:+.3f}) → {'activate' if ok and auto_activate else 'keep as candidate'}")
            _run_in_private_loop(lambda S: self._register(S, version, out, trigger, user_id, notes, meta, activate=ok and auto_activate))
            if ok and auto_activate:
                risk_engine.hot_swap(out)
                self.state.activated = True
            else:
                self.state.activated = False
            from ml import registry
            if registry.configured():
                try:
                    registry.push("xgb-24h", version, out); self._log("pushed to S3 registry")
                    _run_in_private_loop(lambda S: self._mark_pushed(S, version))
                except Exception as exc:
                    self._log(f"S3 push failed: {exc.__class__.__name__}")
            self.state.status, self.state.stage, self.state.progress = "done", "done", 100
        except Exception as exc:
            self.state.status, self.state.error = "failed", f"{exc.__class__.__name__}: {exc}"
            self._log(self.state.error)
            try:
                _run_in_private_loop(lambda S: self._register(S, f"{self.state.version or 'run'}-failed-{int(time.time())}", Path("-"), trigger, user_id, notes, {"metrics": {}, "data_source": "", "n": 0, "feature_importance": {}}, activate=False, status="failed"))
            except Exception:
                pass
        finally:
            self.state.finished_at = time.time()

    async def _existing_versions(self, Session) -> list[str]:
        async with Session() as db:
            return list((await db.execute(select(ModelVersion.version))).scalars().all())

    async def _register(self, Session, version, path, trigger, user_id, notes, meta, activate: bool, status: str | None = None) -> None:
        async with Session() as db:
            if activate:
                await db.execute(update(ModelVersion).where(ModelVersion.active.is_(True)).values(active=False, status="archived"))
            db.add(ModelVersion(version=version, path=str(path), status=status or ("active" if activate else "candidate"), active=activate, trigger=trigger, data_source=meta.get("data_source", ""),
                                n_rows=meta.get("n", 0), metrics=meta.get("metrics", {}), feature_importance=meta.get("feature_importance", {}), notes=notes, trained_by=user_id))
            await db.commit()

    async def _mark_pushed(self, Session, version: str) -> None:
        async with Session() as db:
            await db.execute(update(ModelVersion).where(ModelVersion.version == version).values(pushed_to_s3=True)); await db.commit()

    # ---------------- rollback / activate ----------------
    async def activate(self, version: str, reason: str = "") -> dict:
        async with SessionLocal() as db:
            mv = (await db.execute(select(ModelVersion).where(ModelVersion.version == version))).scalar_one_or_none()
            if not mv or not Path(mv.path).exists():
                raise FileNotFoundError(f"version {version} not found on disk")
            await db.execute(update(ModelVersion).where(ModelVersion.active.is_(True)).values(active=False, status="rolled_back" if reason else "archived"))
            mv.active, mv.status = True, "active"
            if reason:
                mv.notes = (mv.notes + f"\nactivated: {reason}").strip()
            await db.commit()
            risk_engine.hot_swap(Path(mv.path))
            return {"version": mv.version, "metrics": mv.metrics, "active": True}

    async def bootstrap_registry(self) -> None:
        """Make sure the model that is in memory at start-up is represented in the registry."""
        async with SessionLocal() as db:
            if (await db.execute(select(func.count()).select_from(ModelVersion))).scalar():
                return
            path = VERSIONS_DIR / "v1.0.0-bootstrap"
            path.mkdir(parents=True, exist_ok=True)
            for f in ("xgb-24h.json", "xgb-24h.meta.json", "xgb-24h.calib.joblib"):
                src = Path(settings.model_dir) / f
                if src.exists():
                    shutil.copy(src, path / f)
            db.add(ModelVersion(version="v1.0.0-bootstrap", path=str(path), status="active", active=True, trigger="bootstrap", data_source="start-up model", n_rows=0, metrics=risk_engine.metrics, notes="model loaded at first start"))
            await db.commit()


retraining_engine = RetrainingEngine()
