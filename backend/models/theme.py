from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base

if TYPE_CHECKING:
    from models.site import Site

# Темы оформления.
class Theme(Base):
    __tablename__ = "themes"

    site_id: Mapped[str] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True
        )
    primary_color: Mapped[str] = mapped_column(String(7), default="#4F46E5")
    text_color: Mapped[str] = mapped_column(String(7), default="#0F172A")
    background_color: Mapped[str] = mapped_column(String(7), default="#FFFFFF")
    font_family: Mapped[str] = mapped_column(String(100), default="Inter")
    border_radius: Mapped[int] = mapped_column(default=8)
    default_placement: Mapped[str] = mapped_column(String(10), default="bottom")
    card_style: Mapped[str] = mapped_column(String(10), default="light")
    show_progress: Mapped[bool] = mapped_column(default=True)
    show_skip: Mapped[bool] = mapped_column(default=True)
    site: Mapped["Site"] = relationship(back_populates="theme")