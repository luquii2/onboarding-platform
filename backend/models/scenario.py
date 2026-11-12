from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base

if TYPE_CHECKING:
    from models.site import Site
    from models.step import Step

"""Список туров: набор шагов и способ запуска."""
class Scenario(Base):
    __tablename__ = "scenarios"
    __table_args__ = (UniqueConstraint("site_id", "external_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(100))
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    enabled: Mapped[bool] = mapped_column(default=False)
    color: Mapped[str] = mapped_column(String(7), default="#4F46E5")
    trigger: Mapped[dict] = mapped_column(JSONB)
    position: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
        )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
        )
    site: Mapped["Site"] = relationship(back_populates="scenarios")
    steps: Mapped[list["Step"]] = relationship(
        back_populates="scenario",
        cascade="all, delete-orphan",
        order_by="Step.position",
        )