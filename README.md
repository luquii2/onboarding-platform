## Backend
## Необходимый инструментарий:

Требуется Python 3.14+ и PostgreSQL 13+.

### Подготовка базы данных:

Подключитесь к PostgreSQL под пользователем `postgres` (через DBeaver, pgAdmin или psql) и выполните:

```sql
CREATE USER onboarding_app_admin WITH PASSWORD 'TST5399112';
CREATE DATABASE onboarding_db OWNER onboarding_app_admin;
```

### Установка библиотек и запуск:

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload
```

Проверка работы (запрос типа GET, возвращает ответ в формате JSON, иначе 501): http://127.0.0.1:8000/testconnect/
Документация API: http://127.0.0.1:8000/docs
