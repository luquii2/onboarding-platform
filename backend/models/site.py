import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base

if TYPE_CHECKING:
    from models.scenario import Scenario
    from models.theme import Theme
    from models.user import User


def generate_site_id() -> str:
    """Случайный идентификатор сайта."""
    return str(uuid.uuid4())

"""Сайты клиентов."""
class Site(Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(100), primary_key=True, default=generate_site_id)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    origin: Mapped[str] = mapped_column(String(300))
    pages: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
        )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        )
    owner: Mapped["User"] = relationship(back_populates="sites")
    scenarios: Mapped[list["Scenario"]] = relationship(
        back_populates="site",
        cascade="all, delete-orphan",
        order_by="Scenario.position",
        )
    theme: Mapped["Theme | None"] = relationship(
        back_populates="site", cascade="all, delete-orphan", uselist=False
        )