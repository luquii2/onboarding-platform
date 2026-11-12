from datetime import datetime, timezone

from fastapi import APIRouter

from api.stubs import EXAMPLE_PROJECT, EXAMPLE_TIME
from schemas.project import ProjectResponse, ProjectSaveRequest

router = APIRouter(prefix="/sites", tags=["Конструктор"])


@router.get("/{site_id}/project", summary="Получить черновик проекта")
def get_project(site_id: str) -> ProjectResponse:
    return ProjectResponse(
        revision=3,
        updated_at=EXAMPLE_TIME,
        published_project_revision=2,
        project=EXAMPLE_PROJECT,
    )


@router.put("/{site_id}/project", summary="Сохранить черновик проекта")
def save_project(site_id: str, body: ProjectSaveRequest) -> ProjectResponse:
    # заглушка: проект проверяется по схеме и возвращается с новой ревизией, но не сохраняется
    return ProjectResponse(
        revision=body.base_revision + 1,
        updated_at=datetime.now(timezone.utc),
        published_project_revision=None,
        project=body.project,
    )