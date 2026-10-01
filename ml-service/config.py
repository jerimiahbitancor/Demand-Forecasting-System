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

# Renamed from MIN_TRAINING_DAYS: this counts actual valid daily sales
# OBSERVATIONS (rows in daily_sales), never calendar days elapsed —
# see get_training_eligible_products() in data_loader.py. The old name
# implied a calendar-age requirement, which is explicitly wrong per
# the eligibility clarification: a product open 40 calendar days with
# sales on only 20 of them has 20 observations, not 40, and stays
# ineligible.
MIN_TRAINING_OBSERVATIONS = int(os.environ.get("MIN_TRAINING_OBSERVATIONS", "28"))

# How many consecutive no-sale CONFIRMED-OPEN days mean a product was off
# the menu rather than simply not selling. Shorter runs get zero-filled;
# runs this long or longer are left out and the product's history resumes
# at its next sale. See services/zero_fill.py for the full rule.
#
# It lives here, next to MIN_TRAINING_OBSERVATIONS, because both are
# ML-pipeline tunables read by training AND forecasting, and this file is
# already the one place either side looks for them.
#
# Same number as the INACTIVE (DISCONTINUED) badge window, deliberately —
# but NOT the same rule and not shared in code: the badges count CALENDAR
# days in backend/services/productStatusService.js (locked decision),
# this counts CONFIRMED-OPEN days.
OFF_MENU_GAP_OPEN_DAYS = int(os.environ.get("OFF_MENU_GAP_OPEN_DAYS", "28"))

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. "
        "Copy .env.example to .env and fill them in."
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

os.makedirs(MODEL_DIR, exist_ok=True)
