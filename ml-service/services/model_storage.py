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
import json
import os
import re
import tempfile
from datetime import datetime
import xgboost as xgb

from config import supabase, SUPABASE_MODEL_BUCKET

# Only real model files match this. The metadata sidecar
# ("model_v..._meta.json") must NOT be mistaken for a model version,
# otherwise load_latest_model() would try to load it as a model.
_MODEL_FILE_RE = re.compile(r"^(model_v\d{8}_\d{6})\.json$")


def _list_model_versions() -> list:
    """
    Returns model version strings (filenames without .json), sorted
    oldest to newest. Version strings are UTC timestamps
    (model_v{YYYYMMDD_HHMMSS}), so lexicographic sort is chronological.
    Metadata sidecar files are skipped.
    """
    files = supabase.storage.from_(SUPABASE_MODEL_BUCKET).list()
    versions = []
    for f in files:
        match = _MODEL_FILE_RE.match(f["name"])
        if match:
            versions.append(match.group(1))
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


def save_model_metadata(version: str, metadata: dict) -> None:
    """
    Saves a small JSON file next to the model: "{version}_meta.json".

    WHY THIS EXISTS: XGBoost does not remember product IDs. It
    remembers each product's POSITION in the category list it was
    trained with (1st, 2nd, 3rd...). At forecast time the exact same
    list, in the exact same order, must be used again — otherwise
    product 40 can be read as "position 2" and get the forecast the
    model learned for a different product. This file stores that list.

    It also stores which products actually had training rows, so
    /forecast only forecasts products the model has learned.
    """
    payload = json.dumps(metadata).encode("utf-8")
    supabase.storage.from_(SUPABASE_MODEL_BUCKET).upload(
        f"{version}_meta.json", payload, {"content-type": "application/json"}
    )


def _is_not_found(exc: Exception) -> bool:
    """
    True only when Storage said the object does not exist.

    storage3 0.5.5 raises StorageException carrying a dict like
    {'statusCode': 400, 'error': 'not_found', 'message': 'Object not
    found', 'code': 'NoSuchKey'} — note statusCode is 400, NOT 404, so
    matching on 404 would never fire. The string fallback keeps this
    working if a later storage3 changes the payload shape.
    """
    for arg in exc.args:
        if isinstance(arg, dict):
            if arg.get("error") == "not_found" or arg.get("code") == "NoSuchKey":
                return True
    text = str(exc).lower()
    return "not_found" in text or "nosuchkey" in text


def load_model_metadata(version: str):
    """
    Returns the metadata dict saved with this model version, or None
    for models trained before metadata existed (legacy models).

    Only a genuine "object not found" returns None. Any other failure
    (network blip, auth, corrupt JSON) is raised, deliberately: None
    sends /forecast down the legacy fallback, which rebuilds the
    category list by guessing. That guess can hand one product another
    product's forecast — reproduced on xgboost 2.1.1, see
    tests/test_category_order.py. A transient error must not be allowed
    to silently trigger it.
    """
    try:
        data = supabase.storage.from_(SUPABASE_MODEL_BUCKET).download(f"{version}_meta.json")
    except Exception as exc:
        if _is_not_found(exc):
            return None
        raise
    return json.loads(data)


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
