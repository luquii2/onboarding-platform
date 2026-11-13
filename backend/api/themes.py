from fastapi import APIRouter

from api.deps import DbSession, OwnedSite
from models import Site, Theme
from schemas.theme import ThemeSchema

router = APIRouter(prefix="/sites", tags=["Настройка вида"])


# тема сайта; если её почему-то нет — создаётся со значениями по умолчанию
def get_or_create_theme(site: Site, db: DbSession) -> Theme:
    if site.theme is None:
        site.theme = Theme()
        db.commit()
    return site.theme


@router.get("/{site_id}/theme", summary="Получить тему оформления")
def get_theme(site: OwnedSite, db: DbSession) -> ThemeSchema:
    return ThemeSchema.model_validate(get_or_create_theme(site, db))


@router.put("/{site_id}/theme", summary="Сохранить тему оформления")
def save_theme(body: ThemeSchema, site: OwnedSite, db: DbSession) -> ThemeSchema:
    theme = get_or_create_theme(site, db)
    for field, value in body.model_dump(by_alias=False).items():
        setattr(theme, field, value)
    db.commit()
    db.refresh(theme)
    return ThemeSchema.model_validate(theme)