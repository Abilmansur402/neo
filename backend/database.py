"""Async SQLAlchemy 2.0 engine, session factory and TimescaleDB bootstrap."""
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


TIMESCALE_SQL = [
    "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'analyst';",
    "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'mother';",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ;",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS event_label VARCHAR(200);",
    "CREATE EXTENSION IF NOT EXISTS timescaledb;",
    # vital_signs is keyed by (time, patient_id) so it can become a hypertable
    "SELECT create_hypertable('vital_signs', 'time', if_not_exists => TRUE, migrate_data => TRUE);",
    "CREATE INDEX IF NOT EXISTS ix_vital_signs_patient_time ON vital_signs (patient_id, time DESC);",
]


async def init_db() -> None:
    """Create tables (Alembic is used for real migrations; this is the dev bootstrap)."""
    import models  # noqa: F401  (registers all mapped classes)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    for stmt in TIMESCALE_SQL:  # each in its own transaction: ALTER TYPE cannot run inside a block with other statements
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:  # TimescaleDB not installed (plain Postgres) or already applied – keep going
            print(f"[db] bootstrap step skipped: {exc.__class__.__name__}")
