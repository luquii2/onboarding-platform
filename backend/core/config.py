from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env")

    database_url: str

    # адреса панели управления, которым разрешено обращаться к API (CORS)
    cors_origins: list[str] = ["http://localhost:5173"]
    # адрес, по которому доступен этот бэкенд снаружи
    public_api_url: str = "http://127.0.0.1:8000"
    # где лежит файл виджета
    widget_url: str = "https://luquii2.github.io/onboarding-platform/widget.js"
    # адрес панели управления
    editor_origin: str = "http://localhost:5173"

settings = Settings()