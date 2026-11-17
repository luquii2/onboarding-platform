import hashlib
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status
from sqlalchemy import select

from api.deps import DbSession
from api.errors import api_error
from core.config import settings
from core.urls import clean_page_url, page_belongs_to_site
from models import Publication, Site
from schemas.public import (
    ConnectRequest,
    EventBatch,
    EventBatchResponse,
    WidgetConfig,
)
from schemas.theme import ThemeSchema

router = APIRouter(prefix="/public/sites", tags=["Виджет"])

# текущую версию браузер каждый раз перепроверяет у сервера (по ETag)
CURRENT_CONFIG_CACHE = "no-cache"
# конкретную версию можно 5 минут брать из кэша без запроса: туры в ней не меняются,
# а тема подставляется при выдаче, поэтому навсегда кэшировать нельзя
PINNED_CONFIG_CACHE = "public, max-age=300"


# сайт по id или ошибка 404
def get_public_site(db: DbSession, site_id: str) -> Site:
    site = db.get(Site, site_id)
    if site is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "SITE_NOT_FOUND", "Сайт не найден")
    return site


# записывать данные можно только со страниц самого сайта:
# браузер сам ставит заголовок Origin, и скрипт страницы не может его подменить
def check_site_origin(request: Request, site: Site) -> None:
    if request.headers.get("origin") != site.origin:
        raise api_error(
            status.HTTP_403_FORBIDDEN, "ORIGIN_NOT_ALLOWED", "Запрос пришёл не с адреса этого сайта"
        )


# «отпечаток» ответа: меняется, только если изменилось содержимое
def make_etag(body: bytes) -> str:
    return '"' + hashlib.sha256(body).hexdigest()[:32] + '"'


# прислал ли браузер тот же отпечаток, что у нас (значит, его копия актуальна)
def etag_matches(request: Request, etag: str) -> bool:
    header = request.headers.get("if-none-match", "")
    return etag in (value.strip().removeprefix("W/") for value in header.split(","))


# опубликованная конфигурация: текущая версия или конкретная (?version=N)
@router.get(
    "/{site_id}/config",
    response_model=WidgetConfig,
    summary="Опубликованная конфигурация для виджета",
)
def get_config(
    site_id: str,
    request: Request,
    db: DbSession,
    version: Annotated[int | None, Query(ge=0)] = None,
) -> Response:
    site = get_public_site(db, site_id)

    wanted = version or site.published_version
    if wanted == 0:
        raise api_error(status.HTTP_404_NOT_FOUND, "NOT_PUBLISHED", "Туры сайта ещё не опубликованы")

    publication = db.scalar(
        select(Publication).where(Publication.site_id == site.id, Publication.version == wanted)
    )
    if publication is None:
        raise api_error(status.HTTP_404_NOT_FOUND, "VERSION_NOT_FOUND", "Такой версии нет")

    theme = ThemeSchema.model_validate(site.theme) if site.theme else None
    config = WidgetConfig.model_validate({**publication.config, "theme": theme})
    body = config.model_dump_json(by_alias=True).encode()

    etag = make_etag(body)
    headers = {
        "ETag": etag,
        "Cache-Control": PINNED_CONFIG_CACHE if version else CURRENT_CONFIG_CACHE,
    }
    if etag_matches(request, etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


# запись о странице в списке observed_pages
def find_page(pages: list[dict], url: str) -> dict | None:
    return next((page for page in pages if page.get("url") == url), None)


# тот же сигнал с той же страницы уже записан меньше минуты назад — повторно не пишем
def is_recent_signal(site: Site, url: str, title: str, widget_version: str | None, now: datetime) -> bool:
    page = find_page(site.observed_pages, url)
    if page is None or page.get("title") != title or site.widget_version != widget_version:
        return False
    try:
        seen_at = datetime.fromisoformat(page["lastSeenAt"])
    except (KeyError, TypeError, ValueError):
        return False
    return now - seen_at < timedelta(seconds=settings.connect_throttle_seconds)


# новый список страниц: эта страница первой, без повторов, не больше лимита;
# создаём новый список, а не меняем старый — иначе SQLAlchemy не заметит изменение JSONB
def remember_page(pages: list[dict], url: str, title: str, now: datetime) -> list[dict]:
    others = [page for page in pages if page.get("url") != url]
    entry = {"url": url, "title": title, "lastSeenAt": now.isoformat()}
    return [entry, *others][: settings.observed_pages_limit]


# виджет загрузился на странице сайта: обновляем статус подключения и список страниц
@router.post(
    "/{site_id}/connect",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Сигнал подключения виджета",
)
def connect(site_id: str, body: ConnectRequest, request: Request, db: DbSession) -> None:
    site = get_public_site(db, site_id)
    check_site_origin(request, site)

    try:
        page_url = clean_page_url(body.page_url)
    except ValueError:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "INVALID_PAGE_URL", "Некорректный адрес страницы"
        ) from None
    if not page_belongs_to_site(page_url, site.origin, site.base_path):
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "PAGE_OUTSIDE_SITE",
            "Страница не относится к адресу сайта",
        )

    title = body.page_title.strip()
    widget_version = body.widget_version.strip() or None
    now = datetime.now(timezone.utc)
    if is_recent_signal(site, page_url, title, widget_version, now):
        return None

    # блокируем строку сайта до конца транзакции: два одновременных сигнала
    # с разных страниц не должны затереть друг друга в observed_pages
    db.refresh(site, with_for_update=True)
    site.observed_pages = remember_page(site.observed_pages, page_url, title, now)
    site.last_seen_at = now
    site.last_seen_page = page_url
    site.widget_version = widget_version
    db.commit()
    return None


@router.post(
    "/{site_id}/events",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Пачка событий от виджета",
)
def receive_events(site_id: str, body: EventBatch) -> EventBatchResponse:
    return EventBatchResponse(accepted=len(body.events), duplicates=0)