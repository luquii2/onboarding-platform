from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from core.urls import parse_site_url
from schemas.base import CamelModel

InstallationStatus = Literal["not_detected", "connected", "inactive"]

# убирает пробелы по краям названия и не даёт сохранить название из одних пробелов
def clean_site_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Укажите название сайта")
    return value


class SiteCreate(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    base_url: str = Field(min_length=1, max_length=2048)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return clean_site_name(value)

    # проверяет адрес и заменяет его приведённым к единому виду
    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        return parse_site_url(value).base_url


class SiteUpdate(CamelModel):
    name: str = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str) -> str:
        return clean_site_name(value)

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