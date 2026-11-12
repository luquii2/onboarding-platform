from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base

if TYPE_CHECKING:
    from models.scenario import Scenario

"""Шаги сценария."""
class Step(Base):
    __tablename__ = "steps"
    __table_args__ = (UniqueConstraint("scenario_id", "external_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(100))
    scenario_id: Mapped[int] = mapped_column(ForeignKey("scenarios.id", ondelete="CASCADE"))
    position: Mapped[int]
    title: Mapped[str] = mapped_column(String(120))
    text: Mapped[str] = mapped_column(Text, default="")
    page_url: Mapped[str] = mapped_column(String(2000))
    selector: Mapped[str] = mapped_column(String(2000), default="")
    element_label: Mapped[str] = mapped_column(String(100), default="")
    variants: Mapped[dict] = mapped_column(JSONB)

    # настройки с экрана «Редактирование шага»
    placement: Mapped[str] = mapped_column(String(10), default="auto")
    show_back: Mapped[bool] = mapped_column(default=True)
    show_next: Mapped[bool] = mapped_column(default=True)
    show_skip: Mapped[bool] = mapped_column(default=True)
    show_close: Mapped[bool] = mapped_column(default=True)
    highlight: Mapped[bool] = mapped_column(default=True)
    dim_background: Mapped[bool] = mapped_column(default=True)

    scenario: Mapped["Scenario"] = relationship(back_populates="steps")