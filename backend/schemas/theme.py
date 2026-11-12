from typing import Literal

from pydantic import Field

from schemas.base import CamelModel, HexColor

class ThemeSchema(CamelModel):
    primary_color: HexColor = "#4F46E5"
    text_color: HexColor = "#0F172A"
    background_color: HexColor = "#FFFFFF"
    font_family: str = Field("Inter", min_length=1, max_length=100)
    border_radius: int = Field(8, ge=0, le=32)
    default_placement: Literal["top", "bottom", "left", "right"] = "bottom"
    card_style: Literal["light", "colored"] = "light"
    show_progress: bool = True
    show_skip: bool = True