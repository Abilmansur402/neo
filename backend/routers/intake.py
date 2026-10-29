"""Patient intake: bundle import (CSV/JSON), synthetic demo bundle, PDF patient card, appointments.

Ported from the initial NeoOutcome repository (intake page + demo API + Supabase appointments)
and re-homed on the FastAPI/Postgres stack with JWT roles and audit logging.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.clinical import Appointment
from models.patient import Patient
from models.telemetry import Prediction
from models.user import Hospital, User, UserRole
from routers.patients import latest_vitals
from services import audit
from services.patient_card import (
    EXPECTED_FEATURES,
    FEATURE_LABELS,
    FEATURE_UNITS,
    bundle_from_patient,
    parse_bundle_upload,
    render_patient_pdf,
    score_bundle,
    synthetic_patient,
)
from services.security import CLINICAL, get_accessible_patient, get_current_user, require_roles

router = APIRouter(prefix="/api/intake", tags=["intake"])
CLINICIANS = require_roles(UserRole.neonatologist, UserRole.admin, UserRole.researcher)


# ----------------------------------------------------------------------------- bundles
@router.get("/contract")
async def contract(user: User = Depends(get_current_user)):
    """The 31-feature 12-hour aggregate contract accepted by the importer."""
    return {"features": [{"key": k, "label": FEATURE_LABELS[k], "unit": FEATURE_UNITS.get(k, "")} for k in EXPECTED_FEATURES],
            "formats": ["JSON bundle {patient, encounter, features}", "CSV wide (one header row)", "CSV long (feature,value)"],
            "note": "Персональные данные не загружать: только обезличенные идентификаторы и признаки."}


@router.get("/demo")
async def demo_bundle(user: User = Depends(get_current_user)):
    """Synthetic SYN-NICU-0001 encounter scored by the live model."""
    return score_bundle(synthetic_patient())


class BundleIn(BaseModel):
    bundle: dict


@router.post("/score")
async def score(body: BundleIn, user: User = Depends(CLINICIANS)):
    try:
        return score_bundle(body.bundle)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.post("/import")
async def import_bundle(request: Request, file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user: User = Depends(CLINICIANS)):
    """Upload a CSV or JSON bundle, validate it against the contract and score it."""
    content = await file.read()
    if len(content) > 2_000_000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Файл больше 2 МБ")
    try:
        bundle = parse_bundle_upload(file.filename or "upload.csv", content)
        lowered = {k.lower() for k in bundle.get("features", {})}
        pii = lowered & {"name", "фио", "iin", "иин", "phone", "телефон", "address", "адрес", "passport", "паспорт"}
        if pii:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Файл содержит персональные поля: {', '.join(sorted(pii))}. Удалите их перед загрузкой.")
        scored = score_bundle(bundle)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    await audit.record(db, user, "intake.import", f"bundle:{scored['patient'].get('patient_id')}", {"file": file.filename, "risk": scored["prediction"]["risk_percent"], "missing": len(scored["prediction"]["missing_features"])}, request)
    await db.commit()
    return scored


@router.post("/card.pdf")
async def card_from_bundle(body: BundleIn, user: User = Depends(get_current_user)):
    """Render a PDF patient card from a (scored or unscored) bundle."""
    bundle = body.bundle if body.bundle.get("prediction") else score_bundle(body.bundle)
    pdf = render_patient_pdf(bundle)
    pid = bundle.get("patient", {}).get("patient_id", "patient")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{pid}_patient_card.pdf"'})


@router.get("/patients/{patient_id}/card.pdf")
async def card_for_patient(patient_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    p = await get_accessible_patient(db, user, patient_id)
    v = await latest_vitals(db, p.id)
    pred = (await db.execute(select(Prediction).where(Prediction.patient_id == p.id).order_by(Prediction.created_at.desc()).limit(1))).scalar_one_or_none()
    h = await db.get(Hospital, p.hospital_id)
    bundle = bundle_from_patient(p, v, pred, h.name if h else p.hospital_id)
    pdf = render_patient_pdf(bundle)
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{p.id}_patient_card.pdf"'})


# ----------------------------------------------------------------------------- appointments
class AppointmentIn(BaseModel):
    patient_ref: str = Field(min_length=1, max_length=64)
    patient_label: str = Field(min_length=1, max_length=200)
    scheduled_at: datetime
    appointment_type: str = Field(default="re-examination", pattern="^(re-examination|consultation|transfer|family|other)$")
    reason: str = Field(min_length=2, max_length=2000)
    clinician_name: str = Field(min_length=2, max_length=120)


class AppointmentOut(AppointmentIn):
    id: UUID
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/appointments", response_model=list[AppointmentOut])
async def list_appointments(patient_ref: str | None = None, db: AsyncSession = Depends(get_db), user: User = Depends(CLINICIANS)):
    q = select(Appointment).where(Appointment.hospital_id == user.hospital_id) if user.role == UserRole.admin else select(Appointment).where(Appointment.created_by == user.id)
    if patient_ref:
        q = q.where(Appointment.patient_ref == patient_ref)
    rows = (await db.execute(q.order_by(Appointment.scheduled_at.asc()))).scalars().all()
    return rows


@router.post("/appointments", response_model=AppointmentOut, status_code=status.HTTP_201_CREATED)
async def create_appointment(body: AppointmentIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(CLINICIANS)):
    if body.scheduled_at.tzinfo is None:
        body.scheduled_at = body.scheduled_at.replace(tzinfo=timezone.utc)
    a = Appointment(hospital_id=user.hospital_id, created_by=user.id, **body.model_dump())
    db.add(a)
    await db.flush()
    await audit.record(db, user, "appointment.create", f"appointment:{a.id}", {"patient_ref": a.patient_ref, "type": a.appointment_type}, request)
    await db.commit()
    await db.refresh(a)
    return a


class AppointmentPatch(BaseModel):
    status: str = Field(pattern="^(scheduled|completed|cancelled)$")


@router.patch("/appointments/{appointment_id}", response_model=AppointmentOut)
async def patch_appointment(appointment_id: UUID, body: AppointmentPatch, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(CLINICIANS)):
    a = await db.get(Appointment, appointment_id)
    if not a or (a.created_by != user.id and not (user.role == UserRole.admin and a.hospital_id == user.hospital_id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    a.status = body.status
    await audit.record(db, user, "appointment.update", f"appointment:{a.id}", {"status": body.status}, request)
    await db.commit()
    await db.refresh(a)
    return a
