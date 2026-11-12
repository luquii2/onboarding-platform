# Данные-заглушки
from datetime import datetime, timezone

from schemas.auth import UserResponse
from schemas.project import Project
from schemas.site import SiteResponse
from schemas.theme import ThemeSchema

EXAMPLE_TIME = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)

EXAMPLE_SITE_ID = "3f2a9c1e-7b4d-4e8a-9c1f-2d6b8a4e7f10"
EXAMPLE_BASE_URL = "https://kiralizanchuk.github.io/onboarding-test-site/"

EXAMPLE_USER = UserResponse(
    id=1,
    email="user@example.com",
    company_name="ООО «Ромашка»",
    created_at=EXAMPLE_TIME,
)

EXAMPLE_SITE = SiteResponse(
    id=EXAMPLE_SITE_ID,
    name="Тестовый сайт",
    base_url=EXAMPLE_BASE_URL,
    origin="https://kiralizanchuk.github.io",
    base_path="/onboarding-test-site/",
    published_version=1,
    installation_status="connected",
    scenarios_count=1,
    starts_last_7_days=86,
    last_seen_at=EXAMPLE_TIME,
    last_seen_page=EXAMPLE_BASE_URL,
    widget_version="1.0.0",
    created_at=EXAMPLE_TIME,
)

EXAMPLE_THEME = ThemeSchema()

EXAMPLE_PROJECT = Project.model_validate(
    {
        "schema": 4,
        "siteId": EXAMPLE_SITE_ID,
        "activeScenarioId": "school-intro",
        "pages": [{"url": EXAMPLE_BASE_URL, "title": "Главная"}],
        "scenarios": [
            {
                "id": "school-intro",
                "name": "Знакомство со школой",
                "enabled": True,
                "color": "#4f46e5",
                "triggerConfirmation": "",
                "trigger": {
                    "type": "offer",
                    "pageScope": "all",
                    "title": "Помочь освоиться?",
                    "text": "Покажем, как пользоваться сайтом.",
                    "buttonText": "Начать",
                },
                "steps": [
                    {
                        "id": "intro-home",
                        "title": "Добро пожаловать",
                        "text": "Здесь начинается знакомство со школой.",
                        "pageUrl": EXAMPLE_BASE_URL,
                        "selector": "#hero-title",
                    }
                ],
            }
        ],
    }
)