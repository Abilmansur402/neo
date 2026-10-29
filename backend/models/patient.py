from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Patient(Base):
    """Neonate admission record. Identifier format KZ-YYYY-NNN."""

    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    hospital_id: Mapped[str] = mapped_column(ForeignKey("hospitals.id"), index=True)
    diagnosis: Mapped[str] = mapped_column(String(200))
    gestational_age_wk: Mapped[int] = mapped_column(Integer)
    birth_weight_g: Mapped[int] = mapped_column(Integer)
    sex: Mapped[str] = mapped_column(String(1))
    apgar_1: Mapped[int] = mapped_column(Integer)
    apgar_5: Mapped[int] = mapped_column(Integer)
    delivery_mode: Mapped[str] = mapped_column(String(20))
    postnatal_age_h: Mapped[int] = mapped_column(Integer)
    ventilation_mode: Mapped[str] = mapped_column(String(20))
    bed: Mapped[str] = mapped_column(String(8), default="07")
    skin_temp_c: Mapped[float] = mapped_column(Float, default=36.4)
    nfcs: Mapped[int] = mapped_column(Integer, default=1)
    admitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)   # observed deterioration (time machine)
    event_label: Mapped[str | None] = mapped_column(String(200), nullable=True)

    vitals: Mapped[list["VitalSign"]] = relationship(back_populates="patient", cascade="all, delete-orphan")  # noqa: F821
    predictions: Mapped[list["Prediction"]] = relationship(back_populates="patient", cascade="all, delete-orphan")  # noqa: F821
