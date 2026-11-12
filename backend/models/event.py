from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


"""События аналитики, присланное виджетом: запуск тура, показ шага и т. д."""
class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_id: Mapped[str] = mapped_column(String(100), unique=True)
    site_id: Mapped[str] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    scenario_external_id: Mapped[str | None] = mapped_column(String(100))
    step_external_id: Mapped[str | None] = mapped_column(String(100))
    run_id: Mapped[str | None] = mapped_column(String(100))
    visitor_id: Mapped[str | None] = mapped_column(String(100))
    device: Mapped[str | None] = mapped_column(String(20))
    page_url: Mapped[str | None] = mapped_column(String(2000))
    message: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
        )