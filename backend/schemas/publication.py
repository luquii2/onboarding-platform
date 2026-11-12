from datetime import datetime

from pydantic import Field

from schemas.base import CamelModel

class PublishRequest(CamelModel):
    project_revision: int = Field(ge=0)

class PublicationResponse(CamelModel):
    version: int
    project_revision: int | None
    published_at: datetime