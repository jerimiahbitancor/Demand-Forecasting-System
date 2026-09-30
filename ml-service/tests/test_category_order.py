"""
Proves the product-order bug is real on the INSTALLED XGBoost.

The claim: XGBoost's native categorical support does not remember product
IDs. It remembers each category's POSITION in the list it was trained with.
So if /forecast rebuilds that list in a different order — which is what
happens when it is rebuilt from an unordered query instead of read from the
model's saved metadata — one product silently receives another product's
learned behaviour. No error, no warning, just wrong numbers.

This is why model_service saves `product_categories` and app.py's /forecast
reuses it verbatim. See model_storage.save_model_metadata().

Run:  cd ml-service && python tests/test_category_order.py
Needs xgboost and pandas (both in requirements.txt). No network, no storage.
"""
import os
import sys

import numpy as np
import pandas as pd
import xgboost as xgb

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

_failures = []


def check(label, condition, detail=""):
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        _failures.append(label)


print(f"test_category_order.py  (xgboost {xgb.__version__}, pandas {pd.__version__})")

# Three products with wildly different demand levels, so a mix-up is
# unmistakable rather than a rounding difference.
TRUE_LEVEL = {10: 2.0, 20: 50.0, 30: 100.0}
rng = np.random.default_rng(0)
n = 400
pids = rng.choice(list(TRUE_LEVEL), size=n)
y = np.array([TRUE_LEVEL[p] for p in pids]) + rng.normal(0, 0.5, n)
X = pd.DataFrame({"product_id": pids, "noise": rng.normal(0, 1, n)})
X["product_id"] = X["product_id"].astype("category")

train_categories = [int(c) for c in X["product_id"].cat.categories]

model = xgb.XGBRegressor(
    n_estimators=40, max_depth=3, tree_method="hist",
    enable_categorical=True, random_state=42,
)
model.fit(X, y)

probe = pd.DataFrame({"product_id": [10, 20, 30], "noise": [0.0, 0.0, 0.0]})


def predict_with(categories):
    df = probe.copy()
    df["product_id"] = pd.Categorical(df["product_id"], categories=categories)
    return model.predict(df)


# --- 1. Correct order: predictions land on the true levels ---
correct = predict_with(train_categories)
check("correct category order recovers each product's own level",
      all(abs(correct[i] - TRUE_LEVEL[p]) < 5 for i, p in enumerate([10, 20, 30])),
      f"got {np.round(correct, 2)}")

# --- 2. Reversed order: predictions get SWAPPED. This is the bug. ---
reversed_preds = predict_with(list(reversed(train_categories)))
check("reversed category order changes predictions (BUG IS REAL)",
      not np.allclose(correct, reversed_preds),
      "predictions identical — bug would not reproduce on this version")
check("reversed order gives product 10 product 30's forecast",
      abs(reversed_preds[0] - TRUE_LEVEL[30]) < 5,
      f"product 10 predicted {reversed_preds[0]:.2f}, product 30's level is {TRUE_LEVEL[30]}")

# --- 3. A product MISSING from the predict-time list becomes NaN (code -1)
# and still returns a number rather than raising. Another silent-wrong case
# the saved list prevents, since it can never lose a product.
short_list = [c for c in train_categories if c != 10]
df_short = probe.copy()
df_short["product_id"] = pd.Categorical(df_short["product_id"], categories=short_list)
check("a product dropped from the list encodes as -1 (NaN), not an error",
      df_short["product_id"].cat.codes.tolist()[0] == -1,
      f"codes {df_short['product_id'].cat.codes.tolist()}")

# --- 4. The pandas behaviour that makes the saved list necessary:
# row-filtering does NOT shrink the category list, so the list saved at
# training time can legitimately be wider than the trained products.
s = pd.Series([10, 10, 20, 99], dtype="category")
sliced = s.iloc[:3]
check("row filtering keeps removed products in cat.categories",
      list(sliced.cat.categories) == [10, 20, 99])
check("but .unique() on the slice reports only observed products",
      sorted(int(v) for v in sliced.dropna().unique()) == [10, 20])

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All category-order checks passed (the bug reproduces, and the fix is justified).")
