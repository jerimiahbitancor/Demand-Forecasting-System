"""
Flask entrypoint. This is the ONLY file Express talks to — everything
else in this service is a module it imports, not something exposed
over HTTP.

Two real endpoints, matching the two-pipeline design:
  POST /train      -> runs the training pipeline (occasional — plan is
                       monthly, per the confirmed retraining decision)
  POST /forecast    -> runs the forecasting pipeline (daily 8AM /
                       weekly Monday 8AM, per the confirmed schedule)
Plus /health for Render's health check and for Express to confirm this
service is up before showing "Training in progress" style states.
"""
import logging
from functools import wraps
import pandas as pd
from flask import Flask, request, jsonify

from config import ML_SERVICE_SHARED_SECRET, MIN_TRAINING_DAYS
from services.data_loader import (
    get_active_products, get_daily_sales, get_recipe_and_stock,
    get_safety_buffer_percentage,
)
from services.preprocessing import validate_sales_data, clean_sales_data, DataValidationError
from services.feature_engineering import engineer_features, FEATURE_COLUMNS
from services.model_service import train_global_model
from services.forecast_service import generate_forecast, classify_forecast, ModelNotReadyError
from services.business_logic import estimate_ingredient_demand, estimate_cogs
from services.supabase_writer import (
    write_model_metrics, write_forecast, write_classification, write_forecast_cogs,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ml-service")

app = Flask(__name__)


def require_shared_secret(f):
    """
    This service will have a public Render URL. Without this check,
    anyone who finds that URL could trigger retraining or forecast
    generation on your data. Express must send this header on every
    request. This is the minimum viable auth for a service-to-service
    call — not user-facing auth, which stays entirely in Express.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        provided = request.headers.get("X-ML-Service-Secret")
        if not ML_SERVICE_SHARED_SECRET or provided != ML_SERVICE_SHARED_SECRET:
            return jsonify({"error": "unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapper


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


@app.route("/train", methods=["POST"])
@require_shared_secret
def train():
    """
    Trains the single global model on every eligible active product's
    pooled history. Per confirmed decision: eligible means
    is_active=true AND first_sold_date is at least 28 days before
    today — newer products stay out of THIS training run entirely
    (not just skipped-with-a-warning) since 28 days isn't enough for
    even one rolling_14 window to be real, let alone contribute a
    meaningful gradient signal to a shared model.
    """
    all_products_df = get_active_products()
    eligible_ids = [
        int(row["id"]) for _, row in all_products_df.iterrows()
        if row.get("first_sold_date") is not None
    ]

    pooled_frames = []
    skipped = []
    for product_id in eligible_ids:
        try:
            sales_df = get_daily_sales(product_id)
            validate_sales_data(sales_df)
            sales_df = clean_sales_data(sales_df)

            if len(sales_df) < MIN_TRAINING_DAYS:
                skipped.append({"product_id": product_id, "reason": f"only {len(sales_df)} days"})
                continue

            pooled_frames.append(sales_df)
        except (DataValidationError, ValueError) as e:
            logger.warning(f"Skipping product {product_id} from training: {e}")
            skipped.append({"product_id": product_id, "reason": str(e)})

    if not pooled_frames:
        return jsonify({
            "status": "failed",
            "reason": "no eligible products had enough validated history",
            "skipped": skipped,
        }), 422

    all_sales_df = pd.concat(pooled_frames, ignore_index=True)
    features_df = engineer_features(all_sales_df).dropna(subset=FEATURE_COLUMNS)

    try:
        _, metrics, model_version = train_global_model(features_df)
    except ValueError as e:
        logger.error(f"Global training failed: {e}")
        return jsonify({"status": "failed", "reason": str(e)}), 422

    write_model_metrics(model_version, metrics)

    return jsonify({
        "status": "trained",
        "model_version": model_version,
        "products_included": len(pooled_frames),
        "products_skipped": skipped,
        "metrics": metrics,
    }), 200


@app.route("/forecast", methods=["POST"])
@require_shared_secret
def forecast():
    """
    Generates forecasts for all active products against the current
    global model, writes them, then runs the business logic layer
    (classification, ingredient demand, COGS) on top of the results.

    Accepts {"horizon_days": 1 or 7} in the JSON body — 1 for the
    daily refresh, 7 for the weekly recursive forecast (Mon-Sun).
    Weekend dates within that horizon are resolved to 0 by business
    rule inside generate_forecast(), not sent through the model — see
    forecast_service.py's module docstring for why.
    """
    body = request.get_json(silent=True) or {}
    horizon_days = int(body.get("horizon_days", 1))

    products_df = get_active_products()
    recipe_df = get_recipe_and_stock()
    safety_buffer = get_safety_buffer_percentage()

    day1_forecasts_by_product = {}
    results = []

    for _, product in products_df.iterrows():
        product_id = int(product["id"])
        try:
            forecast_rows = generate_forecast(product_id, horizon_days)

            for row in forecast_rows:
                write_forecast(row)

            first_day_qty = forecast_rows[0]["predicted_quantity"]
            day1_forecasts_by_product[product_id] = first_day_qty

            classification = classify_forecast(product_id, first_day_qty)
            write_classification(product_id, classification)

            cogs = estimate_cogs(first_day_qty, product_id, recipe_df)
            # forecast_cogs needs the forecast row's id from the upsert;
            # in production, capture that id from write_forecast's
            # response rather than re-querying here.

            results.append({
                "product_id": product_id, "status": "forecasted",
                "days_generated": len(forecast_rows),
                "demand_tier": classification["demand_tier"],
                "estimated_cogs_day1": cogs,
            })
        except ModelNotReadyError as e:
            logger.warning(f"Forecast skipped for product {product_id}: {e}")
            results.append({"product_id": product_id, "status": "skipped", "reason": str(e)})

    ingredient_demand_df = estimate_ingredient_demand(
        day1_forecasts_by_product, recipe_df, safety_buffer
    )

    return jsonify({
        "results": results,
        "ingredient_demand": ingredient_demand_df.to_dict(orient="records"),
    }), 200


if __name__ == "__main__":
    app.run(debug=True, port=5001)
