"""
The report's "current vs previous model" section must not crash when the two
models share no products.

Why: on Oct 6 2026 the database had been reset and the history re-uploaded, so
every product got a new id. The previous model (ids 985..1227) and the current
one (ids 2..340) had nothing in common. Section 13c filtered the test rows to
the common products, got an empty set, and sklearn raised "Found array with 0
sample(s)". With no overlap there is nothing fair to score both models on, so
the section now says so and skips the comparison.

Run:  cd ml-service && python tests/test_report_no_common_products.py
No network: every database read the stage makes is replaced.
"""
import os
import sys

import numpy as np
import pandas as pd

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for path in (ML_SERVICE_DIR, os.path.join(ML_SERVICE_DIR, "reports")):
    if path not in sys.path:
        sys.path.insert(0, path)

import generate_training_report as report  # noqa: E402
from services.feature_engineering import FEATURE_COLUMNS  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}" + ("" if condition else f"  {detail}"))
    if not condition:
        _failures.append(label)


class FakeModel:
    def __init__(self, trained_ids):
        self.trained_product_ids = list(trained_ids)

    def predict(self, X):
        return np.ones(len(X))


def frame(product_ids, n=30):
    rng = np.random.default_rng(1)
    rows = []
    for pid in product_ids:
        for i in range(n):
            row = {c: float(rng.random()) for c in FEATURE_COLUMNS}
            row["product_id"] = pid
            row["sale_date"] = pd.Timestamp("2026-06-01") + pd.Timedelta(days=i)
            row["quantity_sold"] = float(rng.integers(0, 9))
            rows.append(row)
    return pd.DataFrame(rows)


def run_stage(current_ids, previous_ids):
    """Run the real stage with every outside read stubbed. Returns the HTML added."""
    report.get_forecast_runs_history = lambda *a, **k: pd.DataFrame()
    report.get_model_metrics_history = lambda *a, **k: pd.DataFrame()
    report.load_previous_model = lambda: (object(), "model_vPREV")
    report.load_saved_model = lambda version, model: (FakeModel(previous_ids), None)
    report._sections.clear()
    train_df, test_df = frame(current_ids), frame(current_ids, n=10)
    report.stage_production_reality_check(FakeModel(current_ids), "model_vCUR", train_df, test_df)
    return next(s["body"] for s in report._sections if s["id"] == "production_reality")


print("test_report_no_common_products.py")

# --- 1. The reported case: ids that do not overlap at all ---
try:
    html = run_stage(current_ids=[2, 3, 4], previous_ids=[985, 990, 992])
    check("no overlap: the stage finishes instead of raising", True)
    check("no overlap: the report says the models share no products", "no products in" in html and "common" in html)
    check("no overlap: both id ranges are shown so the cause is obvious", "985" in html and "992" in html)
    check("no overlap: no comparison table or 'worse model' warning is shown",
          "<table" not in html.split("<h3>c)")[1] and "may be worse" not in html)
except Exception as exc:  # noqa: BLE001
    check("no overlap: the stage finishes instead of raising", False, f"{type(exc).__name__}: {exc}")

# --- 2. Partial overlap still compares, on the common products only ---
try:
    html = run_stage(current_ids=[2, 3, 4], previous_ids=[3, 4, 985])
    part_c = html.split("<h3>c)")[1]
    check("partial overlap: a real comparison table is produced", "<table" in part_c)
    check("partial overlap: it does not claim there is no overlap", "no products in" not in part_c)
except Exception as exc:  # noqa: BLE001
    check("partial overlap: a real comparison table is produced", False, f"{type(exc).__name__}: {exc}")

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All no-common-products checks passed.")
