"""
Ingredient demand with POS modifiers (business_logic.compute_modifier_shares
+ estimate_ingredient_demand).

    Need_i = sum forecast x recipe_qty x (1 - modifier_share) x (1 + buffer)

Worked example from the owner's spec: Marinated Porksilog forecast 20,
recipe 1 egg + 1 cup rice. Over the window 15 plates sold, 3 NO EGG (20%)
and 2 NO RICE (13.3%) -> egg 16, rice 17.33 cups before the buffer.

Run:  cd ml-service && python tests/test_modifier_demand.py
No network, no Supabase.
"""
import os
import sys

import pandas as pd

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

from services.business_logic import compute_modifier_shares, estimate_ingredient_demand  # noqa: E402

_failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}" + ("" if condition else f"  {detail}"))
    if not condition:
        _failures.append(label)


def close(a, b, tol=0.01):
    return a is not None and abs(float(a) - float(b)) <= tol


print("test_modifier_demand.py")

PORK, CHOP = 1040, 944
RICE, EGG = 92, 156
window = ["2026-09-26", "2026-09-28"]
sales = [
    {"product_id": PORK, "sale_date": "2026-09-26", "quantity_sold": 10},
    {"product_id": PORK, "sale_date": "2026-09-28", "quantity_sold": 5},
    {"product_id": CHOP, "sale_date": "2026-09-28", "quantity_sold": 8},
    {"product_id": PORK, "sale_date": "2026-09-01", "quantity_sold": 100},  # outside window
]
modifiers = [
    {"product_id": PORK, "sale_date": "2026-09-26", "keyword": "NO EGG", "quantity": 2},
    {"product_id": PORK, "sale_date": "2026-09-28", "keyword": "NO EGG", "quantity": 1},
    {"product_id": PORK, "sale_date": "2026-09-28", "keyword": "no rice", "quantity": 2},
    {"product_id": PORK, "sale_date": "2026-09-01", "keyword": "NO EGG", "quantity": 50},  # outside
    {"product_id": PORK, "sale_date": "2026-09-28", "keyword": "NO FRIES", "quantity": 4},  # no rule
]
rules = [{"keyword": "NO RICE", "ingredient_id": RICE}, {"keyword": "NO EGG", "ingredient_id": EGG}]

print("\n-- shares")
shares = compute_modifier_shares(sales, modifiers, rules, window)
lookup = {(r.product_id, r.ingredient_id): r.modifier_share for r in shares.itertuples()}
check("NO EGG share = 3/15 = 20%", close(lookup.get((PORK, EGG)), 0.20, 1e-9), str(lookup))
check("NO RICE share = 2/15 = 13.3% (keyword case ignored)", close(lookup.get((PORK, RICE)), 2 / 15, 1e-9), str(lookup))
check("rows outside the window are ignored", len(shares) == 2, str(shares))
check("a keyword with no rule adds no share", all(k[1] in (RICE, EGG) for k in lookup))
check("no modifiers -> no shares (full recipe)", compute_modifier_shares(sales, [], rules, window).empty)
check("no rules (migration not run) -> no shares", compute_modifier_shares(sales, modifiers, [], window).empty)
check("share capped at 1", compute_modifier_shares(
    [{"product_id": PORK, "sale_date": "2026-09-28", "quantity_sold": 2}],
    [{"product_id": PORK, "sale_date": "2026-09-28", "keyword": "NO EGG", "quantity": 9}],
    rules, window).modifier_share.iloc[0] == 1.0)

print("\n-- demand")
recipe = pd.DataFrame([
    {"product_id": PORK, "qty_per_serving": 1.0, "ingredient_id": EGG, "ingredient_name": "Egg",
     "unit": "pcs", "unit_cost": 8.0, "current_stock": 50.0},
    {"product_id": PORK, "qty_per_serving": 1.0, "ingredient_id": RICE, "ingredient_name": "Rice (cups)",
     "unit": "cup", "unit_cost": 10.0, "current_stock": 10.0},
    {"product_id": CHOP, "qty_per_serving": 1.0, "ingredient_id": RICE, "ingredient_name": "Rice (cups)",
     "unit": "cup", "unit_cost": 10.0, "current_stock": 10.0},
])


def need(df, ingredient_id):
    return float(df.loc[df.ingredient_id == ingredient_id, "forecasted_need"].iloc[0])


no_buffer = estimate_ingredient_demand({PORK: 20}, recipe, 0, modifier_shares=shares)
check("egg 16 before buffer (20 x 1 x 0.8)", close(need(no_buffer, EGG), 16), str(need(no_buffer, EGG)))
check("rice 17.33 cups before buffer (20 x 1 x 0.867)", close(need(no_buffer, RICE), 17.33), str(need(no_buffer, RICE)))

buffered = estimate_ingredient_demand({PORK: 20}, recipe, 15, modifier_shares=shares)
check("buffer applied after: egg 16 x 1.15 = 18.4", close(need(buffered, EGG), 18.4), str(need(buffered, EGG)))
check("buffer applied after: rice 17.33 x 1.15 = 19.93", close(need(buffered, RICE), 19.93), str(need(buffered, RICE)))
check("To Buy unchanged rule: max(0, need - stock) = 9.93 rice",
      close(float(buffered.loc[buffered.ingredient_id == RICE, "to_buy"].iloc[0]), 9.93))

other = estimate_ingredient_demand({PORK: 20, CHOP: 10}, recipe, 0, modifier_shares=shares)
check("another dish using rice keeps its full recipe (17.33 + 10)", close(need(other, RICE), 27.33), str(need(other, RICE)))

legacy = estimate_ingredient_demand({PORK: 20}, recipe, 15)
check("no shares passed -> original formula (egg 23)", close(need(legacy, EGG), 23), str(need(legacy, EGG)))

print()
if _failures:
    print(f"FAILED: {len(_failures)} check(s): {_failures}")
    sys.exit(1)
print("All modifier demand checks passed.")
