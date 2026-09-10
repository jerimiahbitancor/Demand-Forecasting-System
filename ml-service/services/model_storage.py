"""
Model persistence via Supabase Storage — NOT local disk.

Render's free/standard web service tier uses ephemeral disk: anything
written to the local filesystem disappears on every restart, redeploy,
or scale event. A model saved to `./models/model.json` will simply be
gone the next time Render restarts the service, and /forecast would
fail with a confusing "no model found" error at some unpredictable
future moment — not at deploy time, which makes it a nasty bug to
diagnose after the fact. Supabase Storage survives restarts because it
isn't local disk at all.

This module is the only place that talks to Supabase Storage. Training
writes here via save_model_to_storage(); forecasting reads here via
load_latest_model_from_storage(). Local disk is used only as a
scratch/staging path in between, because xgboost's save_model/
load_model need a real file path — those temp files are deleted
immediately after upload/download.
"""
import os
import tempfile
from datetime import datetime
import xgboost as xgb

from config import supabase, SUPABASE_MODEL_BUCKET


def _list_model_versions() -> list:
    """
    Returns model version strings (filenames without .json), sorted
    oldest to newest. Version strings are UTC timestamps
    (model_v{YYYYMMDD_HHMMSS}), so lexicographic sort is chronological.
    """
    files = supabase.storage.from_(SUPABASE_MODEL_BUCKET).list()
    versions = [
        f["name"].replace(".json", "")
        for f in files
        if f["name"].endswith(".json")
    ]
    return sorted(versions)


def new_model_version() -> str:
    """Generates a new, clearly-dated version string for a fresh training run."""
    return f"model_v{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"


def save_model_to_storage(model: xgb.XGBRegressor, version: str) -> None:
    """
    Saves the trained model to a local temp file, then uploads it to
    Supabase Storage under exactly that version's filename. Nothing is
    ever overwritten — each training run gets its own timestamped file,
    which is what makes rollback (loading an older version) possible.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = os.path.join(tmp_dir, f"{version}.json")
        model.save_model(tmp_path)
        with open(tmp_path, "rb") as f:
            supabase.storage.from_(SUPABASE_MODEL_BUCKET).upload(
                f"{version}.json", f, {"content-type": "application/json"}
            )


def _download_model(version: str) -> xgb.XGBRegressor:
    data = supabase.storage.from_(SUPABASE_MODEL_BUCKET).download(f"{version}.json")
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = os.path.join(tmp_dir, f"{version}.json")
        with open(tmp_path, "wb") as f:
            f.write(data)
        model = xgb.XGBRegressor()
        model.load_model(tmp_path)
        return model


def load_latest_model():
    """Returns (model, version) for the most recently trained model, or (None, None)."""
    versions = _list_model_versions()
    if not versions:
        return None, None
    latest = versions[-1]
    return _download_model(latest), latest


def load_previous_model():
    """
    Returns (model, version) for the SECOND most recent model — the
    rollback target if the latest one turns out to perform worse.
    Returns (None, None) if there's no earlier version to roll back to.
    """
    versions = _list_model_versions()
    if len(versions) < 2:
        return None, None
    previous = versions[-2]
    return _download_model(previous), previous
