"""
Generates forecasts using the already-trained global model, loaded
from Supabase Storage. This module NEVER trains — it only loads
(model_storage.load_latest_model) and calls .predict(). That
separation is the whole point of the two-pipeline design: this can run
every morning at 8AM without ever touching the training pipeline.

BUSINESS RULE — operating schedule is owner-configurable (confirmed):
ChefDuo currently operates Monday-Friday, 3PM-3AM, but this is data the
owner edits in Settings (business_profile.operating_days), not a
hardcoded assumption — see data_loader.get_operating_days() and
_is_operating_day() below. Historical training data still contains
some Saturday/Sunday sales from before the current schedule, which the
model legitimately learns from — that's fine, `is_weekend` stays a
real, useful feature reflecting the historical record. But GOING
FORWARD, a date outside the configured operating days isn't really an
ML prediction problem at all — it's a known fact (0, closed) dressed
up as a forecast. Asking the model to extrapolate a demand number for
a day the business rules already say won't happen adds noise, not
value, so non-operating dates in the forecast horizon are
short-circuited to 0 here rather than sent through the model.
"""
from datetime import date, timedelta
import pandas as pd

from services.feature_engineering import build_forecast_feature_row, apply_categorical_dtype, FEATURE_COLUMNS
from services.data_loader import get_daily_sales
from services.business_logic import classify_demand


class ModelNotReadyError(Exception):
    """Raised when no trained global model exists yet."""
    pass


def _is_operating_day(d: date, operating_days: set) -> bool:
    """
    Owner-configured operating schedule (0=Mon..6=Sun), read from
    business_profile.operating_days by the caller — see
    data_loader.get_operating_days(). This used to hardcode Mon-Fri
    directly here, which meant a schedule change required a code
    deploy; now it's data the owner edits in Settings.
    """
    return d.weekday() in operating_days


def _get_recent_quantities(product_id: int, before_date: date, lookback_days: int = 60) -> list:
    """
    Recent actual sales for a product, used to seed lag_1/lag_7/rolling
    features for the first forecasted day. Uses actual recorded sales
    only — never predictions — for day 1 of any forecast run.
    """
    sales_df = get_daily_sales(product_id)
    sales_df = sales_df[sales_df["sale_date"].dt.date < before_date]
    sales_df = sales_df.sort_values("sale_date").tail(lookback_days)
    return sales_df["quantity_sold"].tolist()


def generate_forecast(
    product_id: int,
    model,
    model_version: str,
    known_categories: list,
    horizon_days: int = 1,
    start_offset: int = 0,
    operating_days: set = None,
) -> list:
    """
    Generates `horizon_days` forecasts for one product against the
    global model, starting `start_offset` days from today (default 0 —
    i.e. starting TODAY, not tomorrow). horizon_days=1/start_offset=0
    for the daily refresh (refreshes today's row using the freshest
    confirmed lag data), horizon_days=7/start_offset=0 for the weekly
    recursive forecast run each Monday (produces Monday-Sunday of that
    week). Whichever job most recently wrote a given
    (product_id, forecast_date) wins via the upsert in
    supabase_writer.write_forecast() — no extra "which source wins"
    logic needed as long as the date ranges above are correct.

    `model`, `model_version`, and `known_categories` are loaded ONCE by
    the caller (see /forecast in app.py) and passed in here — this used
    to load the model from Supabase Storage and re-query active
    products on every call, which meant 61 products = 61 redundant
    Storage round-trips per forecast run. Loading once outside the
    per-product loop is the fix.

    Recursive strategy for operating days: day N's lag_1 uses day N-1's
    PREDICTED quantity when day N-1 hasn't actually happened yet,
    exactly as documented in the paper. Weekend dates are 0 by business
    rule (see module docstring) and are skipped as recursive inputs —
    the day after a forecasted Saturday/Sunday still looks back to the
    last real OPERATING day's prediction for lag_1, not to the
    business-rule zero, so a closed Saturday doesn't get treated as a
    real (and misleadingly low) sales day in the recursion.
    """
    if operating_days is None:
        operating_days = {0, 1, 2, 3, 4}  # Mon-Fri fallback if caller didn't pass one

    today = date.today()
    recent_quantities = _get_recent_quantities(product_id, before_date=today)

    if len(recent_quantities) < 14:
        raise ModelNotReadyError(
            f"Product {product_id} has only {len(recent_quantities)} recent days "
            "of sales — needs at least 14 to seed lag/rolling features."
        )

    results = []

    for day_offset in range(start_offset, start_offset + horizon_days):
        target_date = today + timedelta(days=day_offset)

        if not _is_operating_day(target_date, operating_days):
            results.append({
                "product_id": product_id,
                "forecast_date": target_date.isoformat(),
                "predicted_quantity": 0.0,
                "model_version": f"{model_version}_closed",
                "rolling_7": None,  # business-rule zero day, not a real trend value
            })
            continue  # do NOT feed this into recent_quantities — see docstring

        feature_row = build_forecast_feature_row(product_id, target_date, recent_quantities)
        X = pd.DataFrame([feature_row])
        X = apply_categorical_dtype(X, known_categories=known_categories)
        X = X[FEATURE_COLUMNS]

        predicted = float(model.predict(X)[0])
        predicted = max(0.0, predicted)  # a forecast can't be negative demand

        results.append({
            "product_id": product_id,
            "forecast_date": target_date.isoformat(),
            "predicted_quantity": round(predicted, 2),
            "model_version": model_version,
            # Captured here (not discarded like before) so Express's
            # Performance Ratio calculation can read the exact same
            # rolling_7 this model was fed, instead of re-deriving its own
            # rolling average from daily_sales and risking drift between
            # the two. See backend/services/analyticsService.js.
            "rolling_7": round(feature_row["rolling_7"], 2),
        })

        # feed this day's prediction back in as the next OPERATING day's
        # most recent value — this is the recursive step
        recent_quantities.append(predicted)

    return results


def classify_forecast(product_id: int, predicted_quantity: float) -> dict:
    """
    Wraps business_logic.classify_demand with this product's own
    historical distribution, pulled fresh so the P40/P80 thresholds
    stay current as more sales accumulate.
    """
    sales_df = get_daily_sales(product_id)
    if sales_df.empty:
        return {"demand_tier": "Low", "p40_threshold": 0, "p80_threshold": 0}
    return classify_demand(predicted_quantity, sales_df["quantity_sold"])
