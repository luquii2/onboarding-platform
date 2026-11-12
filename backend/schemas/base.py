from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

class CamelModel(BaseModel):
    """Базовая схема: в JSON поля называются в стиле camelCase, как во фронтенде."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_alias=True,
        validate_by_name=True,
        serialize_by_alias=True,
        from_attributes=True,
        )

ClientId = Annotated[str, Field(min_length=1, max_length=100)]

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]