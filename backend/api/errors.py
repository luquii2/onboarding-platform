from fastapi import HTTPException


# ошибка в едином формате: {"detail": {"code": "...", "message": "...", ...дополнительные поля}}
def api_error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})