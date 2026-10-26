"""
Forecast report, model part (reports/forecast_inputs.py, Oct 26 2026).

The report claims "these are the inputs the model saw, and re-running the
saved model on them gives the stored forecast". That claim is only worth
something if the rebuild is identical to generate_forecast(). This test
runs the REAL generate_forecast() with a deterministic model, then rebuilds
the same window with the report and requires every day to match,
including the recursive days 2+.

Run:  cd ml-service && python tests/test_forecast_inputs.py
No Supabase, no network.
"""
import os
import sys
from datetime import date, timedelta

import pandas as pd

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for p in (ML_SERVICE_DIR, os.path.join(ML_SERVICE_DIR, "reports")):
    if p not in sys.path:
        sys.path.insert(0, p)

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoidGVzdCJ9.not-a-real-signature",
)

import services.forecast_service as fs  # noqa: E402
from services.business_logic import classify_demand  # noqa: E402
from forecast_inputs import reconstruct_product, percentile_thresholds  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


class MixModel:
    """Deterministic, uses several features, so a wrong rebuild shows."""

    def predict(self, X):
        r = X.iloc[0]
        return [0.5 * float(r["lag_1"]) + 0.3 * float(r["rolling_7"]) + 0.2 * float(r["rolling_14"])
                + float(r["dow"]) + 0.1 * float(r["days_since_last_open"])]


print("test_forecast_inputs.py")
MON_SAT = {0, 1, 2, 3, 4, 5}
START = date(2026, 9, 29)
open_days, d = [], date(2026, 6, 1)
while d <= date(2026, 9, 28):
    if d.weekday() in MON_SAT:
        open_days.append(d)
    d += timedelta(days=1)
sales_by_date = {x: float(10 + (i * 7) % 13) for i, x in enumerate(open_days) if i % 9 != 4}
sales_df = pd.DataFrame({"sale_date": pd.to_datetime(list(sales_by_date)), "quantity_sold": list(sales_by_date.values())})

real = fs.get_daily_sales
fs.get_daily_sales = lambda pid: sales_df.copy()
try:
    produced = fs.generate_forecast(5, MixModel(), "m", [5], horizon_days=6, operating_days=MON_SAT,
                                    open_dates=open_days, start_date=START)
finally:
    fs.get_daily_sales = real

stored = {date.fromisoformat(r["forecast_date"]): r["predicted_quantity"] for r in produced}
window = [START + timedelta(days=i) for i in range(6)]
rebuilt = reconstruct_product(5, window, sales_by_date, open_days, MON_SAT, stored, MixModel(), [5])

check("one row per window day", len(rebuilt) == 6, len(rebuilt))
check("Sunday is a closed row", rebuilt[-1]["closed"] and rebuilt[-1]["features"] is None)
check("every open day re-predicts to the stored forecast (incl. recursive days)",
      all(r["match"] for r in rebuilt if not r["closed"]), [(r["date"], r["stored"], r["recomputed"]) for r in rebuilt])
check("day 1 uses only real sales; day 2+ uses the model's own predictions",
      rebuilt[0]["uses_own_predictions"] is False and all(r["uses_own_predictions"] for r in rebuilt[1:5]))
check("day 1 lag_1 = the real Sep 28 sale (or 0 if none)",
      rebuilt[0]["features"]["lag_1"] == sales_by_date.get(date(2026, 9, 28), 0.0), rebuilt[0]["features"])
check("all 11 features are reported", len(rebuilt[0]["features"]) == 11, sorted(rebuilt[0]["features"]))

# A run that really started on a different day must NOT look reproduced.
wrong = dict(stored)
wrong[START] = float(wrong[START]) + 3
bad = reconstruct_product(5, window, sales_by_date, open_days, MON_SAT, wrong, MixModel(), [5])
check("a stored value the model did not produce is flagged", bad[0]["match"] is False)

# Inputs only (no model): still rebuilt, nothing claimed.
no_model = reconstruct_product(5, window, sales_by_date, open_days, MON_SAT, stored, None, None)
check("without the model, features are shown and match is not claimed",
      no_model[0]["features"] is not None and no_model[0]["match"] is None)

q = pd.Series([v for k, v in sales_by_date.items() if k < START])
t = percentile_thresholds(list(q))
c = classify_demand(12.0, q)
check("P40/P80 equal business_logic.classify_demand's", (t["p40"], t["p80"]) == (c["p40_threshold"], c["p80_threshold"]))

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All forecast-inputs checks passed.")
