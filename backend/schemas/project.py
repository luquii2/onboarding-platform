from datetime import datetime
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from schemas.base import CamelModel, ClientId, HexColor

Url = Annotated[str, Field(max_length=2048)]

class Action(CamelModel):
    """Действие подготовки: например, открыть меню перед показом шага."""

    kind: Literal["click", "select"]
    selector: str = Field(min_length=1, max_length=2000)
    label: str = Field("", max_length=100)
    value: str | None = Field(None, max_length=500)

    @model_validator(mode="after")
    def select_needs_value(self) -> "Action":
        if self.kind == "select" and self.value is None:
            raise ValueError("Для действия select нужно значение value")
        return self

class Variant(CamelModel):
    selector: str = Field("", max_length=2000)
    actions: list[Action] = Field(default_factory=list, max_length=20)

class Variants(CamelModel):
    desktop: Variant = Field(default_factory=Variant)
    mobile: Variant = Field(default_factory=Variant)

class Step(CamelModel):
    model_config = ConfigDict(extra="allow")

    id: ClientId
    title: str = Field("", max_length=120)
    text: str = Field("", max_length=2000)
    page_url: Url
    selector: str = Field("", max_length=2000)
    variants: Variants = Field(default_factory=Variants)

class Trigger(CamelModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["offer", "click", "manual"]
    page_scope: Literal["all", "page"] = "all"
    page_url: Url = ""
    selector: str = Field("", max_length=2000)
    label: str = Field("", max_length=100)
    title: str = Field("", max_length=120)
    text: str = Field("", max_length=500)
    button_text: str = Field("", max_length=80)

class Scenario(CamelModel):
    model_config = ConfigDict(extra="allow")

    id: ClientId
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    color: HexColor = "#4f46e5"
    trigger_confirmation: str = Field("", max_length=16000)
    trigger: Trigger
    steps: list[Step] = Field(default_factory=list, max_length=50)

    @field_validator("steps")
    @classmethod
    def step_ids_are_unique(cls, steps: list[Step]) -> list[Step]:
        ids = [step.id for step in steps]
        if len(ids) != len(set(ids)):
            raise ValueError("Id шагов внутри сценария не должны повторяться")
        return steps

class Page(CamelModel):
    url: Url
    title: str = Field("", max_length=256)

class Project(CamelModel):
    """Весь проект сайта в формате панели (schema 4)."""

    model_config = ConfigDict(extra="allow")

    schema_version: Literal[4] = Field(4, alias="schema")
    site_id: str = Field("", max_length=100)
    active_scenario_id: str = Field("", max_length=100)
    pages: list[Page] = Field(default_factory=list, max_length=100)
    scenarios: list[Scenario] = Field(default_factory=list, max_length=20)

    @field_validator("scenarios")
    @classmethod
    def scenario_ids_are_unique(cls, scenarios: list[Scenario]) -> list[Scenario]:
        ids = [scenario.id for scenario in scenarios]
        if len(ids) != len(set(ids)):
            raise ValueError("Id сценариев не должны повторяться")
        return scenarios

class ProjectSaveRequest(CamelModel):
    base_revision: int = Field(ge=0)
    project: Project

class ProjectResponse(CamelModel):
    revision: int
    updated_at: datetime
    published_project_revision: int | None
    project: Project