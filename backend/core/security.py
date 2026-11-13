from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash

from core.config import settings

# объект для хэширования паролей: алгоритм Argon2 с рекомендуемыми настройками
password_hash = PasswordHash.recommended()

# хэш случайного пароля: нужен, чтобы вход с несуществующим e-mail длился так же долго,
# как с существующим, и по времени ответа нельзя было угадать, зарегистрирован ли адрес
DUMMY_HASH = password_hash.hash("dummy-password-for-timing")


# превращает пароль в хэш для хранения в базе
def hash_password(password: str) -> str:
    return password_hash.hash(password)


# проверяет, подходит ли пароль к сохранённому хэшу
def verify_password(password: str, hashed: str) -> bool:
    return password_hash.verify(password, hashed)


# выпускает токен входа для пользователя
def create_access_token(user_id: int, token_version: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


# проверяет подпись и срок токена и возвращает его данные;
# при любой проблеме выбрасывает jwt.InvalidTokenError
def decode_access_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "exp", "ver"]},
    )