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