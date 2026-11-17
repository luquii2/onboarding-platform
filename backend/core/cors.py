from fastapi.middleware.cors import CORSMiddleware

from core.config import settings

# адреса, к которым обращается виджет с сайтов клиентов
PUBLIC_PREFIX = "/api/v1/public/"


# Разные правила CORS для панели и для виджета.
# Панель: только адреса из CORS_ORIGINS, с заголовком Authorization.
# Виджет: любой сайт, но без cookie и без Authorization;
# какой сайт может записывать данные, проверяет сам эндпоинт (check_site_origin).
class SplitCORSMiddleware:
    def __init__(self, app):
        self.panel = CORSMiddleware(
            app,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        self.public = CORSMiddleware(
            app,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type"],
            max_age=86400,
        )

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].startswith(PUBLIC_PREFIX):
            await self.public(scope, receive, send)
        else:
            await self.panel(scope, receive, send)