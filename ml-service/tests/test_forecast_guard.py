"""
Tests the /forecast feature-set guard against the REAL Flask route.

WHY THIS GUARD EXISTS: XGBoost is handed a matrix of columns in a fixed
order and has no idea what they mean. FEATURE_COLUMNS changed on
Oct 1 2026 (lag_7 out, same_dow_last_open and days_since_last_open in,
11 -> 12). Predicting with a model trained on the old set would feed each
column into whatever slot lines up and return confident nonsense — the
same class of silent-wrong failure as the category-order bug. So
/forecast compares the model's saved feature_columns with the current
ones and refuses on any mismatch.

It also refuses a model with NO metadata sidecar at all, because sidecars
only started being written on Sep 29 2026, which is BEFORE the feature
change — so a model without one necessarily predates the current set.

Run:  cd ml-service && python tests/test_forecast_guard.py
Nothing here reaches Supabase: every data_loader call the route makes is
replaced with a stub first, and the route returns before touching the DB.
"""
import os
import sys

import pandas as pd

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoidGVzdCJ9.not-a-real-signature",
)
os.environ.setdefault("ML_SERVICE_SHARED_SECRET", "test-secret")

import app as flask_app  # noqa: E402
from services.feature_engineering import FEATURE_COLUMNS  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


HEADERS = {"X-ML-Service-Secret": os.environ["ML_SERVICE_SHARED_SECRET"]}


class DummyModel:
    """If the guard ever lets a mismatched model through, this records it."""

    def __init__(self):
        self.predict_calls = 0

    def predict(self, X):
        self.predict_calls += 1
        return [1.0]


def install_stubs(metadata, model):
    """Replace every data_loader/storage call /forecast makes before the guard."""
    flask_app.load_latest_model = lambda: (model, "model_v20260101_000000")
    flask_app.load_model_metadata = lambda version: metadata
    flask_app.get_active_products = lambda: pd.DataFrame(
        [{"id": 1, "name": "Test Dish", "price": 100.0,
          "is_active": True, "status": "active", "first_sold_date": "2025-07-10"}]
    )
    flask_app.get_recipe_and_stock = lambda: pd.DataFrame(
        columns=["product_id", "qty_per_serving", "ingredient_id",
                 "ingredient_name", "unit", "unit_cost", "current_stock"]
    )
    flask_app.get_safety_buffer_percentage = lambda: 15.0
    flask_app.get_operating_days = lambda: {0, 1, 2, 3, 4, 5}
    flask_app.get_confirmed_open_dates = lambda: []


print("test_forecast_guard.py")
print(f"  (current FEATURE_COLUMNS has {len(FEATURE_COLUMNS)} columns)")

client = flask_app.app.test_client()

# ---------------------------------------------------------------
# 1. A model trained on the OLD 11-feature set must be refused
# ---------------------------------------------------------------
old_columns = [
    "product_id", "dow", "month", "day", "is_weekend", "is_holiday",
    "is_payday", "lag_1", "lag_7", "rolling_7", "rolling_14",
]
model = DummyModel()
install_stubs({
    "product_categories": [1],
    "trained_product_ids": [1],
    "feature_columns": old_columns,
    "train_end_date": "2026-07-09",
}, model)

resp = client.post("/forecast", json={"horizon_days": 1}, headers=HEADERS)
check("an 11-feature model is refused with 409", resp.status_code == 409,
      f"got {resp.status_code}")
body = resp.get_json()
check("the refusal says 'retrain required'", "retrain required" in body.get("reason", ""),
      body.get("reason"))
check("the refusal reports BOTH column lists so the cause is obvious",
      body.get("model_feature_columns") == old_columns
      and body.get("current_feature_columns") == list(FEATURE_COLUMNS))
check("it never called predict() on the mismatched model",
      model.predict_calls == 0, f"predict called {model.predict_calls}x")

# ---------------------------------------------------------------
# 2. A LEGACY model with no metadata at all must be refused
# ---------------------------------------------------------------
model = DummyModel()
install_stubs(None, model)
resp = client.post("/forecast", json={"horizon_days": 1}, headers=HEADERS)
check("a model with no metadata sidecar is refused with 409", resp.status_code == 409,
      f"got {resp.status_code}")
check("the legacy refusal explains it predates the feature set",
      "no feature metadata" in (resp.get_json().get("reason") or ""),
      resp.get_json().get("reason"))
check("no predict() on a legacy model either", model.predict_calls == 0)

# ---------------------------------------------------------------
# 3. A matching model passes the guard
#    generate_forecast and the writers are stubbed too, so the route can
#    run to completion without a single Supabase call. Without that it
#    would try to reach the database and log a connection error, which
#    makes a passing test look broken to whoever runs it next.
# ---------------------------------------------------------------
model = DummyModel()
install_stubs({
    "product_categories": [1],
    "trained_product_ids": [1],
    "feature_columns": list(FEATURE_COLUMNS),
    "train_end_date": "2026-09-29",
}, model)
flask_app.generate_forecast = lambda *a, **k: [{
    "product_id": 1, "forecast_date": "2026-10-02",
    "predicted_quantity": 5.0, "model_version": "model_v20260101_000000",
    "rolling_7": 4.5,
}]
flask_app.write_forecast = lambda row: 1
flask_app.classify_forecast = lambda pid, qty: {
    "demand_tier": "Medium", "p40_threshold": 1, "p80_threshold": 9}
flask_app.write_classification = lambda pid, c: None
flask_app.estimate_cogs = lambda qty, pid, recipe: 0.0
flask_app.write_forecast_cogs = lambda fid, cogs: None
flask_app.estimate_ingredient_demand = lambda *a, **k: pd.DataFrame(
    columns=["ingredient_id", "ingredient_name", "unit", "required_qty",
             "current_stock", "stock_status"])
flask_app.get_latest_confirmed_open_date = lambda: "2026-09-29"
flask_app.write_forecast_run = lambda *a, **k: None

resp = client.post("/forecast", json={"horizon_days": 1}, headers=HEADERS)
check("a model with matching feature_columns is NOT rejected by the guard",
      resp.status_code != 409, f"got {resp.status_code}: {resp.get_json()}")
check("a matching model actually reaches prediction and succeeds",
      resp.status_code == 200, f"got {resp.status_code}: {resp.get_json()}")

# ---------------------------------------------------------------
# 4. Column ORDER matters, not just membership
#    Same 12 names, two swapped. XGBoost reads by position, so this is
#    just as wrong as a missing column — and far easier to miss.
# ---------------------------------------------------------------
reordered = list(FEATURE_COLUMNS)
reordered[1], reordered[2] = reordered[2], reordered[1]
model = DummyModel()
install_stubs({
    "product_categories": [1],
    "trained_product_ids": [1],
    "feature_columns": reordered,
    "train_end_date": "2026-09-29",
}, model)
resp = client.post("/forecast", json={"horizon_days": 1}, headers=HEADERS)
check("the same 12 columns in a DIFFERENT ORDER are still refused",
      resp.status_code == 409, f"got {resp.status_code}")
check("no predict() on a reordered model", model.predict_calls == 0)

# ---------------------------------------------------------------
# 5. The shared-secret header is still required
# ---------------------------------------------------------------
resp = client.post("/forecast", json={"horizon_days": 1})
check("a request with no shared secret is rejected", resp.status_code in (401, 403),
      f"got {resp.status_code}")

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All forecast-guard checks passed.")
