"""
All reads from Supabase live here, and only here.

Keeping every SELECT in one module means: if a table or column name
changes, you fix it in exactly one place. It also enforces the
separation we agreed on — this service only ever reads products,
daily_sales, product_ingredients/ingredients, and forecast_config.
It never writes to any of them (see supabase_writer.py for the tables
this service IS allowed to write to).
"""
import pandas as pd
from config import supabase


def get_active_products():
    """
    Products eligible for forecasting: active, not archived.
    Returns a DataFrame with id, name, price.
    """
    response = (
        supabase.table("products")
        .select("id, name, price, is_active, first_sold_date")
        .eq("is_active", True)
        .execute()
    )
    return pd.DataFrame(response.data)


def get_daily_sales(product_id: int = None) -> pd.DataFrame:
    """
    Raw sales history. If product_id is given, filter to that product;
    otherwise return all products' history (used for bulk training runs).

    NOTE: this returns ONLY rows that exist in daily_sales — days the
    store was closed will simply be absent, not present with a 0.
    That absence is exactly what preprocessing.py expects and relies on.
    """
    query = supabase.table("daily_sales").select(
        "product_id, sale_date, quantity_sold"
    )
    if product_id is not None:
        query = query.eq("product_id", product_id)

    response = query.order("sale_date").execute()
    df = pd.DataFrame(response.data)
    if not df.empty:
        df["sale_date"] = pd.to_datetime(df["sale_date"])
    return df


def get_recipe_and_stock() -> pd.DataFrame:
    """
    Recipe mapping joined to current inventory, for ingredient demand
    and COGS calculations.

    UPDATED: the schema was consolidated — inventory_items was merged
    into ingredients (quantity, category, min_stock, is_archived and
    the audit columns all moved there), and product_ingredients.
    ingredient_id / inventory_transactions.ingredient_id now both FK
    to ingredients directly. There is no separate inventory_items
    table anymore. This query was updated to match; if you see a
    "relation does not exist" error mentioning inventory_items
    anywhere else in this service, it's this same stale reference.
    """
    response = (
        supabase.table("product_ingredients")
        .select(
            "product_id, quantity_per_serving, "
            "ingredients!inner(id, name, unit, price, quantity)"
        )
        .execute()
    )
    rows = []
    for r in response.data:
        item = r["ingredients"]
        rows.append({
            "product_id": r["product_id"],
            "qty_per_serving": r["quantity_per_serving"],
            "ingredient_id": item["id"],
            "ingredient_name": item["name"],
            "unit": item["unit"],
            "unit_cost": item["price"],
            "current_stock": item["quantity"],
        })
    return pd.DataFrame(rows)


def get_safety_buffer_percentage() -> float:
    """
    Single configurable safety buffer (default 15%), owner-set in
    Settings. Falls back to 15.0 if the config row is somehow missing,
    rather than crashing the whole forecast run over a config lookup.
    """
    response = supabase.table("forecast_config").select(
        "safety_buffer_percentage"
    ).limit(1).execute()
    if response.data:
        return float(response.data[0]["safety_buffer_percentage"])
    return 15.0
