from fastapi import APIRouter, Response, status
from sqlalchemy import select

from api.deps import DbSession, OwnedSite
from api.errors import api_error
from models import ProjectDraft, Publication, Site
from schemas.project import Project
from schemas.publication import PublicationResponse, PublishRequest
from services.publishing import export_scenarios, readiness_errors

router = APIRouter(prefix="/sites", tags=["Публикация"])


# блокирует строки сайта и черновика до конца транзакции:
# параллельные публикации и сохранения будут ждать, пока эта закончится
def lock_site(site: Site, db: DbSession) -> tuple[Site, ProjectDraft]:
    locked_site = db.scalar(
        select(Site)
        .where(Site.id == site.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    draft = db.scalar(
        select(ProjectDraft)
        .where(ProjectDraft.site_id == site.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return locked_site, draft


# текущая публикация сайта (или None, если ничего не публиковалось)
def current_publication(site: Site, db: DbSession) -> Publication | None:
    return db.scalar(
        select(Publication).where(
            Publication.site_id == site.id, Publication.version == site.published_version
        )
    )


# создаёт новую версию публикации и делает её текущей
def add_publication(
    site: Site, db: DbSession, scenarios: list[dict], project_revision: int | None
) -> Publication:
    version = site.published_version + 1
    publication = Publication(
        site_id=site.id,
        version=version,
        project_revision=project_revision,
        config={
            "schema": 1,
            "siteId": site.id,
            "origin": site.origin,
            "version": version,
            "scenarios": scenarios,
        },
    )
    db.add(publication)
    site.published_version = version
    db.commit()
    db.refresh(publication)
    return publication


@router.post(
    "/{site_id}/publications",
    status_code=status.HTTP_201_CREATED,
    summary="Опубликовать черновик",
)
def publish(
    body: PublishRequest, site: OwnedSite, db: DbSession, response: Response
) -> PublicationResponse:
    site, draft = lock_site(site, db)

    if draft.revision != body.project_revision:
        db.rollback()
        raise api_error(
            status.HTTP_409_CONFLICT,
            "REVISION_CONFLICT",
            "Черновик изменился. Сохраните проект и опубликуйте снова.",
            currentRevision=draft.revision,
        )

    # повторное нажатие: эта ревизия уже опубликована — возвращаем ту же версию
    current = current_publication(site, db)
    if current is not None and current.project_revision == draft.revision:
        db.rollback()
        response.status_code = status.HTTP_200_OK
        return PublicationResponse.model_validate(current)

    project = Project.model_validate(draft.data)
    problems = readiness_errors(project, site)
    if problems:
        db.rollback()
        raise api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "PUBLISH_NOT_READY",
            problems[0]["message"],
            errors=problems,
        )

    publication = add_publication(site, db, export_scenarios(project), draft.revision)
    return PublicationResponse.model_validate(publication)


@router.get("/{site_id}/publications", summary="История публикаций")
def list_publications(site: OwnedSite, db: DbSession) -> list[PublicationResponse]:
    publications = db.scalars(
        select(Publication)
        .where(Publication.site_id == site.id)
        .order_by(Publication.version.desc())
        .limit(50)
    ).all()
    return [PublicationResponse.model_validate(item) for item in publications]


@router.post(
    "/{site_id}/unpublish",
    status_code=status.HTTP_201_CREATED,
    summary="Снять туры с публикации",
)
def unpublish(site: OwnedSite, db: DbSession, response: Response) -> PublicationResponse:
    site, _ = lock_site(site, db)

    # уже снято с публикации — возвращаем текущую пустую версию
    current = current_publication(site, db)
    if current is not None and not current.config["scenarios"]:
        db.rollback()
        response.status_code = status.HTTP_200_OK
        return PublicationResponse.model_validate(current)

    publication = add_publication(site, db, [], None)
    return PublicationResponse.model_validate(publication)