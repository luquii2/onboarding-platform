import html

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from api.deps import CurrentUser, DbSession, OwnedSite
from api.errors import api_error
from core.config import settings
from core.projects import new_project
from core.urls import parse_site_url
from models import ProjectDraft, Site, Theme
from models.site import generate_site_id
from schemas.site import (
    InstallationResponse,
    ObservedPage,
    SiteCreate,
    SiteResponse,
    SiteUpdate,
)
from services.sites import build_site_responses, installation_status

router = APIRouter(prefix="/sites", tags=["Сайты"])


# адрес, по которому виджет загружает конфигурацию сайта
def build_config_url(site_id: str) -> str:
    return f"{settings.public_api_url}/api/v1/public/sites/{site_id}/config"


# тег <script> для вставки на сайт клиента; все значения экранируются
def build_script_tag(site_id: str) -> str:
    attrs = {
        "src": settings.widget_url,
        "data-site-id": site_id,
        "data-config-url": build_config_url(site_id),
        "data-editor-origin": settings.editor_origin,
    }
    parts = " ".join(f'{name}="{html.escape(value, quote=True)}"' for name, value in attrs.items())
    return f"<script {parts} defer></script>"


@router.get("", summary="Список сайтов")
def list_sites(user: CurrentUser, db: DbSession) -> list[SiteResponse]:
    sites = db.scalars(
        select(Site).where(Site.owner_id == user.id).order_by(Site.created_at.desc(), Site.id)
    ).all()
    return build_site_responses(db, list(sites))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Добавить сайт")
def create_site(body: SiteCreate, user: CurrentUser, db: DbSession) -> SiteResponse:
    address = parse_site_url(body.base_url)

    existing = db.scalar(
        select(Site).where(Site.owner_id == user.id, Site.base_url == address.base_url)
    )
    if existing is not None:
        raise api_error(
            status.HTTP_409_CONFLICT, "SITE_ALREADY_EXISTS", "Этот сайт уже добавлен в ваш аккаунт"
        )

    site_id = generate_site_id()
    site = Site(
        id=site_id,
        owner_id=user.id,
        name=body.name,
        base_url=address.base_url,
        origin=address.origin,
        base_path=address.base_path,
    )
    site.theme = Theme()
    site.draft = ProjectDraft(data=new_project(site_id, address.base_url))
    db.add(site)
    try:
        db.commit()
    except IntegrityError:
        # тот же адрес успели добавить параллельным запросом
        db.rollback()
        raise api_error(
            status.HTTP_409_CONFLICT, "SITE_ALREADY_EXISTS", "Этот сайт уже добавлен в ваш аккаунт"
        ) from None
    db.refresh(site)
    return build_site_responses(db, [site])[0]


@router.get("/{site_id}", summary="Карточка сайта")
def get_site(site: OwnedSite, db: DbSession) -> SiteResponse:
    return build_site_responses(db, [site])[0]


@router.patch("/{site_id}", summary="Изменить название сайта")
def update_site(body: SiteUpdate, site: OwnedSite, db: DbSession) -> SiteResponse:
    site.name = body.name
    db.commit()
    db.refresh(site)
    return build_site_responses(db, [site])[0]


# удаляет сайт вместе с темой, черновиком, публикациями и событиями
@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить сайт")
def delete_site(site: OwnedSite, db: DbSession) -> None:
    db.delete(site)
    db.commit()
    return None


@router.get("/{site_id}/installation", summary="Код подключения виджета")
def get_installation(site: OwnedSite) -> InstallationResponse:
    return InstallationResponse(
        site_id=site.id,
        script_tag=build_script_tag(site.id),
        widget_url=settings.widget_url,
        config_url=build_config_url(site.id),
        installation_status=installation_status(site),
        last_seen_at=site.last_seen_at,
    )


@router.get("/{site_id}/pages", summary="Страницы, на которых работал виджет")
def get_observed_pages(site: OwnedSite) -> list[ObservedPage]:
    return [ObservedPage.model_validate(page) for page in site.observed_pages]