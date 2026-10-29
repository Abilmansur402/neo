"""NeoOutcome AI — FastAPI application entry point."""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from database import SessionLocal, init_db
from routers import analytics, auth, computer_vision, integration, intake, maternal, ml_ops, patients, predictions, tasks
from services.ml_engine import risk_engine
from services.admission_engine import admission_engine

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if settings.seed_demo_data:
        from services.seed import seed
        async with SessionLocal() as db:
            await seed(db)
    # Pull published artifacts from the S3 registry (no-op when NEO_S3_* is unset or nothing is published)
    from ml import registry
    if registry.configured():
        for name in ("xgb-24h", "cxr-v1", "cus-v1"):
            await asyncio.to_thread(registry.pull, name, settings.model_dir)
    await asyncio.to_thread(risk_engine.load_or_train)
    await asyncio.to_thread(admission_engine.load_or_train)
    from services.retraining_engine import retraining_engine
    await retraining_engine.bootstrap_registry()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="NICU Clinical Decision Support & Computer Vision Telemetry Platform — Kazakhstan pilot edition.",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

for r in (auth.router, patients.router, predictions.router, computer_vision.router, integration.router, analytics.router, maternal.router, tasks.router, ml_ops.router, intake.router):
    app.include_router(r)


@app.get("/api/health", tags=["system"])
async def health():
    return {"status": "ok", "app": settings.app_name, "version": settings.app_version, "model": risk_engine.version, "model_metrics": risk_engine.metrics, "calibrated": risk_engine.calibrator is not None, "admission_model": {"ready": admission_engine.ready, "auroc": admission_engine.metrics.get("auroc"), "threshold": round(admission_engine.threshold, 4)}, "environment": settings.environment}
