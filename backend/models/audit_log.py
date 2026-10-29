import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class AuditLog(Base):
    """Every PHI read/write is recorded; shipped to the hospital SIEM in production."""

    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[str | None] = mapped_column(String(64))
    actor_role: Mapped[str | None] = mapped_column(String(24))
    action: Mapped[str] = mapped_column(String(64), index=True)
    resource: Mapped[str] = mapped_column(String(128))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
