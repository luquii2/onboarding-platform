import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base

if TYPE_CHECKING:
    from models.project_draft import ProjectDraft
    from models.publication import Publication
    from models.theme import Theme
    from models.user import User

"""Случайный идентификатор сайта."""
def generate_site_id() -> str:
    return str(uuid.uuid4())

"""Сайты клиентов."""
class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (UniqueConstraint("owner_id", "base_url"),)

    id: Mapped[str] = mapped_column(String(100), primary_key=True, default=generate_site_id)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    base_url: Mapped[str] = mapped_column(String(2048))
    origin: Mapped[str] = mapped_column(String(300))
    base_path: Mapped[str] = mapped_column(String(2048), default="/")
    published_version: Mapped[int] = mapped_column(default=0)

    # данные о подключении виджета
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_page: Mapped[str | None] = mapped_column(String(2048))
    widget_version: Mapped[str | None] = mapped_column(String(50))
    observed_pages: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
        )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        )

    owner: Mapped["User"] = relationship(back_populates="sites")
    theme: Mapped["Theme | None"] = relationship(
        back_populates="site", cascade="all, delete-orphan", uselist=False
        )
    draft: Mapped["ProjectDraft | None"] = relationship(
        back_populates="site", cascade="all, delete-orphan", uselist=False
        )
    publications: Mapped[list["Publication"]] = relationship(
        back_populates="site",
        cascade="all, delete-orphan",
        order_by="Publication.version",
        )