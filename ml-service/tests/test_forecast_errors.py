"""
Tests how /forecast reports errors, against the REAL Flask route.

WHY: an exception nobody caught used to reach Flask's default handler,
which answers with a generic HTML "500 Internal Server Error" page. Express
could only say "ml-service returned HTTP 500" and the owner had no idea
why; the real cause existed only in the Render log (Oct 24 2026).

Now:
  1. any uncaught exception -> JSON 500 with the exception type and message
     in `reason` (Express already shows `reason`), traceback still logged;
  2. one product that throws is reported as "failed" and the others are
     still forecast;
  3. if EVERY attempted product fails, the run is a JSON 500 with the first
     reason (not a "successful" run that wrote nothing).

Run:  cd ml-service && python tests/test_forecast_errors.py
Nothing here reaches Supabase: every data_loader / writer call the route
makes is replaced with a stub first.
"""
import logging
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

# The route logs tracebacks on purpose; keep the test output readable.
logging.getLogger("ml-service").setLevel(logging.CRITICAL)

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


HEADERS = {"X-ML-Service-Secret": os.environ["ML_SERVICE_SHARED_SECRET"]}
METADATA = {
    "product_categories": [1, 2],
    "trained_product_ids": [1, 2],
    "feature_columns": list(FEATURE_COLUMNS),
    "train_end_date": "2026-10-01",
}
written = {"forecasts": [], "runs": []}


def install_stubs(generate):
    flask_app.load_latest_model = lambda: (object(), "model_v20261017_073006")
    flask_app.load_model_metadata = lambda version: METADATA
    flask_app.get_active_products = lambda: pd.DataFrame(
        [{"id": 1, "name": "Adobo", "price": 100.0}, {"id": 2, "name": "Tapsilog", "price": 120.0}]
    )
    flask_app.get_recipe_and_stock = lambda: pd.DataFrame(
        columns=["product_id", "qty_per_serving", "ingredient_id",
                 "ingredient_name", "unit", "unit_cost", "current_stock"]
    )
    flask_app.get_safety_buffer_percentage = lambda: 15.0
    flask_app.get_operating_days = lambda: {0, 1, 2, 3, 4, 5}
    flask_app.get_confirmed_open_dates = lambda: []
    flask_app.get_modifier_share_inputs = lambda open_dates=None: (_ for _ in ()).throw(RuntimeError("n/a"))
    flask_app.get_latest_confirmed_open_date = lambda: None
    flask_app.generate_forecast = generate
    flask_app.classify_forecast = lambda pid, qty: {"demand_tier": "Medium"}
    flask_app.write_classification = lambda pid, c: None
    flask_app.write_forecast_cogs = lambda fid, cogs: None
    flask_app.estimate_cogs = lambda qty, pid, df: 0.0

    def write_forecast(row):
        written["forecasts"].append(row)
        return len(written["forecasts"])
    flask_app.write_forecast = write_forecast
    flask_app.write_forecast_run = lambda *a: written["runs"].append(a)


def ok_row(pid):
    return [{"product_id": pid, "forecast_date": "2026-10-24", "predicted_quantity": 5.0,
             "model_version": "m", "rolling_7": 4.0}]


print("test_forecast_errors.py")
client = flask_app.app.test_client()

# ---------------------------------------------------------------
# 1. An uncaught exception outside the product loop -> JSON, not HTML
# ---------------------------------------------------------------
install_stubs(lambda pid, *a, **k: ok_row(pid))
flask_app.get_recipe_and_stock = lambda: (_ for _ in ()).throw(KeyError("price"))
resp = client.post("/forecast", json={"horizon_days": 1}, headers=HEADERS)
body = resp.get_json(silent=True)
check("uncaught error -> HTTP 500", resp.status_code == 500, f"got {resp.status_code}")
check("the body is JSON, not Flask's HTML page", isinstance(body, dict), resp.data[:80])
check("reason names the exception type and message",
      body and body.get("reason") == "KeyError: 'price'", body)
check("status is 'failed' and the path is reported",
      body and body.get("status") == "failed" and body.get("path") == "/forecast", body)

# A deliberate HTTP error is untouched (e.g. wrong method -> 405).
resp = client.get("/forecast", headers=HEADERS)
check("Flask's own HTTP errors pass through (405)", resp.status_code == 405, resp.status_code)

# ---------------------------------------------------------------
# 2. One product throws -> it is "failed", the other is forecast
# ---------------------------------------------------------------
written["forecasts"].clear()
written["runs"].clear()


def one_bad(pid, *a, **k):
    if pid == 2:
        raise ValueError("cannot convert NaN to integer")
    return ok_row(pid)


install_stubs(one_bad)
resp = client.post("/forecast", json={"horizon_days": 1}, headers=HEADERS)
body = resp.get_json()
statuses = {r["product_id"]: r["status"] for r in body.get("results", [])}
check("run still succeeds (200)", resp.status_code == 200, resp.status_code)
check("product 1 forecasted, product 2 failed", statuses == {1: "forecasted", 2: "failed"}, statuses)
check("the failed product carries its reason",
      any(r.get("reason") == "ValueError: cannot convert NaN to integer" for r in body["results"]), body["results"])
check("failed_count is reported", body.get("failed_count") == 1, body.get("failed_count"))
check("the good product's forecast was written", len(written["forecasts"]) == 1)
check("the run itself was recorded", len(written["runs"]) == 1)

# ---------------------------------------------------------------
# 3. Every attempted product fails -> a failed run, nothing recorded
# ---------------------------------------------------------------
written["forecasts"].clear()
written["runs"].clear()
install_stubs(lambda pid, *a, **k: (_ for _ in ()).throw(TypeError("unsupported operand")))
resp = client.post("/forecast", json={"horizon_days": 1}, headers=HEADERS)
body = resp.get_json()
check("all products failed -> HTTP 500", resp.status_code == 500, resp.status_code)
check("reason gives the first error",
      body.get("reason") == "every product failed to forecast; first error: TypeError: unsupported operand",
      body.get("reason"))
check("no forecast_runs row for a run that produced nothing", written["runs"] == [])

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All forecast error checks passed.")
