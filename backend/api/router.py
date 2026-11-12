from fastapi import APIRouter

from api import analytics, auth, project, public, publications, sites, themes

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(sites.router)
api_router.include_router(themes.router)
api_router.include_router(project.router)
api_router.include_router(publications.router)
api_router.include_router(public.router)
api_router.include_router(analytics.router)