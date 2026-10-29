from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models.patient import Patient
from models.clinical import ClinicalTask
from models.telemetry import ExpertReview, Prediction, VitalSign
from models.user import User, UserRole
from routers.patients import latest_vitals
from schemas.prediction import PredictionListItem, PredictRequest, PredictResponse, ReviewCreate, ReviewOut, ShapItem
from services import audit
from services.ml_engine import RECOMMENDATIONS, risk_engine, tier_for
from services.security import CLINICAL, can_access_patient, get_accessible_patient, get_current_user, patient_scope, require_roles
from services.shap_service import waterfall

router = APIRouter(prefix="/api/predictions", tags=["predictions"])

VITAL_KEYS = ["heart_rate", "resp_rate", "spo2", "fio2", "map_mmhg", "temperature", "ph", "pco2", "po2", "hco3", "base_excess", "lactate", "glucose", "hemoglobin", "wbc", "platelets", "crp", "sodium", "potassium", "creatinine", "bilirubin", "urine_output"]


def build_features(p: Patient, v, overrides: dict) -> dict:
    feats = {
        "gestational_age_wk": p.gestational_age_wk, "birth_weight_g": p.birth_weight_g, "sex": p.sex, "apgar_1": p.apgar_1, "apgar_5": p.apgar_5,
        "delivery_mode": p.delivery_mode, "age_hours": p.postnatal_age_h, "vent_mode": p.ventilation_mode,
    }
    if v:
        feats.update({k: getattr(v, k) for k in VITAL_KEYS if getattr(v, k) is not None})
    feats.update(overrides)
    return feats


@router.post("", response_model=PredictResponse)
async def predict(body: PredictRequest, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    p = await get_accessible_patient(db, user, body.patient_id)
    feats = build_features(p, await latest_vitals(db, p.id), body.overrides)
    result = risk_engine.predict(feats)
    shap_rows, base_pct = waterfall(result)
    pct = round(result.probability * 100)
    t = tier_for(pct)
    pred_id = None
    if body.persist:
        pred = Prediction(patient_id=p.id, model_version=risk_engine.version, risk_probability=result.probability, risk_tier=t, features=feats, shap_values=shap_rows, base_value=result.base_rate, created_by=user.id)
        db.add(pred)
        await db.flush()
        pred_id = pred.id
        await audit.record(db, user, "prediction.create", f"prediction:{pred.id}", {"patient": p.id, "risk": pct}, request)
        if t in ("high", "critical"):  # redline tracker: AI-generated shift task, deduplicated per patient
            open_ai = (await db.execute(select(ClinicalTask).where(ClinicalTask.patient_id == p.id, ClinicalTask.source == "ai", ClinicalTask.done.is_(False)))).scalars().first()
            if not open_ai:
                due = 30 if t == "critical" else 120
                db.add(ClinicalTask(hospital_id=p.hospital_id, patient_id=p.id, title=f"{RECOMMENDATIONS[t][0]} — {p.id} ({pct}% 24h risk)", priority=t, source="ai",
                                    created_by=user.id, due_at=datetime.now(timezone.utc) + timedelta(minutes=due), meta={"prediction_id": str(pred.id)}))
        await db.commit()
    return PredictResponse(prediction_id=pred_id, patient_id=p.id, model_version=risk_engine.version, risk_probability=result.probability, risk_percent=pct, risk_tier=t,
                           base_rate_percent=base_pct, shap=[ShapItem(**r) for r in shap_rows], recommendations=RECOMMENDATIONS[t], features=feats)


@router.get("", response_model=list[PredictionListItem])
async def list_predictions(limit: int = 50, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    q = patient_scope(select(Prediction).options(selectinload(Prediction.reviews)).join(Patient).order_by(Prediction.created_at.desc()).limit(limit), user)
    preds = (await db.execute(q)).scalars().all()
    return [PredictionListItem(id=pr.id, patient_id=pr.patient_id, risk_percent=round(pr.risk_probability * 100), risk_tier=pr.risk_tier, model_version=pr.model_version,
                               created_at=pr.created_at, review=ReviewOut.model_validate(pr.reviews[-1]) if pr.reviews else None) for pr in preds]


@router.get("/{prediction_id}")
async def get_prediction(prediction_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    pr = (await db.execute(select(Prediction).options(selectinload(Prediction.reviews)).where(Prediction.id == prediction_id))).scalar_one_or_none()
    if not pr or not can_access_patient(user, await db.get(Patient, pr.patient_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prediction not found")
    return {"id": pr.id, "patient_id": pr.patient_id, "model_version": pr.model_version, "risk_percent": round(pr.risk_probability * 100), "risk_tier": pr.risk_tier,
            "base_rate_percent": round(pr.base_value * 100), "shap": pr.shap_values, "features": pr.features, "created_at": pr.created_at,
            "reviews": [ReviewOut.model_validate(r) for r in pr.reviews]}


@router.post("/{prediction_id}/review", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
async def review(prediction_id: UUID, body: ReviewCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.neonatologist))):
    """Expert review loop: only neonatologists can sign off or flag a prediction."""
    pr = await db.get(Prediction, prediction_id)
    if not pr or not can_access_patient(user, await db.get(Patient, pr.patient_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prediction not found")
    rv = ExpertReview(prediction_id=prediction_id, reviewer_id=user.id, reviewer_name=user.full_name, status=body.status, note=body.note, observed_outcome=body.observed_outcome, confidence_flag=body.confidence_flag)
    db.add(rv)
    await audit.record(db, user, f"review.{body.status}", f"prediction:{prediction_id}", request=request)
    await db.commit()
    await db.refresh(rv)
    from services.retraining_engine import retraining_engine
    await retraining_engine.maybe_trigger_from_feedback()  # feedback-loop hook
    return rv


def _r(v, nd=0):
    return None if v is None else (round(v) if nd == 0 else round(v, nd))


@router.get("/timeline/{patient_id}")
async def timeline(patient_id: str, hours: int = 24, step_minutes: int = 60, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    """«Машина времени»: re-score the patient at each historical vitals sample so the doctor can replay how the
    risk evolved, when the alert would have fired (first crossing of 50 %), and when deterioration was observed."""
    p = await get_accessible_patient(db, user, patient_id)
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = (await db.execute(select(VitalSign).where(VitalSign.patient_id == patient_id, VitalSign.time >= since).order_by(VitalSign.time))).scalars().all()
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No vitals history for this patient")
    # carry-forward labs (lab rows are sparse), sample at step_minutes
    carried: dict = {}
    points, last_t = [], None
    for v in rows:
        for k in VITAL_KEYS:
            val = getattr(v, k)
            if val is not None:
                carried[k] = val
        if last_t and (v.time - last_t) < timedelta(minutes=step_minutes):
            continue
        last_t = v.time
        feats = build_features(p, None, {})
        feats.update(carried)
        r = risk_engine.predict(feats)
        pct = round(r.probability * 100)
        top = sorted(zip(risk_engine.encoded_features(r), r.shap_values), key=lambda x: -abs(x[1]))[:3]
        points.append({"time": v.time.isoformat(), "risk_percent": pct, "tier": tier_for(pct), "heart_rate": _r(carried.get("heart_rate")), "spo2": _r(carried.get("spo2")), "fio2": _r(carried.get("fio2")), "lactate": _r(carried.get("lactate"), 1),
                       "drivers": [k for k, _ in top]})
    alert = next((pt for pt in points if pt["risk_percent"] >= 50), None)
    event_at = p.event_at.isoformat() if p.event_at else None
    lead_h = round((p.event_at - datetime.fromisoformat(alert["time"])).total_seconds() / 3600, 1) if (alert and p.event_at) else None
    return {"patient_id": p.id, "points": points, "alert_at": alert["time"] if alert else None, "event_at": event_at, "event_label": p.event_label, "lead_time_hours": lead_h, "model_version": risk_engine.version}


@router.get("/stats/review")
async def review_stats(db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL, UserRole.analyst, UserRole.researcher))):
    """Counts only, so analysts may read it; doctors see their own hospital."""
    q = select(Prediction).options(selectinload(Prediction.reviews)).join(Patient)
    if user.role == UserRole.neonatologist:
        q = patient_scope(q, user)
    preds = (await db.execute(q)).scalars().all()
    approved = sum(1 for p in preds if p.reviews and p.reviews[-1].status == "approved")
    flagged = sum(1 for p in preds if p.reviews and p.reviews[-1].status == "flagged")
    return {"total": len(preds), "approved": approved, "flagged": flagged, "pending": len(preds) - approved - flagged, "agreement": round(approved / max(approved + flagged, 1), 3)}


# --------------------------------------------------------------------------- admission model
# Ported from the initial NeoOutcome repository: POST /predict/admission on the demo API.
from pydantic import BaseModel as _BM, Field as _F  # noqa: E402
from services.admission_engine import admission_engine  # noqa: E402


class AdmissionRequest(_BM):
    features: dict[str, float | str | None] = _F(default_factory=dict, description="15 admission-time maternal + birth features (Asfendiyarov contract)")
    patient_id: str | None = None
    persist: bool = False


@router.get("/admission/info")
async def admission_info(user: User = Depends(get_current_user)):
    """Feature contract, operating threshold and temporal-validation metrics of the admission model."""
    return admission_engine.info()


@router.post("/admission")
async def predict_admission(body: AdmissionRequest, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.neonatologist, UserRole.admin, UserRole.analyst, UserRole.researcher))):
    """Admission-time in-hospital mortality risk (XGBoost on the de-identified Asfendiyarov extract, temporal validation 2024–2025)."""
    if not admission_engine.ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Admission model is not loaded")
    try:
        result = admission_engine.predict(body.features)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    if body.persist and body.patient_id:
        p = await db.get(Patient, body.patient_id)
        if p and can_access_patient(user, p):  # the what-if score is open to analysts; writing to a chart is not
            pred = Prediction(patient_id=p.id, model_version=result["model_version"], risk_probability=result["risk_probability"],
                              risk_tier=tier_for(round(result["risk_probability"] * 100)), features={k: v for k, v in body.features.items() if v is not None},
                              shap_values=result["shap_values"], base_value=result["shap_base_probability"], created_by=user.id)
            db.add(pred)
            await db.flush()
            result["prediction_id"] = str(pred.id)
            await audit.record(db, user, "prediction.admission", f"prediction:{pred.id}", {"patient": p.id, "risk": result["risk_percent"]}, request)
            await db.commit()
    return result
