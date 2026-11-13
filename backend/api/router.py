from fastapi import APIRouter, Depends

from api import analytics, auth, project, public, publications, sites, themes
from api.deps import get_current_user

api_router = APIRouter(prefix="/api/v1")

# открытые эндпоинты: вход и регистрация, публичные адреса для виджета
api_router.include_router(auth.router)
api_router.include_router(public.router)

# закрытые эндпоинты панели: без действующего токена — ошибка 401
private = [Depends(get_current_user)]
api_router.include_router(sites.router, dependencies=private)
api_router.include_router(themes.router, dependencies=private)
api_router.include_router(project.router, dependencies=private)
api_router.include_router(publications.router, dependencies=private)
api_router.include_router(analytics.router, dependencies=private)