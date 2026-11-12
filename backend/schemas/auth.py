from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from schemas.base import CamelModel

class RegisterRequest(CamelModel):
    company_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    accept_terms: bool

    @field_validator("accept_terms")
    @classmethod
    def terms_must_be_accepted(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Нужно принять условия использования")
        return value

class LoginRequest(CamelModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class UserResponse(CamelModel):
    id: int
    email: str
    company_name: str
    created_at: datetime