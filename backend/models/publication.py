from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base

if TYPE_CHECKING:
    from models.site import Site


# Неизменяемый снимок опубликованных сценариев сайта.
class Publication(Base):
    __tablename__ = "publications"
    __table_args__ = (UniqueConstraint("site_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    version: Mapped[int]
    project_revision: Mapped[int | None]
    config: Mapped[dict] = mapped_column(JSONB)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
        )
    site: Mapped["Site"] = relationship(back_populates="publications")