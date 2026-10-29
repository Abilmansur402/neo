import asyncio
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from database import SessionLocal, get_db
from models.patient import Patient
from models.user import User
from routers.patients import latest_vitals
from services.cv_engine import CUS_CLASSES, CXR_CLASSES, NFCS_ITEMS, TORCH_AVAILABLE, TelemetrySynthesizer, analyze_image
from services.security import get_current_user, get_ws_user

router = APIRouter(prefix="/api/cv", tags=["computer-vision"])
settings = get_settings()


@router.get("/models")
async def models_info(user: User = Depends(get_current_user)):
    return {
        "telemetry": {"model": "nfcs-v2", "runtime": "edge (TensorRT) · simulated here", "nfcs_items": NFCS_ITEMS, "hz": settings.telemetry_hz},
        "cxr": {"model": "cxr-v1 (DenseNet-121 fine-tune)", "classes": [c[1] for c in CXR_CLASSES]},
        "cus": {"model": "cus-v1", "classes": [c[1] for c in CUS_CLASSES]},
        "gradcam_backend": "torch" if TORCH_AVAILABLE else "opencv-saliency",
        "trained_weights": {k: os.path.exists(os.path.join(settings.model_dir, f"{k}-v1.pt")) for k in ("cxr", "cus")},
    }


@router.post("/imaging/analyze")
async def analyze(modality: str = Form(pattern="^(cxr|cus)$"), target: int | None = Form(default=None), alpha: float = Form(default=0.55), file: UploadFile = File(...), user: User = Depends(get_current_user)):
    """Upload a chest X-ray (`cxr`) or cranial ultrasound (`cus`) PNG/JPEG; returns class probabilities and a Grad-CAM overlay."""
    if file.content_type not in {"image/png", "image/jpeg", "image/jpg", "application/dicom", "application/octet-stream"}:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload PNG or JPEG")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Max 20 MB")
    try:
        return await asyncio.to_thread(analyze_image, data, modality, target, alpha)
    except Exception as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Could not decode image: {exc}")


@router.websocket("/ws/telemetry/{patient_id}")
async def telemetry_ws(websocket: WebSocket, patient_id: str):
    """Streams TelemetryFrame JSON at `settings.telemetry_hz`. Auth: ?token=<jwt>."""
    user = await get_ws_user(websocket)
    if not user:
        await websocket.close(code=4401)
        return
    async with SessionLocal() as db:
        p = await db.get(Patient, patient_id)
        if not p:
            await websocket.close(code=4404)
            return
        v = await latest_vitals(db, patient_id)
    synth = TelemetrySynthesizer({
        "id": p.id, "heart_rate": (v.heart_rate if v and v.heart_rate else 150), "resp_rate": (v.resp_rate if v and v.resp_rate else 55),
        "spo2": (v.spo2 if v and v.spo2 else 95), "nfcs": p.nfcs, "skin_temp_c": p.skin_temp_c,
    })
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({"type": "telemetry", "patient_id": patient_id, "frame": synth.as_dict(synth.next_frame())})
            await asyncio.sleep(1.0 / settings.telemetry_hz)
    except WebSocketDisconnect:
        return
