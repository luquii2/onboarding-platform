import html

from fastapi import APIRouter, status

from api.stubs import EXAMPLE_BASE_URL, EXAMPLE_SITE
from core.config import settings
from schemas.site import (
    InstallationResponse,
    ObservedPage,
    SiteCreate,
    SiteResponse,
    SiteUpdate,
)

router = APIRouter(prefix="/sites", tags=["Сайты"])


def build_config_url(site_id: str) -> str:
    return f"{settings.public_api_url}/api/v1/public/sites/{site_id}/config"


def build_script_tag(site_id: str) -> str:
    """Тег <script> для вставки на сайт клиента. Все значения экранируются."""
    attrs = {
        "src": settings.widget_url,
        "data-site-id": site_id,
        "data-config-url": build_config_url(site_id),
        "data-editor-origin": settings.editor_origin,
    }
    parts = " ".join(f'{name}="{html.escape(value, quote=True)}"' for name, value in attrs.items())
    return f"<script {parts} defer></script>"


@router.get("", summary="Список сайтов")
def list_sites() -> list[SiteResponse]:
    return [EXAMPLE_SITE]


@router.post("", status_code=status.HTTP_201_CREATED, summary="Добавить сайт")
def create_site(body: SiteCreate) -> SiteResponse:
    return EXAMPLE_SITE.model_copy(
        update={
            "name": body.name,
            "base_url": body.base_url,
            "published_version": 0,
            "installation_status": "not_detected",
            "scenarios_count": 1,
            "starts_last_7_days": 0,
            "last_seen_at": None,
            "last_seen_page": None,
            "widget_version": None,
        }
    )


@router.get("/{site_id}", summary="Карточка сайта")
def get_site(site_id: str) -> SiteResponse:
    return EXAMPLE_SITE.model_copy(update={"id": site_id})


@router.patch("/{site_id}", summary="Изменить название сайта")
def update_site(site_id: str, body: SiteUpdate) -> SiteResponse:
    return EXAMPLE_SITE.model_copy(update={"id": site_id, "name": body.name})


@router.delete("/{site_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить сайт")
def delete_site(site_id: str) -> None:
    return None


@router.get("/{site_id}/installation", summary="Код подключения виджета")
def get_installation(site_id: str) -> InstallationResponse:
    return InstallationResponse(
        site_id=site_id,
        script_tag=build_script_tag(site_id),
        widget_url=settings.widget_url,
        config_url=build_config_url(site_id),
        installation_status="not_detected",
        last_seen_at=None,
    )


@router.get("/{site_id}/pages", summary="Страницы, на которых работал виджет")
def get_observed_pages(site_id: str) -> list[ObservedPage]:
    return [ObservedPage(url=EXAMPLE_BASE_URL, title="Главная")]