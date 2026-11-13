import json

from core.urls import page_belongs_to_site
from models import Site
from schemas.project import Action, Project, Scenario, Step, Trigger

# максимальный размер проекта в байтах (как в панели: 500 КБ)
MAX_PROJECT_BYTES = 500_000


# размер проекта в байтах UTF-8
def project_size(data: dict) -> int:
    return len(json.dumps(data, ensure_ascii=False).encode("utf-8"))


# адреса страниц проекта, которые не относятся к сайту
def foreign_pages(project: Project, site: Site) -> list[str]:
    urls = [page.url for page in project.pages]
    for scenario in project.scenarios:
        urls.extend(step.page_url for step in scenario.steps)
        if scenario.trigger.page_url:
            urls.append(scenario.trigger.page_url)
    return [url for url in urls if not page_belongs_to_site(url, site.origin, site.base_path)]


# область запуска с тем же правилом, что triggerPageScope в src/model.js
def page_scope(trigger: Trigger) -> str:
    return trigger.page_scope or ("page" if trigger.page_url else "all")


# подпись настроек запуска — точная копия функции triggerKey из src/model.js
def trigger_key(trigger: Trigger) -> str:
    key = {
        "type": trigger.type,
        "pageScope": "all" if trigger.type == "manual" else page_scope(trigger),
        "pageUrl": trigger.page_url
        if trigger.type != "manual" and page_scope(trigger) == "page"
        else "",
    }
    if trigger.type == "offer":
        key |= {"title": trigger.title, "text": trigger.text, "buttonText": trigger.button_text}
    if trigger.type == "click":
        key["selector"] = trigger.selector
    return json.dumps(key, ensure_ascii=False, separators=(",", ":"))


# ошибки настроек запуска — те же проверки, что triggerErrors в src/model.js
def trigger_errors(trigger: Trigger, site: Site) -> list[str]:
    errors = []
    if trigger.type == "offer":
        if not trigger.title.strip():
            errors.append("Добавьте заголовок приглашения.")
        if not trigger.text.strip():
            errors.append("Добавьте текст приглашения.")
        if not trigger.button_text.strip():
            errors.append("Добавьте текст кнопки.")
    if trigger.type == "click" and not trigger.selector.strip():
        errors.append("Выберите элемент запуска в окне сайта.")
    if trigger.type != "manual" and page_scope(trigger) == "page":
        if not trigger.page_url.strip():
            errors.append("Выберите страницу запуска.")
        elif not page_belongs_to_site(trigger.page_url, site.origin, site.base_path):
            errors.append("Выберите страницу подключённого сайта.")
    return errors


# шаг без выбранного элемента — как isDraft в src/model.js
def step_is_draft(step: Step) -> bool:
    return not (step.selector or step.variants.desktop.selector or step.variants.mobile.selector)


# все причины, по которым проект нельзя опубликовать
def readiness_errors(project: Project, site: Site) -> list[dict]:
    enabled = [scenario for scenario in project.scenarios if scenario.enabled]
    if not enabled:
        return [{"scenarioId": None, "message": "Включите хотя бы один готовый сценарий."}]

    errors = []
    for scenario in enabled:
        messages = []
        if not scenario.steps:
            messages.append("Добавьте шаги в сценарий.")
        for number, step in enumerate(scenario.steps, start=1):
            if step_is_draft(step):
                messages.append(f"Выберите цель шага {number}.")
        trigger_problems = trigger_errors(scenario.trigger, site)
        messages.extend(trigger_problems)
        if not trigger_problems and scenario.trigger_confirmation != trigger_key(scenario.trigger):
            messages.append("Сохраните настройки запуска сценария.")
        errors.extend(
            {"scenarioId": scenario.id, "message": f"«{scenario.name}»: {message}"}
            for message in messages
        )
    return errors


# действия подготовки в том же виде, что normalizeActions в src/model.js
def export_actions(actions: list[Action]) -> list[dict]:
    result = []
    for action in actions:
        item = {"kind": action.kind, "selector": action.selector, "label": action.label}
        if action.kind == "select":
            item["value"] = action.value or ""
        result.append(item)
    return result


# настройки шага для устройства — как configFor в src/model.js
def export_variant(step: Step, device: str) -> dict:
    variant = getattr(step.variants, device)
    return {
        "selector": variant.selector or step.selector or "",
        "actions": export_actions(variant.actions),
    }


# сценарий для конфигурации виджета — как exportProject в src/model.js
def export_scenario(scenario: Scenario) -> dict:
    trigger = scenario.trigger.model_dump(mode="json")
    if scenario.trigger.type == "manual" or page_scope(scenario.trigger) != "page":
        trigger["pageUrl"] = ""
    return {
        "id": scenario.id,
        "name": scenario.name,
        "color": scenario.color,
        "trigger": trigger,
        "steps": [
            {
                "id": step.id,
                "title": step.title,
                "text": step.text,
                "pageUrl": step.page_url,
                "selector": step.selector,
                "variants": {
                    "desktop": export_variant(step, "desktop"),
                    "mobile": export_variant(step, "mobile"),
                },
            }
            for step in scenario.steps
        ],
    }


# включённые сценарии проекта в формате конфигурации виджета
def export_scenarios(project: Project) -> list[dict]:
    return [export_scenario(scenario) for scenario in project.scenarios if scenario.enabled]