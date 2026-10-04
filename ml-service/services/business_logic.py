"""
Everything that turns a raw predicted quantity into something the
owner can act on. Deliberately separate from model_service.py and
forecast_service.py — these are business rules, not ML, and should be
changeable (a new threshold, a new buffer default) without touching
any model code.

Thresholds here are read from data/config wherever possible rather
than hardcoded, per the "business logic as configuration" principle
from the pipeline walkthrough.
"""
import numpy as np
import pandas as pd


def classify_demand(predicted_quantity: float, historical_quantities: pd.Series) -> dict:
    """
    Low/Medium/High classification using the 40th/80th percentile of
    THIS product's own historical quantity-sold distribution — never
    the store average. A low-volume product is judged against its own
    normal range, not against the bestseller.
    """
    p40 = float(np.percentile(historical_quantities, 40))
    p80 = float(np.percentile(historical_quantities, 80))

    if predicted_quantity > p80:
        tier = "High"
    elif predicted_quantity >= p40:
        tier = "Medium"
    else:
        tier = "Low"

    return {"demand_tier": tier, "p40_threshold": p40, "p80_threshold": p80}


def _normalize_keyword(keyword) -> str:
    return " ".join(str(keyword or "").split()).upper()


def compute_modifier_shares(sales, modifiers, rules, window_dates=None) -> pd.DataFrame:
    """
    Share of each product's plates that left out a given ingredient,
    because of a POS modifier ("NO EGG" -> Egg), over the window
    (data_loader.get_modifier_share_inputs: the store's last 28
    confirmed-open days).

        modifier_share(product, ingredient)
            = modifier plates mapped to that ingredient / all plates

    daily_sales.quantity_sold already includes the modifier plates, so
    "all plates" is the plain daily_sales total. Zero when the product had
    no plates in the window or no modifiers; capped at 1.

    Returns columns product_id, ingredient_id, modifier_share (one row per
    pair that has a share; pairs not listed mean 0).
    """
    columns = ["product_id", "ingredient_id", "modifier_share"]
    if not sales or not modifiers or not rules:
        return pd.DataFrame(columns=columns)

    window = {str(d) for d in window_dates} if window_dates else None

    def in_window(row):
        return window is None or str(row["sale_date"])[:10] in window

    ingredient_by_keyword = {
        _normalize_keyword(r["keyword"]): r["ingredient_id"] for r in rules
    }

    plates = {}
    for r in sales:
        if in_window(r):
            pid = int(r["product_id"])
            plates[pid] = plates.get(pid, 0) + max(0, float(r["quantity_sold"] or 0))

    without = {}
    for r in modifiers:
        if not in_window(r):
            continue
        ingredient_id = ingredient_by_keyword.get(_normalize_keyword(r["keyword"]))
        if ingredient_id is None:
            continue
        key = (int(r["product_id"]), int(ingredient_id))
        without[key] = without.get(key, 0) + max(0, float(r["quantity"] or 0))

    rows = []
    for (pid, ingredient_id), count in without.items():
        total = plates.get(pid, 0)
        if total <= 0 or count <= 0:
            continue
        rows.append({
            "product_id": pid,
            "ingredient_id": ingredient_id,
            "modifier_share": min(1.0, count / total),
        })
    return pd.DataFrame(rows, columns=columns)


def estimate_ingredient_demand(
    forecasts_by_product: dict,
    recipe_df: pd.DataFrame,
    safety_buffer_percentage: float,
    modifier_shares: pd.DataFrame = None,
) -> pd.DataFrame:
    """
    Ingredient demand, with POS modifiers:

        Need_i = sum over dishes of
                 forecasted_qty * recipe_qty * (1 - modifier_share)
                 * (1 + safety_buffer_%)

    modifier_share is the share of that dish's recent plates that left out
    ingredient i ("NO EGG"), from compute_modifier_shares(); 0 when there
    is none, which gives back the paper's original formula exactly.

    forecasts_by_product: {product_id: predicted_quantity}
    recipe_df: output of data_loader.get_recipe_and_stock()
    modifier_shares: output of compute_modifier_shares() (optional)

    Returns one row per ingredient with total forecasted need,
    current stock, and how much to buy. To Buy and stock status are
    unchanged.
    """
    recipe_df = recipe_df.copy()
    recipe_df["predicted_quantity"] = recipe_df["product_id"].map(forecasts_by_product).fillna(0)

    if modifier_shares is not None and not modifier_shares.empty and not recipe_df.empty:
        shares = modifier_shares[["product_id", "ingredient_id", "modifier_share"]].copy()
        shares["product_id"] = shares["product_id"].astype(int)
        shares["ingredient_id"] = shares["ingredient_id"].astype(int)
        recipe_df["product_id"] = recipe_df["product_id"].astype(int)
        recipe_df["ingredient_id"] = recipe_df["ingredient_id"].astype(int)
        recipe_df = recipe_df.merge(shares, on=["product_id", "ingredient_id"], how="left")
        recipe_df["modifier_share"] = recipe_df["modifier_share"].fillna(0).clip(0, 1)
    else:
        recipe_df["modifier_share"] = 0.0

    recipe_df["raw_need"] = (
        recipe_df["predicted_quantity"]
        * recipe_df["qty_per_serving"]
        * (1 - recipe_df["modifier_share"])
    )

    grouped = recipe_df.groupby(
        ["ingredient_id", "ingredient_name", "unit", "unit_cost", "current_stock"]
    )["raw_need"].sum().reset_index()

    buffer_multiplier = 1 + (safety_buffer_percentage / 100)
    grouped["forecasted_need"] = grouped["raw_need"] * buffer_multiplier
    grouped["to_buy"] = (grouped["forecasted_need"] - grouped["current_stock"]).clip(lower=0)
    grouped["est_cost"] = grouped["to_buy"] * grouped["unit_cost"]

    grouped["stock_status"] = grouped.apply(_stock_status_row, axis=1)

    return grouped.drop(columns=["raw_need"])


def _stock_status_row(row) -> str:
    """
    Critical <50%, Low <100%, Normal 100-200%, Excess >200% of
    tomorrow's forecasted demand — the thresholds from the finalized
    Inventory Management module.
    """
    if row["forecasted_need"] == 0:
        return "No Forecast"
    ratio = row["current_stock"] / row["forecasted_need"]
    if ratio < 0.5:
        return "Critical"
    elif ratio < 1.0:
        return "Low"
    elif ratio <= 2.0:
        return "Normal"
    else:
        return "Excess"


def estimate_cogs(predicted_quantity: float, product_id: int, recipe_df: pd.DataFrame) -> float:
    """
    COGS for one product's forecasted quantity = sum over its recipe
    ingredients of (recipe_qty_per_serving * unit_cost) * predicted_quantity.
    Uses current owner-entered unit prices, not historical purchase cost —
    matching the paper's documented COGS scope.
    """
    product_recipe = recipe_df[recipe_df["product_id"] == product_id]
    cost_per_serving = (product_recipe["qty_per_serving"] * product_recipe["unit_cost"]).sum()
    return float(cost_per_serving * predicted_quantity)
