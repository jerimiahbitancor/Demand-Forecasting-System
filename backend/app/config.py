# app/config.py
from pydantic_settings import BaseSettings
from pathlib import Path

# Anchors to the project root (parent of app/), regardless of current working directory
BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

class Settings(BaseSettings):
    database_url: str
    secret_key: str
    environment: str = "development"
    debug: bool = False
    admin_email: str
    admin_password: str
    allowed_origins: list[str] = ["http://localhost:5173"]

    class Config:
        env_file = ENV_PATH

settings = Settings()