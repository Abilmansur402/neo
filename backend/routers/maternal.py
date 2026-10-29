"""Portal 3 · Mothers / families. Strict isolation: a mother sees only her own record and her baby's log."""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models.clinical import BabyEntry, MaternalRecord, MotherCheckin
from models.patient import Patient
from models.user import User, UserRole
from services import audit
from services.maternal_risk import score
from services.security import get_accessible_patient, get_current_user, require_roles

router = APIRouter(prefix="/api/maternal", tags=["maternal"])


class MaternalIn(BaseModel):
    maternal_age: int = Field(ge=12, le=60)
    gravidity: int = Field(default=1, ge=0, le=20)
    parity: int = Field(default=0, ge=0, le=20)
    gestational_age_wk: float = Field(ge=4, le=44)
    bmi: float = Field(ge=12, le=70)
    bp_systolic: int = Field(ge=60, le=260)
    bp_diastolic: int = Field(ge=30, le=160)
    pre_eclampsia: bool = False
    gestational_diabetes: bool = False
    chronic_hypertension: bool = False
    antenatal_steroids: bool = False
    magnesium_sulfate: bool = False
    prom_hours: float = Field(default=0, ge=0, le=500)
    chorioamnionitis: bool = False
    multiple_gestation: bool = False
    smoking: bool = False
    hemoglobin: float = Field(default=120, ge=30, le=220)
    planned_delivery_mode: str = Field(default="vaginal", pattern="^(vaginal|cesarean)$")


class MaternalOut(MaternalIn):
    id: UUID
    patient_id: str | None
    updated_at: datetime
    risk: dict

    model_config = {"from_attributes": True}


class BabyEntryOut(BaseModel):
    id: UUID
    day: int
    weight_g: int | None
    feeding: str | None
    respiratory_support: str | None
    milestone: str | None
    note_for_family: str
    created_at: datetime

    model_config = {"from_attributes": True}


class BabyEntryIn(BaseModel):
    patient_id: str
    day: int = Field(ge=0, le=365)
    weight_g: int | None = None
    feeding: str | None = None
    respiratory_support: str | None = None
    milestone: str | None = None
    note_for_family: str = ""


def _out(rec: MaternalRecord) -> MaternalOut:
    data = {c.name: getattr(rec, c.name) for c in MaternalRecord.__table__.columns}
    return MaternalOut(**data, risk=score(data))


async def _own_record(db: AsyncSession, user: User) -> MaternalRecord | None:
    return (await db.execute(select(MaternalRecord).where(MaternalRecord.user_id == user.id).order_by(MaternalRecord.updated_at.desc()).limit(1))).scalar_one_or_none()


@router.get("/me", response_model=MaternalOut | None)
async def my_record(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.mother))):
    rec = await _own_record(db, user)
    await audit.record(db, user, "maternal.read", f"user:{user.id}", request=request)
    await db.commit()
    return _out(rec) if rec else None


@router.put("/me", response_model=MaternalOut)
async def upsert_record(body: MaternalIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.mother))):
    rec = await _own_record(db, user)
    if rec is None:
        rec = MaternalRecord(user_id=user.id, hospital_id=user.hospital_id, **body.model_dump())
        db.add(rec)
    else:
        for k, v in body.model_dump().items():
            setattr(rec, k, v)
    await audit.record(db, user, "maternal.write", f"user:{user.id}", request=request)
    await db.commit()
    await db.refresh(rec)
    return _out(rec)


@router.post("/screen")
async def screen(body: MaternalIn, user: User = Depends(get_current_user)):
    """Stateless maternal risk screen (also used by doctors for antenatal counselling)."""
    return score(body.model_dump())


# ----------------------------------------------------------------------------- postpartum self-check
# WHO postnatal danger signs for the mother (recommendations on maternal and newborn care for a positive
# postnatal experience, 2022). Any one of them means: call an ambulance now, do not wait for a reply.
DANGER_SIGNS = {"bleeding", "fever", "headache_vision", "seizure", "breathing_chest", "abdominal_pain", "discharge", "leg_swelling", "self_harm"}


class CheckinIn(BaseModel):
    mood: int = Field(ge=1, le=5)
    flags: list[str] = Field(default_factory=list, max_length=len(DANGER_SIGNS))
    note: str = Field(default="", max_length=1000)


def _checkin_out(c: MotherCheckin) -> dict:
    return {"id": str(c.id), "mood": c.mood, "flags": c.flags, "note": c.note, "created_at": c.created_at, "urgent": bool(c.flags)}


@router.get("/checkins")
async def my_checkins(db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.mother))):
    rows = (await db.execute(select(MotherCheckin).where(MotherCheckin.user_id == user.id).order_by(MotherCheckin.created_at.desc()).limit(14))).scalars().all()
    return [_checkin_out(c) for c in rows]


@router.post("/checkins", status_code=status.HTTP_201_CREATED)
async def add_checkin(body: CheckinIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.mother))):
    unknown = set(body.flags) - DANGER_SIGNS
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown signs: {', '.join(sorted(unknown))}")
    c = MotherCheckin(user_id=user.id, mood=body.mood, flags=sorted(set(body.flags)), note=body.note)
    db.add(c)
    await audit.record(db, user, "maternal.checkin", f"user:{user.id}", request=request)  # her answers stay out of the audit trail
    await db.commit()
    await db.refresh(c)
    return _checkin_out(c)


@router.get("/baby", response_model=list[BabyEntryOut])
async def my_baby(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.mother))):
    rec = await _own_record(db, user)
    if not rec or not rec.patient_id:
        return []
    rows = (await db.execute(select(BabyEntry).where(BabyEntry.patient_id == rec.patient_id).order_by(BabyEntry.day))).scalars().all()
    await audit.record(db, user, "baby.read", f"patient:{rec.patient_id}", request=request)
    await db.commit()
    return rows


@router.get("/baby/summary")
async def baby_summary(db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.mother))):
    """Family-facing summary of the newborn: no raw risk scores, only status and plain-language fields."""
    rec = await _own_record(db, user)
    if not rec or not rec.patient_id:
        return None
    p = await db.get(Patient, rec.patient_id)
    if not p:
        return None
    last_day = (await db.execute(select(func.max(BabyEntry.day)).where(BabyEntry.patient_id == p.id))).scalar() or 0
    return {"patient_id": p.id, "diagnosis": p.diagnosis, "gestational_age_wk": p.gestational_age_wk, "birth_weight_g": p.birth_weight_g, "sex": p.sex, "day_of_life": max(1, p.postnatal_age_h // 24 + 1, last_day),
            "respiratory_support": p.ventilation_mode, "bed": p.bed, "hospital_id": p.hospital_id}


@router.post("/baby", response_model=BabyEntryOut, status_code=status.HTTP_201_CREATED)
async def add_baby_entry(body: BabyEntryIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(require_roles(UserRole.neonatologist))):
    """Staff write the family-visible log."""
    await get_accessible_patient(db, user, body.patient_id)
    e = BabyEntry(**body.model_dump())
    db.add(e)
    await audit.record(db, user, "baby.write", f"patient:{body.patient_id}", request=request)
    await db.commit()
    await db.refresh(e)
    return e
