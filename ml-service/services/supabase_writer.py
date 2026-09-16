"""
Every INSERT/UPSERT this service performs lives here, and only here —
the write-side mirror of data_loader.py. This service writes to exactly
five tables: forecasts, model_metrics, product_classifications,
forecast_cogs, forecast_runs. It never touches ingredients,
inventory_transactions, products, daily_sales, or business_days (that
last one is read-only from this service — see data_loader.py).
"""
from datetime import date
from config import supabase


def write_forecast(forecast_row: dict):
    """
    Upserts on (product_id, forecast_date) so re-running the forecast
    job for a day that already has a row overwrites it instead of
    creating a duplicate. Requires a unique constraint on
    (product_id, forecast_date) in the forecasts table — see
    migrations/002_add_forecasts_unique_constraint.sql. Without that
    constraint live in Supabase, this call errors outright (Postgres
    has no ON CONFLICT target to match), it does NOT silently fall
    back to inserting duplicates.

    Returns the upserted row's id so callers (e.g. /forecast in app.py)
    can pass it to write_forecast_cogs() — without capturing this,
    forecast_cogs has no way to know which forecast row it belongs to.
    """
    result = supabase.table("forecasts").upsert(
        forecast_row, on_conflict="product_id,forecast_date"
    ).execute()
    return result.data[0]["id"] if result.data else None


def write_model_metrics(model_version: str, metrics: dict):
    """
    UPDATED for the global model: one row per training run (not one
    per product). `metrics` is the {"aggregate": ..., "per_product": [...]}
    dict from model_service.train_global_model().

    The model_metrics table has no column for a structured per-product
    breakdown, so it's summarized into `notes` — good enough for a
    capstone-scale dashboard/log, but if the "worst-performing products"
    view ever needs to query this properly, that breakdown belongs in
    its own table rather than parsed out of a text field.
    """
    aggregate = metrics["aggregate"]
    worst = sorted(metrics["per_product"], key=lambda p: p["mape"] or 0, reverse=True)[:3]
    worst_summary = "; ".join(
        f"product_id={p['product_id']} mape={p['mape']:.1f}%" for p in worst if p["mape"] is not None
    )

    supabase.table("model_metrics").insert({
        "model_version": model_version,
        "evaluation_date": date.today().isoformat(),
        "mape": aggregate["mape"],
        "mae": aggregate["mae"],
        "rmse": aggregate["rmse"],
        "notes": f"global model; worst products: {worst_summary}" if worst_summary else "global model",
        "feature_importance": metrics.get("feature_importance"),
    }).execute()


def write_classification(product_id: int, classification: dict):
    supabase.table("product_classifications").insert({
        "product_id": product_id,
        "classification_date": date.today().isoformat(),
        "demand_tier": classification["demand_tier"],
        "basis": f"p40={classification['p40_threshold']:.1f}, p80={classification['p80_threshold']:.1f}",
    }).execute()


def write_forecast_cogs(forecast_id: int, estimated_cost: float):
    supabase.table("forecast_cogs").insert({
        "forecast_id": forecast_id,
        "estimated_cost": estimated_cost,
    }).execute()


def write_forecast_run(run_type: str, model_version: str, last_confirmed_date, stale_days: int):
    """
    One row per /forecast execution (daily or weekly). Express reads the
    latest row to drive the freshness warning and Dashboard state
    without recomputing business-day status on every page load.
    """
    supabase.table("forecast_runs").insert({
        "run_type": run_type,
        "model_version": model_version,
        "last_confirmed_date": last_confirmed_date,
        "stale_days": stale_days,
    }).execute()
