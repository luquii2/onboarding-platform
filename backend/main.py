import uvicorn

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db

app = FastAPI(title="Onboarding app API")

@app.get("/testconnect/")
def test_connection(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {
        "status": "ok", 
        "database": "ok"
        }

if __name__ == '__main__':
    uvicorn.run("main:app", reload=True)