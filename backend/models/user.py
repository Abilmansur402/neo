import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class UserRole(str, enum.Enum):
    neonatologist = "neonatologist"  # Portal 1 · doctors & NICU specialists (ОРИТН)
    analyst = "analyst"              # Portal 2 · regional / national analytics (Облздрав, Минздрав)
    mother = "mother"                # Portal 3 · mothers / families
    researcher = "researcher"        # legacy alias of analyst (model validation)
    admin = "admin"                  # hospital administrator (Portal 2 + readiness)


class Hospital(Base):
    __tablename__ = "hospitals"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    name_kz: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(80))
    his_vendor: Mapped[str] = mapped_column(String(40))  # Damumed | KazHealth
    care_level: Mapped[str] = mapped_column(String(8))

    users: Mapped[list["User"]] = relationship(back_populates="hospital")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"))
    hospital_id: Mapped[str] = mapped_column(ForeignKey("hospitals.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    hospital: Mapped[Hospital] = relationship(back_populates="users")
