from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

from models.user import UserRole


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=200)
    role: UserRole
    hospital_id: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class HospitalOut(BaseModel):
    id: str
    name: str
    name_kz: str
    city: str
    his_vendor: str
    care_level: str

    model_config = {"from_attributes": True}


class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str
    role: UserRole
    hospital: HospitalOut

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut
