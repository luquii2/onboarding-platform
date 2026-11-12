from datetime import datetime, timezone

from fastapi import APIRouter, status

from api.stubs import EXAMPLE_TIME
from schemas.publication import PublicationResponse, PublishRequest

router = APIRouter(prefix="/sites", tags=["Публикация"])


@router.post(
    "/{site_id}/publications",
    status_code=status.HTTP_201_CREATED,
    summary="Опубликовать черновик",
)
def publish(site_id: str, body: PublishRequest) -> PublicationResponse:
    return PublicationResponse(
        version=2,
        project_revision=body.project_revision,
        published_at=datetime.now(timezone.utc),
    )


@router.get("/{site_id}/publications", summary="История публикаций")
def list_publications(site_id: str) -> list[PublicationResponse]:
    return [PublicationResponse(version=1, project_revision=2, published_at=EXAMPLE_TIME)]


@router.post("/{site_id}/unpublish", summary="Снять туры с публикации")
def unpublish(site_id: str) -> PublicationResponse:
    return PublicationResponse(
        version=2,
        project_revision=None,
        published_at=datetime.now(timezone.utc),
    )