"""
test_training_split.py — the Oct 17 2026 training changes in services/model_service.py.

    1. The split is by DATE: no date appears in two parts (fit / validation / test).
    2. The parts are in time order: fit < validation < test.
    3. Early stopping picks the tree count on the validation period, and the
       final model has exactly that many trees.
    4. The tuned settings are the ones actually used.
    5. The metadata records the split and the settings (the report reads it).

Uses a small synthetic dataset and persist=False, so nothing is uploaded.
Run from ml-service/:  python tests/test_training_split.py
"""
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl")

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from services.feature_engineering import engineer_features, FEATURE_COLUMNS  # noqa: E402
from services.model_service import (  # noqa: E402
    three_way_split, chronological_split, train_global_model, TUNED_PARAMS, MAX_TREES,
)

failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}" + (f"  {detail}" if detail and not condition else ""))
    if not condition:
        failures.append(label)


print("test_training_split.py")

# 6 products, Mon-Sat open, 300 days, a weekday pattern + noise.
rng = np.random.default_rng(1)
start = date(2025, 7, 10)
open_dates = [start + timedelta(days=i) for i in range(300) if (start + timedelta(days=i)).weekday() != 6]
rows = []
for pid, base in zip(range(1, 7), [40, 20, 10, 6, 3, 2]):
    for d in open_dates:
        q = rng.poisson(base * (1.3 if d.weekday() == 4 else 1.0))
        if q > 0:
            rows.append({"product_id": pid, "sale_date": pd.Timestamp(d), "quantity_sold": float(q)})
features = engineer_features(pd.DataFrame(rows), open_dates=open_dates).dropna(subset=FEATURE_COLUMNS)

fit_df, val_df, test_df, train_df = three_way_split(features)
fit_dates, val_dates, test_dates = (set(df["sale_date"]) for df in (fit_df, val_df, test_df))
check("no date is in both fit and validation", not (fit_dates & val_dates))
check("no date is in both validation and test", not (val_dates & test_dates))
check("no date is in both fit and test", not (fit_dates & test_dates))
check("fit ends before validation starts", fit_df["sale_date"].max() < val_df["sale_date"].min())
check("validation ends before test starts", val_df["sale_date"].max() < test_df["sale_date"].min())
check("every row is in exactly one part", len(fit_df) + len(val_df) + len(test_df) == len(features))
check("train = fit + validation", len(train_df) == len(fit_df) + len(val_df))
n_dates = features["sale_date"].nunique()
check("test is about the last 20% of dates", abs(len(test_dates) / n_dates - 0.2) < 0.02,
      f"got {len(test_dates) / n_dates:.3f}")

# The old row-index split could put one date on both sides; the date split cannot.
tr, te = chronological_split(features)
check("chronological_split never shares a date", not (set(tr["sale_date"]) & set(te["sale_date"])))

model, metrics, version = train_global_model(features, persist=False)
training = metrics["metadata"]["training"]
n_trees = training["n_estimators"]
check("early stopping chose fewer trees than the maximum", 1 <= n_trees < MAX_TREES, f"got {n_trees}")
check("the final model has exactly that many trees", model.get_booster().num_boosted_rounds() == n_trees,
      f"got {model.get_booster().num_boosted_rounds()} vs {n_trees}")
params = model.get_params()
check("tuned settings are used", all(params[k] == v for k, v in TUNED_PARAMS.items()),
      str({k: params[k] for k in TUNED_PARAMS}))
check("metadata records the three periods",
      all(training[k] for k in ("fit_period", "validation_period", "test_period")))
check("metadata periods are in time order",
      training["fit_period"][1] < training["validation_period"][0] <= training["validation_period"][1] < training["test_period"][0])
check("both naive benchmarks are scored",
      metrics["aggregate"].get("baseline_wmape") is not None and metrics["aggregate"].get("baseline_same_dow_wmape") is not None)
check("is_holiday is not a feature any more", "is_holiday" not in metrics["feature_importance"])

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {failures}")
    sys.exit(1)
print("All training-split checks passed.")
