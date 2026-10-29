"""Application settings loaded from environment variables (.env supported)."""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="NEO_", extra="ignore")

    app_name: str = "NeoOutcome AI"
    app_version: str = "1.0.0"
    environment: str = "development"

    database_url: str = Field(
        default="postgresql+asyncpg://neo:neo@localhost:5432/neooutcome",
        description="Async SQLAlchemy URL for PostgreSQL/TimescaleDB",
    )
    jwt_secret: str = "change-me-in-production-9f1c2a7b"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost"]

    model_dir: str = "./artifacts"
    seed_demo_data: bool = True
    telemetry_hz: float = 4.0  # WebSocket frame rate for CV telemetry
    retrain_feedback_threshold: int = 25  # clinician sign-offs that trigger an automatic retrain


@lru_cache
def get_settings() -> Settings:
    return Settings()
