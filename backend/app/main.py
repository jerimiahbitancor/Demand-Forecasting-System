# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(
    title="ChefDuo Forecasting System API",
    version="0.1.0",
)

# Frontend (React/Vite) needs explicit CORS permission to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Sales Forecasting System",
    description="API for sales forecasting",
    version="1.0.0",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,  # Use settings from config
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "message": "ChefDuo Forecasting API is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}
# Health check endpoint
@app.get("/")
async def root():
    return {
        "message": "Sales Forecasting System API",
        "status": "running",
        "environment": settings.environment,
        "debug": settings.debug
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "environment": settings.environment
    }

# Startup event
@app.on_event("startup")
async def startup_event():
    logger.info("Starting Sales Forecasting System...")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info(f"Database: {settings.database_url}")
    logger.info(f"Allowed origins: {settings.allowed_origins}")

# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    logger.info("Shutting down Sales Forecasting System...")
