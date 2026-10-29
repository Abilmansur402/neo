from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.patient import Patient
from models.telemetry import VitalSign
from models.user import User, UserRole
from schemas.patient import PatientCreate, PatientOut, VitalsIn, VitalsOut
from services import audit
from services.security import CLINICAL, get_accessible_patient, patient_scope, require_roles

router = APIRouter(prefix="/api/patients", tags=["patients"])


async def latest_vitals(db: AsyncSession, patient_id: str) -> VitalSign | None:
    return (await db.execute(select(VitalSign).where(VitalSign.patient_id == patient_id).order_by(VitalSign.time.desc()).limit(1))).scalar_one_or_none()


def _out(p: Patient, v: VitalSign | None) -> PatientOut:
    out = PatientOut.model_validate(p)
    if v:
        vo = VitalsOut.model_validate(v)
        for k in ("heart_rate", "resp_rate", "spo2", "fio2", "map_mmhg", "po2", "pco2", "hemoglobin", "platelets", "sodium", "creatinine", "bilirubin"):
            if getattr(vo, k) is not None:
                setattr(vo, k, round(getattr(vo, k)))
        for k in ("temperature", "lactate", "base_excess", "glucose", "wbc", "crp", "potassium", "urine_output", "hco3"):
            if getattr(vo, k) is not None:
                setattr(vo, k, round(getattr(vo, k), 1))
        if vo.ph is not None:
            vo.ph = round(vo.ph, 2)
        out.latest_vitals = vo
    return out


@router.get("", response_model=list[PatientOut])
async def list_patients(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    patients = (await db.execute(patient_scope(select(Patient).order_by(Patient.id), user))).scalars().all()
    await audit.record(db, user, "patient.list", "patients", {"count": len(patients)}, request)
    await db.commit()
    return [_out(p, await latest_vitals(db, p.id)) for p in patients]


@router.get("/{patient_id}", response_model=PatientOut)
async def get_patient(patient_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    p = await get_accessible_patient(db, user, patient_id)
    await audit.record(db, user, "patient.read", f"patient:{patient_id}", request=request)
    await db.commit()
    return _out(p, await latest_vitals(db, patient_id))


@router.post("", response_model=PatientOut, status_code=status.HTTP_201_CREATED)
async def create_patient(body: PatientCreate, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    if user.role == UserRole.neonatologist and body.hospital_id != user.hospital_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Doctors can only admit patients to their own hospital")
    if await db.get(Patient, body.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Patient id already exists")
    p = Patient(**body.model_dump())
    db.add(p)
    await audit.record(db, user, "patient.create", f"patient:{p.id}", request=request)
    await db.commit()
    await db.refresh(p)
    return _out(p, None)


@router.get("/{patient_id}/vitals", response_model=list[VitalsOut])
async def vitals_history(patient_id: str, hours: int = 24, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(*CLINICAL))):
    await get_accessible_patient(db, user, patient_id)
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = (await db.execute(select(VitalSign).where(VitalSign.patient_id == patient_id, VitalSign.time >= since).order_by(VitalSign.time))).scalars().all()
    return rows


@router.post("/{patient_id}/vitals", response_model=VitalsOut, status_code=status.HTTP_201_CREATED)
async def add_vitals(patient_id: str, body: VitalsIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.neonatologist))):
    await get_accessible_patient(db, user, patient_id)
    v = VitalSign(time=datetime.now(timezone.utc), patient_id=patient_id, **body.model_dump())
    db.add(v)
    await audit.record(db, user, "vitals.write", f"patient:{patient_id}", {"source": body.source}, request)
    await db.commit()
    return v
