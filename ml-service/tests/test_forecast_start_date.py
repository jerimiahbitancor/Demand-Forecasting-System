"""
Forecast with a chosen start date (Oct 26 2026).

WHY: the forecast always started TODAY. With sales uploaded only up to
Sep 28 and today Oct 26, the model read Sep 28 as "yesterday" and produced
Oct 26 - Nov 1 forecasts nobody could check. For an accuracy test the
owner now starts the forecast right after the latest uploaded sales,
uploads the real sales later, and compares.

What must hold, and is checked here:
  1. No start date -> exactly the old behaviour (today; the 9:00 AM jobs).
  2. "after_latest_sales" -> the first open day after the latest sales,
     skipping non-operating weekdays and days marked closed.
  3. Weekly -> from the start through that week's Sunday.
  4. No leakage: a start on or before the model's train_end_date is
     refused, and the forecast reads only sales BEFORE the start, even when
     the real sales of the forecast days are already uploaded.
  5. No gap: a start later than the first open day after the latest sales
     is refused with a plain message.

Run:  cd ml-service && python tests/test_forecast_start_date.py
No Supabase, no network: every data call is stubbed.
"""
import os
import sys
from datetime import date, timedelta

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
import services.forecast_service as fs  # noqa: E402
from services.feature_engineering import FEATURE_COLUMNS  # noqa: E402
from services.forecast_service import (  # noqa: E402
    resolve_forecast_window, next_forecastable_date, ForecastWindowError, AFTER_LATEST_SALES,
)

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


def refused(fn):
    try:
        fn()
    except ForecastWindowError as e:
        return str(e)
    return None


print("test_forecast_start_date.py")

MON_SAT = {0, 1, 2, 3, 4, 5}
SEP28 = date(2026, 9, 28)   # Monday, the last uploaded sales day
SEP29 = date(2026, 9, 29)   # Tuesday
TRAIN_END = date(2026, 6, 16)

# ---------------------------------------------------------------
# 1. The pure rule
# ---------------------------------------------------------------
start, horizon = resolve_forecast_window(
    AFTER_LATEST_SALES, 7, operating_days=MON_SAT, latest_open_date=SEP28, train_end_date=TRAIN_END)
check("after_latest_sales starts the day after the latest sales", start == SEP29, start)
check("weekly from a Tuesday runs through Sunday (6 days: Sep 29 - Oct 4)", horizon == 6, horizon)

start, horizon = resolve_forecast_window(
    "2026-09-29", 1, operating_days=MON_SAT, latest_open_date=SEP28, train_end_date=TRAIN_END)
check("daily = one day", (start, horizon) == (SEP29, 1), (start, horizon))

start, horizon = resolve_forecast_window(
    "2026-10-05", 7, operating_days=MON_SAT, latest_open_date=date(2026, 10, 3), train_end_date=TRAIN_END)
check("Saturday sales + closed Sunday -> Monday start is allowed, full Mon-Sun week",
      (start, horizon) == (date(2026, 10, 5), 7), (start, horizon))

check("a confirmed-closed day after the latest sales is skipped, not a gap",
      next_forecastable_date(SEP28, MON_SAT, [SEP29]) == date(2026, 9, 30))

start, _ = resolve_forecast_window(
    "2026-09-29", 7, operating_days=MON_SAT, latest_open_date=date(2026, 10, 25), train_end_date=TRAIN_END)
check("a start BEFORE the latest sales is allowed (re-test after uploading actuals)", start == SEP29)

msg = refused(lambda: resolve_forecast_window(
    "2026-10-26", 7, operating_days=MON_SAT, latest_open_date=SEP28, train_end_date=TRAIN_END))
check("a start that skips unuploaded days is refused", msg is not None)
check("the gap message names the latest sales day and the allowed start",
      bool(msg) and "Sep 28, 2026" in msg and "Sep 29, 2026" in msg, msg)

msg = refused(lambda: resolve_forecast_window(
    "2026-06-10", 7, operating_days=MON_SAT, latest_open_date=SEP28, train_end_date=TRAIN_END))
check("a start on/before the model's training end date is refused (leakage)",
      bool(msg) and "Jun 16, 2026" in msg, msg)
check("the training end date itself is refused", refused(lambda: resolve_forecast_window(
    "2026-06-16", 1, operating_days=MON_SAT, latest_open_date=SEP28, train_end_date=TRAIN_END)) is not None)

check("a malformed date is refused", refused(lambda: resolve_forecast_window(
    "29/09/2026", 1, operating_days=MON_SAT, latest_open_date=SEP28)) is not None)
check("no confirmed sales at all is refused", refused(lambda: resolve_forecast_window(
    AFTER_LATEST_SALES, 1, operating_days=MON_SAT, latest_open_date=None)) is not None)

# ---------------------------------------------------------------
# 2. generate_forecast with a start date reads only earlier sales
# ---------------------------------------------------------------
class LagEchoModel:
    """Predicts lag_1, so the output shows which 'yesterday' it was fed."""

    def predict(self, X):
        return [float(X["lag_1"].iloc[0])]


open_days = []
d = date(2026, 7, 1)
while d <= date(2026, 10, 3):
    if d.weekday() in MON_SAT:
        open_days.append(d)
    d += timedelta(days=1)
# 10 a day up to Sep 28; the "real" Sep 29 - Oct 3 sales (99) are already uploaded.
sales = pd.DataFrame({
    "sale_date": pd.to_datetime(open_days),
    "quantity_sold": [10.0 if x <= SEP28 else 99.0 for x in open_days],
})
real_get_daily_sales = fs.get_daily_sales
fs.get_daily_sales = lambda pid: sales.copy()
try:
    rows = fs.generate_forecast(
        1, LagEchoModel(), "model_test", [1], horizon_days=6,
        operating_days=MON_SAT, open_dates=open_days, start_date=SEP29,
    )
    check("rows start on the chosen date", rows[0]["forecast_date"] == "2026-09-29", rows[0])
    check("rows end on Sunday Oct 4", rows[-1]["forecast_date"] == "2026-10-04", rows[-1])
    check("Sunday is a business-rule 0", rows[-1]["predicted_quantity"] == 0.0)
    check("day 1 uses Sep 28 as 'yesterday', never the uploaded Sep 29 actual (no leakage)",
          rows[0]["predicted_quantity"] == 10.0, rows[0])
    check("no forecast day ever sees the uploaded 99s",
          all(r["predicted_quantity"] != 99.0 for r in rows), [r["predicted_quantity"] for r in rows])
    check("the classification thresholds ignore sales on/after the start",
          fs.classify_forecast(1, 10.0, before_date=SEP29)["p80_threshold"] == 10.0)
finally:
    fs.get_daily_sales = real_get_daily_sales

# ---------------------------------------------------------------
# 3. The real /forecast route
# ---------------------------------------------------------------
HEADERS = {"X-ML-Service-Secret": os.environ["ML_SERVICE_SHARED_SECRET"]}
calls = {"generate": [], "classify": []}


def fake_generate(*a, **k):
    calls["generate"].append({**k, "_horizon": a[4] if len(a) > 4 else k.get("horizon_days")})
    start = k.get("start_date") or date(2026, 10, 26)
    return [{"product_id": 1, "forecast_date": start.isoformat(), "predicted_quantity": 5.0,
             "model_version": "model_v20260101_000000", "rolling_7": 4.5}]


def fake_classify(pid, qty, **k):
    calls["classify"].append(k)
    return {"demand_tier": "Medium", "p40_threshold": 1, "p80_threshold": 9}


def install(train_end="2026-06-16", latest="2026-09-28", closed=()):
    flask_app.load_latest_model = lambda: (object(), "model_v20260101_000000")
    flask_app.load_model_metadata = lambda v: {
        "product_categories": [1], "trained_product_ids": [1],
        "feature_columns": list(FEATURE_COLUMNS),
        **({"train_end_date": train_end} if train_end else {}),
    }
    flask_app.get_active_products = lambda: pd.DataFrame([{"id": 1, "name": "Dish"}])
    flask_app.get_recipe_and_stock = lambda: pd.DataFrame(
        columns=["product_id", "qty_per_serving", "ingredient_id",
                 "ingredient_name", "unit", "unit_cost", "current_stock"])
    flask_app.get_safety_buffer_percentage = lambda: 15.0
    flask_app.get_operating_days = lambda: set(MON_SAT)
    flask_app.get_confirmed_open_dates = lambda: []
    flask_app.get_latest_confirmed_open_date = lambda: latest
    flask_app.get_confirmed_closed_dates_after = lambda after: list(closed)
    flask_app.generate_forecast = fake_generate
    flask_app.classify_forecast = fake_classify
    flask_app.write_forecast = lambda row: 1
    flask_app.write_classification = lambda pid, c: None
    flask_app.estimate_cogs = lambda qty, pid, recipe: 0.0
    flask_app.write_forecast_cogs = lambda fid, cogs: None
    flask_app.get_modifier_share_inputs = lambda **k: (_ for _ in ()).throw(RuntimeError("n/a"))
    flask_app.estimate_ingredient_demand = lambda *a, **k: pd.DataFrame(columns=["ingredient_id"])
    flask_app.write_forecast_run = lambda *a, **k: None


client = flask_app.app.test_client()

install()
calls["generate"].clear()
resp = client.post("/forecast", json={"horizon_days": 7}, headers=HEADERS)
body = resp.get_json()
check("no start_date -> 200 as before", resp.status_code == 200, body)
check("no start_date -> generate_forecast gets NO start_date (today, unchanged)",
      calls["generate"] and "start_date" not in calls["generate"][0] and calls["generate"][0]["_horizon"] == 7,
      calls["generate"])
check("no start_date -> classify called the old way", calls["classify"][-1] == {})
check("no start_date -> no forecast_start in the reply", "forecast_start" not in body)

calls["generate"].clear()
resp = client.post("/forecast", json={"horizon_days": 7, "start_date": "after_latest_sales"}, headers=HEADERS)
body = resp.get_json()
check("after_latest_sales -> 200", resp.status_code == 200, body)
check("after_latest_sales -> starts Sep 29", calls["generate"][0].get("start_date") == SEP29, calls["generate"])
check("weekly from Sep 29 -> 6 days asked of the model", calls["generate"][0]["_horizon"] == 6, calls["generate"])
check("reply says Sep 29 - Oct 4", (body.get("forecast_start"), body.get("forecast_end")) == ("2026-09-29", "2026-10-04"), body)
check("classification uses only sales before the start", calls["classify"][-1] == {"before_date": SEP29})

resp = client.post("/forecast", json={"horizon_days": 7, "start_date": "2026-10-26"}, headers=HEADERS)
body = resp.get_json()
check("a start that leaves a gap -> 422", resp.status_code == 422, body)
check("the 422 reason is plain language", "Sales data ends on Sep 28, 2026" in (body or {}).get("reason", ""), body)

resp = client.post("/forecast", json={"horizon_days": 1, "start_date": "2026-06-01"}, headers=HEADERS)
check("a start inside the model's training data -> 422", resp.status_code == 422, resp.get_json())

install(closed=[SEP29])
resp = client.post("/forecast", json={"horizon_days": 1, "start_date": "after_latest_sales"}, headers=HEADERS)
check("closed Sep 29 -> after_latest_sales starts Sep 30",
      resp.status_code == 200 and resp.get_json().get("forecast_start") == "2026-09-30", resp.get_json())

install(train_end=None)
resp = client.post("/forecast", json={"horizon_days": 1, "start_date": "2026-09-29"}, headers=HEADERS)
body = resp.get_json()
check("a model without train_end_date still runs, with a warning",
      resp.status_code == 200 and len(body.get("warnings") or []) == 1, body)

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All forecast start-date checks passed.")
