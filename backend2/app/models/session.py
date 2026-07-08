# app/models/session.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """
    FastAPI dependency. Provides one database session per incoming request,
    and guarantees it closes afterward — even if the request raises an error.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()