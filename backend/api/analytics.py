from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from api.stubs import EXAMPLE_SITE_ID
from schemas.analytics import (
    AnalyticsFilters,
    AnalyticsSummary,
    Funnel,
    FunnelStep,
    ScenarioStats,
    Timeseries,
    TimeseriesPoint,
)

router = APIRouter(prefix="/analytics", tags=["Аналитика"])


# общие фильтры аналитики из адресной строки: ?siteId=...&from=2026-11-01&to=2026-11-08
def get_filters(
    site_id: Annotated[str | None, Query(alias="siteId")] = None,
    scenario_id: Annotated[str | None, Query(alias="scenarioId")] = None,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    device: Annotated[Literal["desktop", "mobile"] | None, Query()] = None,
) -> AnalyticsFilters:
    return AnalyticsFilters(
        site_id=site_id,
        scenario_id=scenario_id,
        date_from=date_from,
        date_to=date_to,
        device=device,
    )


Filters = Annotated[AnalyticsFilters, Depends(get_filters)]


# период по умолчанию — последние 7 дней
def period(filters: AnalyticsFilters) -> tuple[date, date]:
    date_to = filters.date_to or date.today()
    date_from = filters.date_from or date_to - timedelta(days=7)
    return date_from, date_to


@router.get("/summary", summary="Сводка: запуски, пропуски, дошли до конца")
def summary(filters: Filters) -> AnalyticsSummary:
    date_from, date_to = period(filters)
    return AnalyticsSummary(
        period_from=date_from,
        period_to=date_to,
        started_runs=1240,
        skipped_runs=310,
        completed_runs=720,
        completion_rate=0.58,
        scenarios=[
            ScenarioStats(
                site_id=EXAMPLE_SITE_ID,
                scenario_id="school-intro",
                name="Знакомство со школой",
                started_runs=1240,
                skipped_runs=310,
                completed_runs=720,
                completion_rate=0.58,
            )
        ],
    )


@router.get("/timeseries", summary="Данные для графика по дням")
def timeseries(filters: Filters) -> Timeseries:
    date_from, date_to = period(filters)
    points = []
    day = date_from
    while day < date_to:
        points.append(
            TimeseriesPoint(day=day, started_runs=170, skipped_runs=40, completed_runs=100)
        )
        day += timedelta(days=1)
    return Timeseries(points=points)


@router.get("/funnel", summary="Воронка по шагам сценария")
def funnel(
    site_id: Annotated[str, Query(alias="siteId")],
    scenario_id: Annotated[str, Query(alias="scenarioId")],
    config_version: Annotated[int, Query(alias="configVersion", ge=1)],
) -> Funnel:
    return Funnel(
        site_id=site_id,
        scenario_id=scenario_id,
        config_version=config_version,
        steps=[
            FunnelStep(step_id="step-1", title="Шаг 1", shown_runs=1240, completed_runs=960),
            FunnelStep(step_id="step-2", title="Шаг 2", shown_runs=960, completed_runs=760),
            FunnelStep(step_id="step-3", title="Шаг 3", shown_runs=760, completed_runs=720),
        ],
    )