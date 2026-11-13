from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import select

from api.deps import DbSession, OwnedSite
from models import Publication
from schemas.project import Project, ProjectResponse, ProjectSaveRequest

router = APIRouter(prefix="/sites", tags=["Конструктор"])


@router.get("/{site_id}/project", summary="Получить черновик проекта")
def get_project(site: OwnedSite, db: DbSession) -> ProjectResponse:
    draft = site.draft
    published_revision = db.scalar(
        select(Publication.project_revision).where(
            Publication.site_id == site.id, Publication.version == site.published_version
        )
    )
    return ProjectResponse(
        revision=draft.revision,
        updated_at=draft.updated_at,
        published_project_revision=published_revision,
        project=Project.model_validate(draft.data),
    )


# заглушка до этапа 6: проект проверяется, но не сохраняется
@router.put("/{site_id}/project", summary="Сохранить черновик проекта")
def save_project(body: ProjectSaveRequest, site: OwnedSite) -> ProjectResponse:
    project = body.project.model_copy(update={"site_id": site.id})
    return ProjectResponse(
        revision=body.base_revision + 1,
        updated_at=datetime.now(timezone.utc),
        published_project_revision=None,
        project=project,
    )