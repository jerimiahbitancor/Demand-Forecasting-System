"""
Every INSERT/UPSERT this service performs lives here, and only here —
the write-side mirror of data_loader.py. This service writes to exactly
four tables: forecasts, model_metrics, product_classifications,
forecast_cogs. It never touches ingredients, inventory_transactions,
products, or daily_sales.
"""
from datetime import date
from config import supabase


def write_forecast(forecast_row: dict):
    """
    Upserts on (product_id, forecast_date) so re-running the forecast
    job for a day that already has a row overwrites it instead of
    creating a duplicate. Requires a unique constraint on
    (product_id, forecast_date) in the forecasts table — add this via
    migration if it isn't there yet, otherwise this silently falls
    back to inserting duplicates.
    """
    supabase.table("forecasts").upsert(
        forecast_row, on_conflict="product_id,forecast_date"
    ).execute()


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
