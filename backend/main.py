import uvicorn

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.router import api_router
from core.config import settings
from db import get_db

app = FastAPI(title="Onboarding app API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# подключение эндпоинтов
app.include_router(api_router)

@app.get("/testconnect/")
def test_connection(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {
        "status": "ok", 
        "database": "ok"
        }

if __name__ == '__main__':
    uvicorn.run("main:app", reload=True)