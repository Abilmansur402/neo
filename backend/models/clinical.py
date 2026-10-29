"""Portal-specific clinical records: maternal module (mothers), baby growth log, doctor task list."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class MaternalRecord(Base):
    """18 maternal fields used for the pre-birth risk screen. One record per pregnancy, owned by the mother's user."""

    __tablename__ = "maternal_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    hospital_id: Mapped[str] = mapped_column(ForeignKey("hospitals.id"))
    patient_id: Mapped[str | None] = mapped_column(ForeignKey("patients.id"), nullable=True)  # linked after delivery
    # --- 18 maternal fields ---
    maternal_age: Mapped[int] = mapped_column(Integer)
    gravidity: Mapped[int] = mapped_column(Integer, default=1)
    parity: Mapped[int] = mapped_column(Integer, default=0)
    gestational_age_wk: Mapped[float] = mapped_column(Float)
    bmi: Mapped[float] = mapped_column(Float)
    bp_systolic: Mapped[int] = mapped_column(Integer)
    bp_diastolic: Mapped[int] = mapped_column(Integer)
    pre_eclampsia: Mapped[bool] = mapped_column(Boolean, default=False)
    gestational_diabetes: Mapped[bool] = mapped_column(Boolean, default=False)
    chronic_hypertension: Mapped[bool] = mapped_column(Boolean, default=False)
    antenatal_steroids: Mapped[bool] = mapped_column(Boolean, default=False)
    magnesium_sulfate: Mapped[bool] = mapped_column(Boolean, default=False)
    prom_hours: Mapped[float] = mapped_column(Float, default=0)  # premature rupture of membranes
    chorioamnionitis: Mapped[bool] = mapped_column(Boolean, default=False)
    multiple_gestation: Mapped[bool] = mapped_column(Boolean, default=False)
    smoking: Mapped[bool] = mapped_column(Boolean, default=False)
    hemoglobin: Mapped[float] = mapped_column(Float, default=120)
    planned_delivery_mode: Mapped[str] = mapped_column(String(20), default="vaginal")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BabyEntry(Base):
    """Mother-visible newborn log: weights, feeds, milestones, discharge notes (written by staff, read by mothers)."""

    __tablename__ = "baby_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    day: Mapped[int] = mapped_column(Integer)  # day of life
    weight_g: Mapped[int | None] = mapped_column(Integer)
    feeding: Mapped[str | None] = mapped_column(String(40))  # parenteral | tube | breast | bottle
    respiratory_support: Mapped[str | None] = mapped_column(String(40))
    milestone: Mapped[str | None] = mapped_column(String(200))
    note_for_family: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MotherCheckin(Base):
    """Mother's own postpartum self-check: mood and WHO danger signs. Visible to her only, never to staff or analysts."""

    __tablename__ = "mother_checkins"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)
    mood: Mapped[int] = mapped_column(Integer)  # 1 (very bad) … 5 (good)
    flags: Mapped[list] = mapped_column(JSON, default=list)  # keys of DANGER_SIGNS in routers/maternal.py
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class ClinicalTask(Base):
    """Shift task list for NICU doctors ("redline tracker")."""

    __tablename__ = "clinical_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[str] = mapped_column(ForeignKey("hospitals.id"), index=True)
    patient_id: Mapped[str | None] = mapped_column(ForeignKey("patients.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    priority: Mapped[str] = mapped_column(String(10), default="normal")  # low | normal | high | critical
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual | ai
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class Appointment(Base):
    """Clinician appointments (re-examination schedule). Ported from the initial repository's Supabase
    ``appointments`` table; row-level isolation is enforced in the router (created_by == current user,
    plus hospital scope for admins)."""

    __tablename__ = "appointments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[str] = mapped_column(ForeignKey("hospitals.id"), index=True)
    patient_ref: Mapped[str] = mapped_column(String(64))       # patient id or bundle id (may be a synthetic SYN-… id)
    patient_label: Mapped[str] = mapped_column(String(200))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    appointment_type: Mapped[str] = mapped_column(String(64))  # re-examination | consultation | transfer | family
    reason: Mapped[str] = mapped_column(Text)
    clinician_name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(16), default="scheduled")  # scheduled | completed | cancelled
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
