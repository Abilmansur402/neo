"""JWT issuing/verification, password hashing and RBAC dependencies."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import false, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from config import get_settings
from database import SessionLocal, get_db
from models.patient import Patient
from models.user import User, UserRole

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def hash_password(raw: str) -> str:
    return pwd_context.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    return pwd_context.verify(raw, hashed)


def create_access_token(user: User) -> tuple[str, int]:
    expires = timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "hospital": user.hospital_id,
        "exp": datetime.now(timezone.utc) + expires,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm), int(expires.total_seconds())


async def _load_user(session: AsyncSession, token: str | None) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = UUID(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = (await session.execute(select(User).options(selectinload(User.hospital)).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return user


async def get_current_user(token: str | None = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)) -> User:
    return await _load_user(db, token)


async def get_ws_user(websocket: WebSocket) -> User | None:
    """WebSocket auth via ?token=… query parameter. Returns None when missing (caller decides)."""
    token = websocket.query_params.get("token")
    if not token:
        return None
    async with SessionLocal() as session:
        try:
            return await _load_user(session, token)
        except HTTPException:
            return None


def require_roles(*roles: UserRole):
    async def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role: {', '.join(r.value for r in roles)}")
        return user

    return dependency


# Portal 1 works with patient rows; analysts (Portal 2) get aggregates only; mothers (Portal 3) use /api/maternal.
CLINICAL = (UserRole.neonatologist, UserRole.admin)


def can_access_patient(user: User, patient: Patient) -> bool:
    """Single source of truth for row-level access to a patient record."""
    if user.role == UserRole.admin:
        return True
    if user.role == UserRole.neonatologist:
        return patient.hospital_id == user.hospital_id
    return False


def patient_scope(query, user: User):
    """Narrow a `select(Patient)` (or a query joined to Patient) to the rows `user` may see."""
    if user.role == UserRole.admin:
        return query
    if user.role == UserRole.neonatologist:
        return query.where(Patient.hospital_id == user.hospital_id)
    return query.where(false())


async def get_accessible_patient(db: AsyncSession, user: User, patient_id: str) -> Patient:
    """404 rather than 403 so a caller cannot probe which patient ids exist."""
    p = await db.get(Patient, patient_id)
    if not p or not can_access_patient(user, p):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    return p
