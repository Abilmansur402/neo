from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from models.user import Hospital, User, UserRole
from schemas.auth import HospitalOut, LoginRequest, RegisterRequest, TokenResponse, UserOut
from services import audit
from services.security import create_access_token, get_current_user, hash_password, require_roles, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/hospitals", response_model=list[HospitalOut])
async def list_hospitals(db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(Hospital).order_by(Hospital.name))).scalars().all()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db), admin: User = Depends(require_roles(UserRole.admin))):
    """Accounts are issued by a hospital administrator; open sign-up would let anyone create an admin."""
    if (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    if not await db.get(Hospital, body.hospital_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown hospital")
    user = User(email=body.email, full_name=body.full_name, hashed_password=hash_password(body.password), role=body.role, hospital_id=body.hospital_id)
    db.add(user)
    await db.flush()
    await db.refresh(user, attribute_names=["hospital"])
    await audit.record(db, admin, "auth.register", f"user:{user.id}", {"role": user.role.value}, request)
    await db.commit()
    token, ttl = create_access_token(user)
    return TokenResponse(access_token=token, expires_in=ttl, user=UserOut.model_validate(user))


async def _login(email: str, password: str, request: Request, db: AsyncSession) -> TokenResponse:
    user = (await db.execute(select(User).options(selectinload(User.hospital)).where(User.email == email))).scalar_one_or_none()
    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    await audit.record(db, user, "auth.login", f"user:{user.id}", request=request)
    await db.commit()
    token, ttl = create_access_token(user)
    return TokenResponse(access_token=token, expires_in=ttl, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login_form(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    """OAuth2 password flow (Swagger 'Authorize' button)."""
    return await _login(form.username, form.password, request, db)


@router.post("/login/json", response_model=TokenResponse)
async def login_json(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    return await _login(body.email, body.password, request, db)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user
