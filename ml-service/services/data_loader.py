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
    Products whose STATUS is active — a pure activity/lifecycle check,
    with no data-sufficiency logic mixed in. Deliberately separate from
    get_training_eligible_products() below: "is this product active"
    and "does this product have enough observations to train on" are
    two different questions per the eligibility clarification, and
    conflating them was the bug in the previous version of this file.

    Reads the generated `is_active` column (kept for compatibility with
    the rest of the codebase), which is always in sync with the new
    `status` enum — see migrations/001_add_product_status.sql.
    """
    response = (
        supabase.table("products")
        .select("id, name, price, is_active, status, first_sold_date")
        .eq("is_active", True)
        .execute()
    )
    # Explicit columns so an empty result (zero active products) still
    # yields a DataFrame with an "id" column instead of one with no
    # columns at all — callers doing get_active_products()["id"] would
    # otherwise crash with an unhandled KeyError instead of just getting
    # an empty list of ids.
    columns = ["id", "name", "price", "is_active", "status", "first_sold_date"]
    return pd.DataFrame(response.data, columns=columns)


def get_training_eligible_products(min_observations: int) -> list:
    """
    Returns the list of product_ids with at least `min_observations`
    valid daily sales observations — per the corrected eligibility
    rule: this counts ACTUAL ROWS in daily_sales (each row already
    represents one aggregated, valid daily observation — see
    get_daily_sales' docstring on why closed/missing days never
    produce a row at all), never calendar days since first_sold_date.

    A product can satisfy this and still not be "active" (e.g. it's
    INACTIVE_DISCONTINUED but retains historical data), and a product
    can be "active" and still fail this (freshly added, real sales,
    just not 28 of them yet). Callers that need BOTH — active AND
    enough data — should intersect this function's result with
    get_active_products()'s ids, not rely on either alone.
    """
    active_ids = set(get_active_products()["id"].astype(int).tolist())
    if not active_ids:
        return []

    response = (
        supabase.table("daily_sales")
        .select("product_id, sale_date")
        .in_("product_id", list(active_ids))
        .execute()
    )
    df = pd.DataFrame(response.data)
    if df.empty:
        return []

    # Defensive dedup: count UNIQUE observation dates per product, not
    # raw row count — guards against any duplicate (product_id, date)
    # rows slipping through before clean_sales_data() has run on them.
    observation_counts = df.groupby("product_id")["sale_date"].nunique()
    eligible = observation_counts[observation_counts >= min_observations]
    return eligible.index.astype(int).tolist()


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


DEFAULT_OPERATING_DAYS = {0, 1, 2, 3, 4}  # Mon-Fri — current confirmed schedule


def get_operating_days() -> set:
    """
    The owner-configured set of weekdays the business operates on
    (0=Monday..6=Sunday, matching date.weekday()), from
    business_profile.operating_days. Falls back to the current
    confirmed Mon-Fri schedule if the row or column is missing (e.g.
    before migration 004 has been run), rather than crashing a forecast
    run over a config lookup.
    """
    response = (
        supabase.table("business_profile")
        .select("operating_days")
        .limit(1)
        .execute()
    )
    if not response.data or response.data[0].get("operating_days") is None:
        return set(DEFAULT_OPERATING_DAYS)
    return set(response.data[0]["operating_days"])


def get_earliest_data_date():
    """
    The earliest date this service has real sales data for — used for
    the one-time "has 12 months of history elapsed yet" gate before the
    very first training run is allowed (see /train in app.py).

    Prefers the earliest confirmed_open business_days date, since that's
    the more reliable open/closed-aware signal; falls back to the
    earliest daily_sales.sale_date when business_days has no rows yet
    (e.g. history uploaded before the business_days table/writes
    existed). Returns None if there's no data at all.
    """
    response = (
        supabase.table("business_days")
        .select("business_date")
        .eq("status", "confirmed_open")
        .order("business_date", desc=False)
        .limit(1)
        .execute()
    )
    if response.data:
        return response.data[0]["business_date"]

    response = (
        supabase.table("daily_sales")
        .select("sale_date")
        .order("sale_date", desc=False)
        .limit(1)
        .execute()
    )
    if response.data:
        return response.data[0]["sale_date"]
    return None


def get_latest_confirmed_open_date():
    """
    The most recent business_date with status='confirmed_open' in
    business_days — used to compute forecast staleness (how many days
    of sales uploads are still pending vs. what the forecast actually
    used as its freshest lag input). Returns None if no date has ever
    been confirmed open yet (e.g. before the first upload).

    NOTE: this is the one place this service reads business_days —
    Express owns writing to that table (on upload / manual closure),
    this service only ever reads it, same as every other table here.
    """
    response = (
        supabase.table("business_days")
        .select("business_date")
        .eq("status", "confirmed_open")
        .order("business_date", desc=True)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return response.data[0]["business_date"]


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


def get_forecast_runs_history(limit: int = 90) -> pd.DataFrame:
    """
    Most recent forecast_runs rows, newest first, for correlating
    forecast staleness against realized accuracy over time. Read-only —
    this service never writes to forecast_runs itself outside of
    supabase_writer.write_forecast_run().
    """
    response = (
        supabase.table("forecast_runs")
        .select("run_at, run_type, model_version, last_confirmed_date, stale_days")
        .order("run_at", desc=True)
        .limit(limit)
        .execute()
    )
    columns = ["run_at", "run_type", "model_version", "last_confirmed_date", "stale_days"]
    return pd.DataFrame(response.data, columns=columns)


def get_model_metrics_history(limit: int = 20) -> pd.DataFrame:
    """
    Most recent model_metrics rows, newest first, for comparing
    the current model's aggregate metrics against prior training runs
    over time.
    """
    response = (
        supabase.table("model_metrics")
        .select("model_version, evaluation_date, mape, mae, rmse, notes, feature_importance")
        .order("evaluation_date", desc=True)
        .limit(limit)
        .execute()
    )
    columns = ["model_version", "evaluation_date", "mape", "mae", "rmse", "notes", "feature_importance"]
    return pd.DataFrame(response.data, columns=columns)
