from datetime import datetime, timedelta, timezone

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session

from core.config import settings
from models import Event, ProjectDraft, Site
from schemas.site import InstallationStatus, SiteResponse


# статус виджета по времени последнего сигнала
def installation_status(site: Site) -> InstallationStatus:
    if site.last_seen_at is None:
        return "not_detected"
    active_since = datetime.now(timezone.utc) - timedelta(hours=settings.widget_active_hours)
    return "connected" if site.last_seen_at >= active_since else "inactive"


# собирает карточки для списка сайтов: два запроса на весь список, а не по запросу на сайт
def build_site_responses(db: Session, sites: list[Site]) -> list[SiteResponse]:
    site_ids = [site.id for site in sites]
    if not site_ids:
        return []

    # число туров: длина списка scenarios внутри JSON черновика, считает сама база
    scenarios_count = dict(
        db.execute(
            select(ProjectDraft.site_id, func.jsonb_array_length(ProjectDraft.data["scenarios"]))
            .where(ProjectDraft.site_id.in_(site_ids))
        ).all()
    )

    # запуски за 7 дней: число разных прохождений с событием tour_started
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    starts = dict(
        db.execute(
            select(Event.site_id, func.count(distinct(Event.run_id)))
            .where(
                Event.site_id.in_(site_ids),
                Event.name == "tour_started",
                Event.received_at >= week_ago,
            )
            .group_by(Event.site_id)
        ).all()
    )

    return [
        SiteResponse(
            id=site.id,
            name=site.name,
            base_url=site.base_url,
            origin=site.origin,
            base_path=site.base_path,
            published_version=site.published_version,
            installation_status=installation_status(site),
            scenarios_count=scenarios_count.get(site.id, 0),
            starts_last_7_days=starts.get(site.id, 0),
            last_seen_at=site.last_seen_at,
            last_seen_page=site.last_seen_page,
            widget_version=site.widget_version,
            created_at=site.created_at,
        )
        for site in sites
    ]