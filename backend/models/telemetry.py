import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class VitalSign(Base):
    """High-frequency vitals + blood gas. TimescaleDB hypertable on `time`."""

    __tablename__ = "vital_signs"

    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), primary_key=True)
    heart_rate: Mapped[float | None] = mapped_column(Float)
    resp_rate: Mapped[float | None] = mapped_column(Float)
    spo2: Mapped[float | None] = mapped_column(Float)
    fio2: Mapped[float | None] = mapped_column(Float)
    map_mmhg: Mapped[float | None] = mapped_column(Float)
    temperature: Mapped[float | None] = mapped_column(Float)
    ph: Mapped[float | None] = mapped_column(Float)
    pco2: Mapped[float | None] = mapped_column(Float)
    po2: Mapped[float | None] = mapped_column(Float)
    hco3: Mapped[float | None] = mapped_column(Float)
    base_excess: Mapped[float | None] = mapped_column(Float)
    lactate: Mapped[float | None] = mapped_column(Float)
    glucose: Mapped[float | None] = mapped_column(Float)
    hemoglobin: Mapped[float | None] = mapped_column(Float)
    wbc: Mapped[float | None] = mapped_column(Float)
    platelets: Mapped[float | None] = mapped_column(Float)
    crp: Mapped[float | None] = mapped_column(Float)
    sodium: Mapped[float | None] = mapped_column(Float)
    potassium: Mapped[float | None] = mapped_column(Float)
    creatinine: Mapped[float | None] = mapped_column(Float)
    bilirubin: Mapped[float | None] = mapped_column(Float)
    urine_output: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(24), default="monitor")  # monitor | lab | fhir | cv

    patient: Mapped["Patient"] = relationship(back_populates="vitals")  # noqa: F821


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id", ondelete="CASCADE"), index=True)
    model_version: Mapped[str] = mapped_column(String(40))
    risk_probability: Mapped[float] = mapped_column(Float)
    risk_tier: Mapped[str] = mapped_column(String(12))
    features: Mapped[dict] = mapped_column(JSON)
    shap_values: Mapped[list] = mapped_column(JSON)
    base_value: Mapped[float] = mapped_column(Float)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    patient: Mapped["Patient"] = relationship(back_populates="predictions")  # noqa: F821
    reviews: Mapped[list["ExpertReview"]] = relationship(back_populates="prediction", cascade="all, delete-orphan")


class ExpertReview(Base):
    """Neonatologist sign-off on a prediction (approve / flag)."""

    __tablename__ = "expert_reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    prediction_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("predictions.id", ondelete="CASCADE"), index=True)
    reviewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    reviewer_name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(12))  # approved | flagged
    confidence_flag: Mapped[int] = mapped_column(Integer, default=0)  # 0 fine, 1 over-confident, 2 under-confident
    note: Mapped[str] = mapped_column(Text, default="")
    observed_outcome: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    prediction: Mapped[Prediction] = relationship(back_populates="reviews")
