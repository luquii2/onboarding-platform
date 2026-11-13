from datetime import datetime, timezone

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from api.deps import CurrentUser, DbSession
from api.errors import api_error
from core.security import DUMMY_HASH, create_access_token, hash_password, verify_password
from models import User
from schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserResponse

router = APIRouter(prefix="/auth", tags=["Авторизация"])


# приводит e-mail к единому виду: без пробелов по краям и строчными буквами
def normalize_email(email: str) -> str:
    return email.strip().lower()


# собирает ответ с токеном и данными пользователя
def token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id, user.token_version),
        user=UserResponse.model_validate(user),
    )


@router.post("/register", status_code=status.HTTP_201_CREATED, summary="Регистрация")
def register(body: RegisterRequest, db: DbSession) -> TokenResponse:
    email = normalize_email(body.email)

    existing = db.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise api_error(status.HTTP_409_CONFLICT, "EMAIL_TAKEN", "Этот e-mail уже зарегистрирован")

    user = User(
        company_name=body.company_name.strip(),
        email=email,
        password_hash=hash_password(body.password),
        terms_accepted_at=datetime.now(timezone.utc),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # кто-то успел зарегистрировать этот e-mail между проверкой и сохранением
        db.rollback()
        raise api_error(
            status.HTTP_409_CONFLICT, "EMAIL_TAKEN", "Этот e-mail уже зарегистрирован"
        ) from None
    db.refresh(user)
    return token_response(user)


@router.post("/login", summary="Вход")
def login(body: LoginRequest, db: DbSession) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == normalize_email(body.email)))

    if user is None:
        # проверяем пароль с «пустышкой», чтобы ответ занял столько же времени
        verify_password(body.password, DUMMY_HASH)
        raise api_error(
            status.HTTP_401_UNAUTHORIZED, "INVALID_CREDENTIALS", "Неверный e-mail или пароль"
        )

    if not verify_password(body.password, user.password_hash):
        raise api_error(
            status.HTTP_401_UNAUTHORIZED, "INVALID_CREDENTIALS", "Неверный e-mail или пароль"
        )

    return token_response(user)


# с JWT выход — это удаление токена в панели; эндпоинт только проверяет, что токен действителен
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Выход")
def logout(user: CurrentUser) -> None:
    return None


# увеличивает версию токенов: все ранее выданные токены пользователя перестают действовать
@router.post(
    "/logout-all",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Выйти на всех устройствах",
)
def logout_all(user: CurrentUser, db: DbSession) -> None:
    user.token_version += 1
    db.commit()
    return None


@router.get("/me", summary="Текущий пользователь")
def me(user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(user)