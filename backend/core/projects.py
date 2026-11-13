import uuid


# новый проект в формате панели (schema 4): один пустой «Основной сценарий»,
# как его создаёт функция createScenario в src/model.js
def new_project(site_id: str, base_url: str) -> dict:
    scenario_id = str(uuid.uuid4())
    return {
        "schema": 4,
        "siteId": site_id,
        "activeScenarioId": scenario_id,
        "pages": [{"url": base_url, "title": "Главная страница"}],
        "scenarios": [
            {
                "id": scenario_id,
                "name": "Основной сценарий",
                "enabled": True,
                "color": "#4f46e5",
                "steps": [],
                "triggerConfirmation": "",
                "trigger": {
                    "type": "offer",
                    "pageScope": "all",
                    "pageUrl": "",
                    "selector": "",
                    "label": "",
                    "title": "Показать, как всё устроено?",
                    "text": "Пройдите короткое обучение и познакомьтесь с возможностями сайта.",
                    "buttonText": "Начать обучение",
                },
            }
        ],
    }