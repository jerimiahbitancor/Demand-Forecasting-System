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


def estimate_ingredient_demand(
    forecasts_by_product: dict,
    recipe_df: pd.DataFrame,
    safety_buffer_percentage: float,
) -> pd.DataFrame:
    """
    Implements the paper's ingredient demand formula:
        Ingredient Needed = (sum over dishes of forecasted_qty * recipe_qty)
                             * (1 + safety_buffer_%)

    forecasts_by_product: {product_id: predicted_quantity}
    recipe_df: output of data_loader.get_recipe_and_stock()

    Returns one row per ingredient with total forecasted need,
    current stock, and how much to buy.
    """
    recipe_df = recipe_df.copy()
    recipe_df["predicted_quantity"] = recipe_df["product_id"].map(forecasts_by_product).fillna(0)
    recipe_df["raw_need"] = recipe_df["predicted_quantity"] * recipe_df["qty_per_serving"]

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
