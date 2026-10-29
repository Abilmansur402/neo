"""Registry of trained model versions (DB-backed so the analyst portal can list, compare, and roll back)."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(40), default="xgb-24h", index=True)
    version: Mapped[str] = mapped_column(String(60), unique=True)       # e.g. v1.2.0-kz-local
    path: Mapped[str] = mapped_column(String(300))                       # artifacts/versions/<version>
    status: Mapped[str] = mapped_column(String(16), default="candidate")  # candidate | active | archived | failed | rolled_back
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    trigger: Mapped[str] = mapped_column(String(24), default="manual")   # manual | dataset_upload | feedback_loop | scheduler | bootstrap
    data_source: Mapped[str] = mapped_column(Text, default="")
    n_rows: Mapped[int] = mapped_column(Integer, default=0)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    feature_importance: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str] = mapped_column(Text, default="")
    trained_by: Mapped[str | None] = mapped_column(String(64))
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    pushed_to_s3: Mapped[bool] = mapped_column(Boolean, default=False)
