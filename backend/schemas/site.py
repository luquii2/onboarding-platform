from datetime import datetime
from typing import Literal

from pydantic import Field

from schemas.base import CamelModel

InstallationStatus = Literal["not_detected", "connected", "inactive"]

class SiteCreate(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    base_url: str = Field(min_length=1, max_length=2048)


class SiteUpdate(CamelModel):
    name: str = Field(min_length=1, max_length=200)

class SiteResponse(CamelModel):
    id: str
    name: str
    base_url: str
    origin: str
    base_path: str
    published_version: int
    installation_status: InstallationStatus
    scenarios_count: int
    starts_last_7_days: int
    last_seen_at: datetime | None
    last_seen_page: str | None
    widget_version: str | None
    created_at: datetime

class InstallationResponse(CamelModel):
    site_id: str
    script_tag: str
    widget_url: str
    config_url: str
    installation_status: InstallationStatus
    last_seen_at: datetime | None

class ObservedPage(CamelModel):
    url: str
    title: str = ""