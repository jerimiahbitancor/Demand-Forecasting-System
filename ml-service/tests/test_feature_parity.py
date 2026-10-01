"""
Proves training and forecasting build identical features, and checks the
eligibility rule and the WMAPE maths.

THE POINT OF THE PARITY TEST: training/serving skew is the quiet killer
for a forecasting model. If training computes a feature one way and the
live forecast computes it slightly differently, the model tests well and
then produces bad numbers in production, with nothing in any log to say
why. Both sides now go through feature_engineering.build_feature_row(),
and this test asserts it — so if someone later "optimises" the training
path back into a separate vectorised implementation, this fails.

Run:  cd ml-service && python tests/test_feature_parity.py
No Supabase, no network.
"""
import os
import sys
from datetime import date, timedelta

import numpy as np
import pandas as pd

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault(
    "SUPABASE_SERVICE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoidGVzdCJ9.not-a-real-signature",
)

from config import MIN_TRAINING_OBSERVATIONS  # noqa: E402
from services.feature_engineering import (  # noqa: E402
    FEATURE_COLUMNS, build_feature_row, engineer_features,
)
from services.zero_fill import build_open_day_series, previous_open_date  # noqa: E402
from services.model_service import filter_training_eligible, wmape  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


# June 1 2026 is a Monday. Open Mon-Sat, Sunday closed — the current
# ChefDuo schedule, so the fixture has real weekly gaps in it.
START = date(2026, 6, 1)


def open_days(n_weeks):
    out = []
    for week in range(n_weeks):
        for offset in range(6):  # Mon..Sat, skip Sunday
            out.append(START + timedelta(days=week * 7 + offset))
    return out


print("test_feature_parity.py")

OPEN = open_days(8)  # 48 open days
# A dish that sells most days but not all, so zero-fill actually engages.
sales = {day: float((i * 7) % 13 + 1) for i, day in enumerate(OPEN) if i % 5 != 3}

# ---------------------------------------------------------------
# 1. PARITY: the training path vs the forecast path, row for row
# ---------------------------------------------------------------
sales_df = pd.DataFrame(
    [{"product_id": 42, "sale_date": pd.Timestamp(day), "quantity_sold": qty}
     for day, qty in sorted(sales.items())]
)
training_rows = engineer_features(sales_df, open_dates=OPEN)

# Rebuild the same rows the way forecast_service does: build the series,
# then call build_feature_row once per date with the history before it.
series = build_open_day_series(sales, OPEN)
forecast_rows = []
for index, entry in enumerate(series):
    forecast_rows.append(build_feature_row(
        product_id=42,
        target_date=entry["sale_date"],
        history=series[:index],
        prev_open_date=previous_open_date(entry["sale_date"], OPEN),
    ))

check("both paths produce the same number of rows",
      len(training_rows) == len(forecast_rows),
      f"training {len(training_rows)} vs forecast {len(forecast_rows)}")

mismatches = []
for i, fc_row in enumerate(forecast_rows):
    tr_row = training_rows.iloc[i]
    for col in FEATURE_COLUMNS:
        a, b = tr_row[col], fc_row[col]
        if col == "product_id":
            a, b = int(a), int(b)
            if a != b:
                mismatches.append((i, col, a, b))
            continue
        a, b = float(a), float(b)
        both_nan = np.isnan(a) and np.isnan(b)
        if not both_nan and not (abs(a - b) < 1e-9):
            mismatches.append((i, col, a, b))

check("every feature value matches between the two paths",
      not mismatches, f"{len(mismatches)} mismatch(es), first 5: {mismatches[:5]}")
check("the parity check actually exercised all 12 features",
      len(FEATURE_COLUMNS) == 12, f"got {len(FEATURE_COLUMNS)}")
check("zero-fill really engaged in the fixture (otherwise parity is trivial)",
      (~training_rows["is_real"]).sum() > 0,
      f"filled zeros: {(~training_rows['is_real']).sum()}")

# ---------------------------------------------------------------
# 2. Eligibility counts REAL observations only
# ---------------------------------------------------------------
usable = training_rows.dropna(subset=FEATURE_COLUMNS)
real_count = int(usable["is_real"].sum())
filled_count = int((~usable["is_real"]).sum())

# Product 42 has plenty of real rows -> should pass.
kept, excluded = filter_training_eligible(usable, MIN_TRAINING_OBSERVATIONS)
check("a product with enough REAL observations is kept",
      len(kept) > 0 and not excluded, f"excluded={excluded}")
check("the kept rows still INCLUDE the filled zeros (needed for training)",
      int((~kept["is_real"]).sum()) > 0, "filled zeros were dropped from training")

# Now force the opposite: almost all rows filled, only a handful real.
sparse = usable.copy()
sparse["is_real"] = False
sparse.iloc[:3, sparse.columns.get_loc("is_real")] = True
kept_sparse, excluded_sparse = filter_training_eligible(sparse, MIN_TRAINING_OBSERVATIONS)
check("a product carried only by filled zeros is EXCLUDED",
      len(kept_sparse) == 0 and len(excluded_sparse) == 1,
      f"kept={len(kept_sparse)} excluded={excluded_sparse}")
check("the exclusion report counts real observations, not all rows",
      excluded_sparse and excluded_sparse[0]["usable_observations"] == 3,
      f"got {excluded_sparse}")
check("eligibility bar is 28 post-warmup (= the owner's 42 real, minus 14 warm-up)",
      MIN_TRAINING_OBSERVATIONS == 28, f"got {MIN_TRAINING_OBSERVATIONS}")

# ---------------------------------------------------------------
# 3. WMAPE maths, hand-checked
# ---------------------------------------------------------------
# actual 10, 20, 30 (sum 60); predicted 12, 18, 33
# errors 2, 2, 3 -> sum 7 -> 7/60 = 11.666...%
got = wmape(np.array([10, 20, 30]), np.array([12, 18, 33]))
check("WMAPE = sum|error| / sum actual (7/60 = 11.67%)",
      abs(got - (7 / 60 * 100)) < 1e-9, f"got {got}")

# A perfect forecast is 0%.
check("a perfect forecast gives WMAPE 0",
      wmape(np.array([5, 5]), np.array([5, 5])) == 0.0)

# All-zero actuals -> no denominator -> None, NOT 0%.
check("all-zero actuals give None, not 0 (no denominator)",
      wmape(np.array([0, 0]), np.array([1, 2])) is None)

# A near-zero day cannot blow up WMAPE the way it does MAPE:
# actual 1 vs predicted 2 alongside actual 100 vs predicted 100.
# MAPE would average 100% and 0% -> 50%. WMAPE is 1/101 -> ~0.99%.
skewed = wmape(np.array([1, 100]), np.array([2, 100]))
check("one tiny-actual row cannot dominate WMAPE (~0.99%, not 50%)",
      abs(skewed - (1 / 101 * 100)) < 1e-9, f"got {skewed}")

# NaN rows are ignored rather than poisoning the total.
check("NaN rows are skipped",
      abs(wmape(np.array([10.0, np.nan]), np.array([12.0, 5.0])) - 20.0) < 1e-9,
      f"got {wmape(np.array([10.0, np.nan]), np.array([12.0, 5.0]))}")

# ---------------------------------------------------------------
# 4. lag_7 is really gone
# ---------------------------------------------------------------
check("lag_7 is no longer a feature", "lag_7" not in FEATURE_COLUMNS)
check("same_dow_last_open replaced it", "same_dow_last_open" in FEATURE_COLUMNS)
check("days_since_last_open was added", "days_since_last_open" in FEATURE_COLUMNS)
check("month and day were KEPT (owner declined removing them)",
      "month" in FEATURE_COLUMNS and "day" in FEATURE_COLUMNS)

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All parity, eligibility and WMAPE checks passed.")
