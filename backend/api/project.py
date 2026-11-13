from fastapi import APIRouter, status
from sqlalchemy import func, select, update

from api.deps import DbSession, OwnedSite
from api.errors import api_error
from models import ProjectDraft, Publication, Site
from schemas.project import Project, ProjectResponse, ProjectSaveRequest
from services.publishing import MAX_PROJECT_BYTES, foreign_pages, project_size

router = APIRouter(prefix="/sites", tags=["Конструктор"])


# ревизия черновика, из которой сделана текущая публикация сайта
def published_revision(site: Site, db: DbSession) -> int | None:
    return db.scalar(
        select(Publication.project_revision).where(
            Publication.site_id == site.id, Publication.version == site.published_version
        )
    )


@router.get("/{site_id}/project", summary="Получить черновик проекта")
def get_project(site: OwnedSite, db: DbSession) -> ProjectResponse:
    draft = site.draft
    return ProjectResponse(
        revision=draft.revision,
        updated_at=draft.updated_at,
        published_project_revision=published_revision(site, db),
        project=Project.model_validate(draft.data),
    )


@router.put("/{site_id}/project", summary="Сохранить черновик проекта")
def save_project(body: ProjectSaveRequest, site: OwnedSite, db: DbSession) -> ProjectResponse:
    # siteId внутри проекта всегда совпадает с сайтом из адреса
    project = body.project.model_copy(update={"site_id": site.id})

    outside = foreign_pages(project, site)
    if outside:
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "PAGE_OUTSIDE_SITE",
            f"Страница {outside[0]} не относится к сайту {site.base_url}",
            urls=outside,
        )

    data = project.model_dump(mode="json", exclude_none=True)
    if project_size(data) > MAX_PROJECT_BYTES:
        raise api_error(
            status.HTTP_413_CONTENT_TOO_LARGE,
            "PROJECT_TOO_LARGE",
            "Проект больше 500 КБ. Сократите содержимое сценариев.",
        )

    # сохраняем, только если ревизия в базе всё ещё та, от которой начинала панель
    saved = db.execute(
        update(ProjectDraft)
        .where(ProjectDraft.site_id == site.id, ProjectDraft.revision == body.base_revision)
        .values(data=data, revision=ProjectDraft.revision + 1, updated_at=func.now())
        .returning(ProjectDraft.revision, ProjectDraft.updated_at)
        .execution_options(synchronize_session=False)
    ).one_or_none()

    if saved is None:
        db.rollback()
        current = db.scalar(select(ProjectDraft.revision).where(ProjectDraft.site_id == site.id))
        raise api_error(
            status.HTTP_409_CONFLICT,
            "REVISION_CONFLICT",
            "Проект изменён в другой вкладке. Загрузите актуальную версию.",
            currentRevision=current,
        )

    db.commit()
    return ProjectResponse(
        revision=saved.revision,
        updated_at=saved.updated_at,
        published_project_revision=published_revision(site, db),
        project=Project.model_validate(data),
    )