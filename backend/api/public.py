from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import select

from api.deps import DbSession
from api.errors import api_error
from models import Publication, Site
from schemas.public import (
    ConnectRequest,
    EventBatch,
    EventBatchResponse,
    WidgetConfig,
)
from schemas.theme import ThemeSchema

router = APIRouter(prefix="/public/sites", tags=["Виджет"])


# опубликованная конфигурация: текущая версия или конкретная (?version=N)
@router.get("/{site_id}/config", summary="Опубликованная конфигурация для виджета")
def get_config(
    site_id: str,
    db: DbSession,
    version: Annotated[int | None, Query(ge=0)] = None,
) -> WidgetConfig:
    site = db.get(Site, site_id)
    if site is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "SITE_NOT_FOUND", "Сайт не найден")

    wanted = version or site.published_version
    if wanted == 0:
        raise api_error(status.HTTP_404_NOT_FOUND, "NOT_PUBLISHED", "Туры сайта ещё не опубликованы")

    publication = db.scalar(
        select(Publication).where(Publication.site_id == site.id, Publication.version == wanted)
    )
    if publication is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "VERSION_NOT_FOUND", "Такой версии нет")

    theme = ThemeSchema.model_validate(site.theme) if site.theme else None
    return WidgetConfig.model_validate({**publication.config, "theme": theme})


@router.post(
    "/{site_id}/connect",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Сигнал подключения виджета",
)
def connect(site_id: str, body: ConnectRequest) -> None:
    return None


@router.post(
    "/{site_id}/events",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Пачка событий от виджета",
)
def receive_events(site_id: str, body: EventBatch) -> EventBatchResponse:
    return EventBatchResponse(accepted=len(body.events), duplicates=0)