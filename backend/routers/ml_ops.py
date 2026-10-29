"""MLOps: retraining triggers, progress, version registry, rollback, dataset ingestion."""
import io
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.model_registry import ModelVersion
from models.user import User, UserRole
from services import audit
from services.ml_engine import ALL_FEATURES, RiskEngine, risk_engine
from services.retraining_engine import DATA_DIR, retraining_engine
from services.security import get_current_user, require_roles

router = APIRouter(prefix="/api/ml", tags=["ml-ops"])
MLOPS = require_roles(UserRole.analyst, UserRole.admin, UserRole.researcher)


class RetrainIn(BaseModel):
    notes: str = ""
    auto_activate: bool = True


class RollbackIn(BaseModel):
    version: str
    reason: str = "manual rollback"


@router.post("/retrain", status_code=status.HTTP_202_ACCEPTED)
async def retrain(body: RetrainIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(MLOPS)):
    """Start a background retraining run. Returns 409 if one is already running."""
    if not retraining_engine.start("manual", str(user.id), body.notes, body.auto_activate):
        raise HTTPException(status.HTTP_409_CONFLICT, "A training run is already in progress")
    await audit.record(db, user, "ml.retrain", "model:xgb-24h", {"trigger": "manual"}, request)
    await db.commit()
    return retraining_engine.status()


@router.get("/status")
async def status_(user: User = Depends(get_current_user)):
    s = retraining_engine.status()
    s["active"] = {"version": risk_engine.version, "metrics": risk_engine.metrics, "calibrated": risk_engine.calibrator is not None}
    return s


@router.get("/versions")
async def versions(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(ModelVersion).order_by(ModelVersion.trained_at.desc()))).scalars().all()
    return [{"id": str(r.id), "version": r.version, "status": r.status, "active": r.active, "trigger": r.trigger, "data_source": r.data_source, "n_rows": r.n_rows, "metrics": r.metrics,
             "top_features": sorted(r.feature_importance.items(), key=lambda kv: -kv[1])[:8], "trained_at": r.trained_at, "notes": r.notes, "pushed_to_s3": r.pushed_to_s3} for r in rows]


@router.post("/rollback")
async def rollback(body: RollbackIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(MLOPS)):
    """Activate a previous (or candidate) version and hot-swap it into memory."""
    try:
        result = await retraining_engine.activate(body.version, body.reason)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    await audit.record(db, user, "ml.rollback", f"model:{body.version}", {"reason": body.reason}, request)
    await db.commit()
    return result


@router.post("/datasets/upload", status_code=status.HTTP_202_ACCEPTED)
async def upload_dataset(request: Request, file: UploadFile = File(...), retrain_now: bool = True, db: AsyncSession = Depends(get_db), user: User = Depends(MLOPS)):
    """Ingest a de-identified retrospective CSV/Parquet. Validates the schema, stores it, and (by default) triggers retraining."""
    import pandas as pd
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", file.filename or "dataset.csv")
    if not name.endswith((".csv", ".parquet")):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a .csv or .parquet file")
    data = await file.read()
    try:
        df = pd.read_parquet(io.BytesIO(data)) if name.endswith(".parquet") else pd.read_csv(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Could not parse file: {exc}")
    present = [c for c in ALL_FEATURES if c in df.columns]
    missing = [c for c in ALL_FEATURES if c not in df.columns]
    if "deteriorated_24h" not in df.columns:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Missing label column 'deteriorated_24h' (0/1)")
    if len(present) < 20:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Only {len(present)}/31 core features present; map columns in the schema mapper first. Missing: {missing[:10]}")
    pii = [c for c in df.columns if re.search(r"name|фио|iin|иин|phone|телефон|address|адрес", c, re.I)]
    if pii:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Possible identifiers found, de-identify first: {pii}")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / name).write_bytes(data)
    await audit.record(db, user, "dataset.upload", f"dataset:{name}", {"rows": len(df), "features": len(present), "prevalence": round(float(df["deteriorated_24h"].mean()), 3)}, request)
    await db.commit()
    started = retraining_engine.start("dataset_upload", str(user.id), f"uploaded {name}") if retrain_now else False
    return {"file": name, "rows": len(df), "features_present": len(present), "missing": missing, "prevalence": round(float(df["deteriorated_24h"].mean()), 3), "retrain_started": started}


@router.get("/datasets")
async def list_datasets(user: User = Depends(get_current_user)):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return [{"file": p.name, "size_kb": round(p.stat().st_size / 1024, 1), "modified": p.stat().st_mtime} for p in sorted(Path(DATA_DIR).glob("*")) if p.suffix in (".csv", ".parquet")]


@router.get("/provenance")
async def provenance(user: User = Depends(get_current_user)):
    """Single source of truth for every 'where does this come from' pill in the UI."""
    m = RiskEngine.baseline_manifest() or {}
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    uploads = [p.name for p in sorted(Path(DATA_DIR).glob("*")) if p.suffix in (".csv", ".parquet")]
    return {
        "tabular": {"model_version": risk_engine.version, "trained_on": risk_engine.data_source or m.get("origin_label", "n/a"), "n": m.get("rows"), "features": 31,
                    "baseline": {"origin": m.get("origin", "none"), "label": m.get("origin_label"), "rows": m.get("rows"), "sha256": (m.get("sha256") or "")[:12], "is_synthetic": m.get("origin") == "synthetic", "replace_with": m.get("replace_with")},
                    "uploads": uploads, "calibrated": risk_engine.calibrator is not None, "metrics": risk_engine.metrics},
        "telemetry": {"status": "simulated", "label": "Simulated WebSocket frames · pending clinical retrospective validation"},
        "imaging": {"status": "simulated", "label": "Grad-CAM on synthetic studies; uploaded films are scored by the untrained demo CNN until cxr-v1/cus-v1 weights are trained"},
        "maternal": {"status": "scorecard", "label": "Transparent logistic scorecard (literature odds ratios) · screening aid, not a diagnosis"},
    }
