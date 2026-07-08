# app/main.py
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="ChefDuo Forecasting System",
    description="API for chef duo forecasting",
    version="1.0.0",
)

# Configure CORS — frontend (React/Vite) needs explicit permission to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "message": "ChefDuo Forecasting System API",
        "status": "running",
        "environment": settings.environment,
        "debug": settings.debug,
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "environment": settings.environment,
    }


@app.on_event("startup")
async def startup_event():
    logger.info("Starting ChefDuo Forecasting System...")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info(f"Allowed origins: {settings.allowed_origins}")


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down ChefDuo Forecasting System...")