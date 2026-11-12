from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


# События аналитики, присланные виджетом.
class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("site_id", "event_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    event_id: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(50))
    run_id: Mapped[str] = mapped_column(String(100))
    scenario_id: Mapped[str] = mapped_column(String(100))
    config_version: Mapped[int]
    step_id: Mapped[str | None] = mapped_column(String(100))
    step_index: Mapped[int | None]
    device: Mapped[str | None] = mapped_column(String(20))
    page_url: Mapped[str | None] = mapped_column(String(2048))
    message: Mapped[str | None] = mapped_column(String(500))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
        )