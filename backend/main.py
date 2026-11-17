import uvicorn

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.router import api_router
from core.cors import SplitCORSMiddleware
from db import get_db

app = FastAPI(title="Onboarding app API")

# CORS: свои правила для панели и для виджета (core/cors.py)
app.add_middleware(SplitCORSMiddleware)

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