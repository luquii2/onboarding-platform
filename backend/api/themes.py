from fastapi import APIRouter

from api.stubs import EXAMPLE_THEME
from schemas.theme import ThemeSchema

router = APIRouter(prefix="/sites", tags=["Настройка вида"])


@router.get("/{site_id}/theme", summary="Получить тему оформления")
def get_theme(site_id: str) -> ThemeSchema:
    return EXAMPLE_THEME


@router.put("/{site_id}/theme", summary="Сохранить тему оформления")
def save_theme(site_id: str, body: ThemeSchema) -> ThemeSchema:
    return body