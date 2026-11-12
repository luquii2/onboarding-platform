from datetime import date
from typing import Literal

from schemas.base import CamelModel

class AnalyticsFilters(CamelModel):
    site_id: str | None = None
    scenario_id: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    device: Literal["desktop", "mobile"] | None = None

class ScenarioStats(CamelModel):
    site_id: str
    scenario_id: str
    name: str
    started_runs: int
    skipped_runs: int
    completed_runs: int
    completion_rate: float

class AnalyticsSummary(CamelModel):
    period_from: date
    period_to: date
    started_runs: int
    skipped_runs: int
    completed_runs: int
    completion_rate: float
    scenarios: list[ScenarioStats]

class TimeseriesPoint(CamelModel):
    day: date
    started_runs: int
    skipped_runs: int
    completed_runs: int

class Timeseries(CamelModel):
    points: list[TimeseriesPoint]

class FunnelStep(CamelModel):
    step_id: str
    title: str
    shown_runs: int
    completed_runs: int

class Funnel(CamelModel):
    site_id: str
    scenario_id: str
    config_version: int
    steps: list[FunnelStep]