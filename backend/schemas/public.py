from datetime import datetime
from typing import Literal

from pydantic import Field

from schemas.base import CamelModel, ClientId, HexColor
from schemas.project import Step, Trigger
from schemas.theme import ThemeSchema

class PublicScenario(CamelModel):
    id: str
    name: str
    color: HexColor
    trigger: Trigger
    steps: list[Step]

class WidgetConfig(CamelModel):
    """Конфигурация для виджета: формат exportProject из src/model.js + версия и тема."""

    schema_version: Literal[1] = Field(1, alias="schema")
    site_id: str
    origin: str
    version: int
    theme: ThemeSchema | None = None
    scenarios: list[PublicScenario]

class ConnectRequest(CamelModel):
    page_url: str = Field(min_length=1, max_length=2048)
    page_title: str = Field("", max_length=256)
    widget_version: str = Field("", max_length=50)
    config_version: int = Field(0, ge=0)

EventName = Literal[
    "tour_started",
    "step_shown",
    "step_completed",
    "tour_progress",
    "tour_navigate",
    "tour_completed",
    "tour_skipped",
    "tour_stopped",
    "tour_error",
]

class EventIn(CamelModel):
    event_id: ClientId
    name: EventName
    run_id: ClientId
    scenario_id: ClientId
    config_version: int = Field(ge=0)
    step_id: str | None = Field(None, max_length=100)
    step_index: int | None = Field(None, ge=0, alias="index")
    device: Literal["desktop", "mobile"] | None = None
    page_url: str | None = Field(None, max_length=2048)
    message: str | None = Field(None, max_length=500)
    occurred_at: datetime

class EventBatch(CamelModel):
    events: list[EventIn] = Field(min_length=1, max_length=50)

class EventBatchResponse(CamelModel):
    accepted: int
    duplicates: int