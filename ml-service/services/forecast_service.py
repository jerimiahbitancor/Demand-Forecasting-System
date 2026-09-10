"""
Generates forecasts using the already-trained global model, loaded
from Supabase Storage. This module NEVER trains — it only loads
(model_storage.load_latest_model) and calls .predict(). That
separation is the whole point of the two-pipeline design: this can run
every morning at 8AM without ever touching the training pipeline.

BUSINESS RULE — current operating hours (confirmed): ChefDuo now
operates Monday-Friday, 3PM-3AM only. Historical training data still
contains some Saturday/Sunday sales from before this change, which the
model legitimately learns from — that's fine, `is_weekend` stays a
real, useful feature reflecting the historical record. But GOING
FORWARD, the store is closed every Saturday and Sunday under the
current policy, so a forecast for a future Saturday isn't really an
ML prediction problem at all — it's a known fact (0, closed) dressed
up as a forecast. Asking the model to extrapolate a demand number for
a day the business rules already say won't happen adds noise, not
value, so weekend dates in the forecast horizon are short-circuited to
0 here rather than sent through the model.
"""
from datetime import date, timedelta
import pandas as pd

from services.model_storage import load_latest_model
from services.feature_engineering import build_forecast_feature_row, apply_categorical_dtype, FEATURE_COLUMNS
from services.data_loader import get_daily_sales, get_active_products
from services.business_logic import classify_demand


class ModelNotReadyError(Exception):
    """Raised when no trained global model exists yet."""
    pass


def _is_operating_day(d: date) -> bool:
    """Mon-Fri only, per ChefDuo's current confirmed operating hours."""
    return d.weekday() < 5  # 0=Mon ... 4=Fri


def _get_recent_quantities(product_id: int, before_date: date, lookback_days: int = 30) -> list:
    """
    Recent actual sales for a product, used to seed lag_1/lag_7/rolling
    features for the first forecasted day. Uses actual recorded sales
    only — never predictions — for day 1 of any forecast run.
    """
    sales_df = get_daily_sales(product_id)
    sales_df = sales_df[sales_df["sale_date"].dt.date < before_date]
    sales_df = sales_df.sort_values("sale_date").tail(lookback_days)
    return sales_df["quantity_sold"].tolist()


def _known_product_categories() -> list:
    """
    The exact set of product_ids the global model needs to recognize
    as valid categories at prediction time. Must be pulled fresh, not
    assumed, since products can be added or archived between training
    runs — build_forecast_feature_row's category set has to match what
    apply_categorical_dtype uses here, or XGBoost will treat an unseen
    category as null rather than as that specific product.
    """
    return get_active_products()["id"].tolist()


def generate_forecast(product_id: int, horizon_days: int = 1) -> list:
    """
    Generates `horizon_days` forecasts for one product against the
    global model, starting tomorrow. horizon_days=1 for the daily
    refresh, 7 for the weekly recursive forecast (Monday-Sunday).

    Recursive strategy for operating days: day N's lag_1 uses day N-1's
    PREDICTED quantity when day N-1 hasn't actually happened yet,
    exactly as documented in the paper. Weekend dates are 0 by business
    rule (see module docstring) and are skipped as recursive inputs —
    the day after a forecasted Saturday/Sunday still looks back to the
    last real OPERATING day's prediction for lag_1, not to the
    business-rule zero, so a closed Saturday doesn't get treated as a
    real (and misleadingly low) sales day in the recursion.
    """
    model, model_version = load_latest_model()
    if model is None:
        raise ModelNotReadyError("No trained global model found in storage yet")

    today = date.today()
    recent_quantities = _get_recent_quantities(product_id, before_date=today)

    if len(recent_quantities) < 14:
        raise ModelNotReadyError(
            f"Product {product_id} has only {len(recent_quantities)} recent days "
            "of sales — needs at least 14 to seed lag/rolling features."
        )

    known_categories = _known_product_categories()
    results = []

    for day_offset in range(1, horizon_days + 1):
        target_date = today + timedelta(days=day_offset)

        if not _is_operating_day(target_date):
            results.append({
                "product_id": product_id,
                "forecast_date": target_date.isoformat(),
                "predicted_quantity": 0.0,
                "model_version": f"{model_version}_closed",
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
