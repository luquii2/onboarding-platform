from fastapi import APIRouter, status

from api.stubs import EXAMPLE_USER
from schemas.auth import LoginRequest, RegisterRequest, UserResponse

router = APIRouter(prefix="/auth", tags=["Авторизация"])


# заглушка: данные проверяются по схеме, но пока не сохраняются
@router.post("/register", status_code=status.HTTP_201_CREATED, summary="Регистрация")
def register(body: RegisterRequest) -> UserResponse:
    return EXAMPLE_USER.model_copy(update={"email": body.email, "company_name": body.company_name})


# заглушка: принимает любой e-mail и пароль
@router.post("/login", summary="Вход")
def login(body: LoginRequest) -> UserResponse:
    return EXAMPLE_USER.model_copy(update={"email": body.email})


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Выход")
def logout() -> None:
    return None


@router.get("/me", summary="Текущий пользователь")
def me() -> UserResponse:
    return EXAMPLE_USER