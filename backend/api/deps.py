from typing import Annotated

import jwt
from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.errors import api_error
from core.security import decode_access_token
from db import get_db
from models import User, Site

# сессия базы данных для эндпоинтов
DbSession = Annotated[Session, Depends(get_db)]

# читает заголовок «Authorization: Bearer <токен>»;
# auto_error=False — если заголовка нет, ошибку выдаём сами, в нашем формате
bearer_scheme = HTTPBearer(auto_error=False)


# определяет текущего пользователя по токену; если что-то не так — ошибка 401
def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> User:
    if credentials is None:
        raise api_error(status.HTTP_401_UNAUTHORIZED, "NOT_AUTHENTICATED", "Нужно войти в аккаунт")

    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
    except (jwt.InvalidTokenError, ValueError):
        raise api_error(
            status.HTTP_401_UNAUTHORIZED, "INVALID_TOKEN", "Сессия недействительна, войдите снова"
        ) from None

    user = db.get(User, user_id)
    if user is None or user.token_version != payload["ver"]:
        raise api_error(
            status.HTTP_401_UNAUTHORIZED, "INVALID_TOKEN", "Сессия недействительна, войдите снова"
        )
    return user


# текущий пользователь для эндпоинтов
CurrentUser = Annotated[User, Depends(get_current_user)]


# сайт из адреса запроса, принадлежащий текущему пользователю;
# чужой или несуществующий сайт — одинаковая ошибка 404
def get_owned_site(site_id: str, user: CurrentUser, db: DbSession) -> Site:
    site = db.scalar(select(Site).where(Site.id == site_id, Site.owner_id == user.id))
    if site is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "SITE_NOT_FOUND", "Сайт не найден")
    return site


# сайт текущего пользователя для эндпоинтов с {site_id} в адресе
OwnedSite = Annotated[Site, Depends(get_owned_site)]