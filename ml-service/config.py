"""
Central place for environment configuration and the Supabase client.

Every other module imports `supabase` from here rather than creating
its own client. One client, one place to change credentials.

NOTE on model storage: MODEL_DIR below is a LOCAL SCRATCH directory
only — XGBoost's save_model()/load_model() need a real filesystem
path, so model_storage.py writes to MODEL_DIR temporarily and then
uploads to Supabase Storage (bucket SUPABASE_MODEL_BUCKET), which is
the actual persistent store. Render's free/standard web service disk
is ephemeral — anything left only in MODEL_DIR is lost on restart or
redeploy. Never treat MODEL_DIR as durable.
"""
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
ML_SERVICE_SHARED_SECRET = os.environ.get("ML_SERVICE_SHARED_SECRET")
MODEL_DIR = os.environ.get("MODEL_DIR", "./models")
SUPABASE_MODEL_BUCKET = os.environ.get("SUPABASE_MODEL_BUCKET", "ml-models")
MIN_TRAINING_DAYS = int(os.environ.get("MIN_TRAINING_DAYS", "90"))

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. "
        "Copy .env.example to .env and fill them in."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

os.makedirs(MODEL_DIR, exist_ok=True)
