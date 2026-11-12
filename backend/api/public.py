from typing import Annotated

from fastapi import APIRouter, Query, status

from api.stubs import EXAMPLE_PROJECT, EXAMPLE_THEME
from schemas.public import (
    ConnectRequest,
    EventBatch,
    EventBatchResponse,
    PublicScenario,
    WidgetConfig,
)

router = APIRouter(prefix="/public/sites", tags=["Виджет"])


@router.get("/{site_id}/config", summary="Опубликованная конфигурация для виджета")
def get_config(
    site_id: str,
    version: Annotated[int | None, Query(ge=0)] = None,
) -> WidgetConfig:
    scenarios = [
        PublicScenario(
            id=scenario.id,
            name=scenario.name,
            color=scenario.color,
            trigger=scenario.trigger,
            steps=scenario.steps,
        )
        for scenario in EXAMPLE_PROJECT.scenarios
        if scenario.enabled
    ]
    return WidgetConfig(
        site_id=site_id,
        origin="https://kiralizanchuk.github.io",
        version=version or 1,
        theme=EXAMPLE_THEME,
        scenarios=scenarios,
    )


@router.post(
    "/{site_id}/connect",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Сигнал подключения виджета",
)
def connect(site_id: str, body: ConnectRequest) -> None:
    return None


@router.post(
    "/{site_id}/events",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Пачка событий от виджета",
)
def receive_events(site_id: str, body: EventBatch) -> EventBatchResponse:
    return EventBatchResponse(accepted=len(body.events), duplicates=0)