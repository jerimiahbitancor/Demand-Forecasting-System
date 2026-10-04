"""
The training report must score a saved model with the product order saved
in its _meta.json, never with today's product list.

Why: XGBoost remembers each product by its POSITION in the category list.
On Oct 2 2026 the report rebuilt the list from today's 97 active products
while model_v20261001_114629 was trained on 99 (923 and 947 archived since),
so every product was scored as a neighbour and the report's per-product
errors were wrong. reports/generate_training_report.py now wraps every
saved model in SavedModel, which re-encodes product_id against the saved
list, and refuses a model with no metadata or a different feature list.

Run:  cd ml-service && python tests/test_report_saved_categories.py
Needs xgboost and pandas. No network: load_model_metadata is replaced.
"""
import os
import sys

import numpy as np
import pandas as pd
import xgboost as xgb

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


print("test_report_saved_categories.py")

rng = np.random.default_rng(0)
ids = [10, 20, 30]
level = {10: 2.0, 20: 20.0, 30: 60.0}
rows, y = [], []
for pid in ids:
    for _ in range(200):
        row = {c: 0.0 for c in FEATURE_COLUMNS}
        row["product_id"] = pid
        row["dow"] = float(rng.integers(0, 6))
        rows.append(row)
        y.append(level[pid])
X = pd.DataFrame(rows)
X["product_id"] = pd.Categorical(X["product_id"], categories=ids)
model = xgb.XGBRegressor(enable_categorical=True, tree_method="hist", n_estimators=50, max_depth=3)
model.fit(X[FEATURE_COLUMNS], np.array(y))

meta = {"product_categories": ids, "trained_product_ids": ids, "feature_columns": list(FEATURE_COLUMNS)}
report.load_model_metadata = lambda version: meta
saved, reason = report.load_saved_model("model_vTEST", model)
check("a model with matching metadata loads", saved is not None and reason is None, str(reason))

# Today's data arrives with a SHUFFLED category list (plus a product the
# model never saw) — the situation that broke the Oct 2 report.
shuffled = X[FEATURE_COLUMNS].copy()
shuffled["product_id"] = pd.Categorical(shuffled["product_id"].astype(int), categories=[30, 20, 10, 99])
raw = model.predict(shuffled)
wrapped = saved.predict(shuffled)
for pid in ids:
    mask = (shuffled["product_id"].astype(int) == pid).values
    print(f"     product {pid}: raw {raw[mask].mean():.1f}  report {wrapped[mask].mean():.1f}  true {level[pid]}")
check("WITHOUT the fix the shuffle really swaps products (10 gets ~60)", abs(raw[(shuffled['product_id'].astype(int) == 10).values].mean() - 60) < 1)
check("WITH the fix every product gets its own level", all(
    abs(wrapped[(shuffled["product_id"].astype(int) == pid).values].mean() - level[pid]) < 1 for pid in ids))

unknown = shuffled.copy()
unknown["product_id"] = 99
try:
    saved.predict(unknown)
    check("a product not in the saved list is refused", False)
except ValueError:
    check("a product not in the saved list is refused", True)

report.load_model_metadata = lambda version: None
check("no _meta.json -> refused", report.load_saved_model("model_vOLD", model)[0] is None)

report.load_model_metadata = lambda version: {**meta, "feature_columns": list(reversed(FEATURE_COLUMNS))}
refused, why = report.load_saved_model("model_vORDER", model)
check("same features in a different ORDER -> refused", refused is None and "trained on features" in why, str(why))

report.load_model_metadata = lambda version: {**meta, "feature_columns": [c for c in FEATURE_COLUMNS if c != "lag_1"]}
check("fewer features -> refused", report.load_saved_model("model_vFEW", model)[0] is None)

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All report saved-category checks passed.")
