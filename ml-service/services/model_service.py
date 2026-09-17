"""
Training and evaluation for the GLOBAL model — one XGBoost regressor
across all products, with product_id as a feature.

DECISION LOG (why this replaced the earlier one-model-per-product
design): with 61 SKUs at varying volumes, several low-volume products
would never individually reach enough history to train a reliable
model of their own. Pooling all products into one training set lets
the model share what it learns about calendar effects (weekends,
paydays, holidays) across every product, including sparse ones, while
`product_id` as a feature lets it still tell products apart. The
tradeoff: a single high-volume product's patterns could dominate
training loss if left unchecked, which is why evaluation below always
reports per-product metrics, never only the aggregate — a global model
that looks great on average but is bad for half your menu is not
actually done correctly.

product_id is passed as a pandas `category` dtype with
`enable_categorical=True` on the regressor (native XGBoost categorical
splitting, available in XGBoost 2.x) — deliberately NOT
`.astype('category').cat.codes` cast to a plain integer. Manually
label-encoding categories produces a code that depends on which
categories were present and in what order *during that specific
training run* — if a product is added, archived, or the category list
otherwise shifts between two training runs, the same product could get
a different integer code each time, silently corrupting what the
saved model learned. `product_id` in this schema is already a stable,
permanent database primary key, so XGBoost's native categorical
handling can use it directly and safely, with no separate encoding
step to keep synchronized between training and forecasting.
"""
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error

from services.feature_engineering import FEATURE_COLUMNS
from services.model_storage import save_model_to_storage, new_model_version
from utils.debug_log import log_stage


def filter_training_eligible(features_df: pd.DataFrame, min_observations: int):
    """
    Eligibility, corrected: counts USABLE rows per product AFTER
    feature engineering and warmup-row removal — not raw daily_sales
    rows before it.

    WHY THIS MOVED HERE (out of data_loader.py, and out of a raw
    row-count check): rolling_14 needs 14 PRIOR observations before it
    stops being NaN, so a product's first 14 rows in the sequence
    always get dropped by the caller's dropna(subset=FEATURE_COLUMNS)
    before training — regardless of how many raw rows that product
    had. A product with exactly 28 raw observations would only
    contribute ~14 actual usable training rows, silently under the
    intended bar. Counting real survivors directly, instead of
    inferring the loss by subtracting a hardcoded warmup constant
    (e.g. 28 + 14 = 42), means this stays correct even if the warmup
    window changes later (a new rolling_28 feature, for instance)
    without anyone having to remember to update a second number to
    match.

    features_df must already be the output of engineer_features(...)
    with NaN warmup rows already dropped by the caller — this function
    only counts what SURVIVED that, per product.

    Returns (filtered_df, excluded_report) — filtered_df contains only
    rows belonging to products that cleared the bar; excluded_report
    lists every product that didn't, with its actual usable count, so
    the /train response can explain exactly why each excluded product
    was left out rather than silently vanishing from training.
    """
    counts = features_df.groupby("product_id", observed=True).size()
    eligible_ids = counts[counts >= min_observations].index
    excluded_counts = counts[counts < min_observations]

    filtered_df = features_df[features_df["product_id"].isin(eligible_ids)]
    excluded_report = [
        {"product_id": int(pid), "usable_observations": int(count),
         "required": min_observations}
        for pid, count in excluded_counts.items()
    ]
    return filtered_df, excluded_report


def chronological_split(df: pd.DataFrame, train_fraction: float = 0.8):
    """
    Time-ordered split, never random — and done GLOBALLY across the
    pooled multi-product dataset, on `sale_date`. This means every
    product's test set starts from the same calendar cutoff, which is
    simpler to reason about than each product having its own separate
    80/20 boundary, and matches the fact that there's now only one
    model being evaluated, not 61.
    """
    df = df.sort_values("sale_date").reset_index(drop=True)
    split_idx = int(len(df) * train_fraction)
    return df.iloc[:split_idx], df.iloc[split_idx:]


def train_global_model(features_df: pd.DataFrame, persist: bool = True, feature_columns: list = None):
    """
    Trains the single global XGBoost regressor.

    features_df must already have FEATURE_COLUMNS + quantity_sold,
    pooled across every active product, with NaN warm-up rows already
    dropped by the caller, and product_id already set to category
    dtype (engineer_features() does this).

    Returns (model, metrics, version) where metrics contains both the
    aggregate scores and a per-product breakdown.

    persist and feature_columns are report/diagnostic-only additions —
    every production call site (app.py's /train) omits both and gets
    byte-for-byte today's behavior. persist=False skips the Supabase
    Storage upload (still returns a version label, just doesn't write
    it anywhere) — for ablation/fold runs a diagnostic report trains
    that must never become a candidate for /forecast to load.
    feature_columns lets a caller train on a subset of FEATURE_COLUMNS
    (e.g. a rolling-features-removed ablation) without duplicating this
    function.
    """
    columns = feature_columns if feature_columns is not None else FEATURE_COLUMNS
    train_df, test_df = chronological_split(features_df)
    log_stage("train split", train_df, extra={"train_fraction": 0.8})
    log_stage("test split", test_df, extra={
        "train_ends": str(train_df["sale_date"].max()) if not train_df.empty else None,
        "test_starts": str(test_df["sale_date"].min()) if not test_df.empty else None,
    })

    if len(train_df) < 200:
        raise ValueError(
            f"Only {len(train_df)} pooled training rows — not enough "
            "history across active products to train reliably yet."
        )

    X_train, y_train = train_df[columns], train_df["quantity_sold"]
    X_test, y_test = test_df[columns], test_df["quantity_sold"]

    model = xgb.XGBRegressor(
        n_estimators=200,          # more trees than the per-product version,
                                    # since the pooled dataset is much larger
        max_depth=5,
        learning_rate=0.1,
        reg_lambda=1.0,
        gamma=0.1,
        subsample=0.9,
        tree_method="hist",        # required for enable_categorical
        enable_categorical=True,   # native categorical splits on product_id
        random_state=42,
    )
    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    aggregate_metrics = evaluate_predictions(y_test.values, predictions)
    per_product_metrics = evaluate_per_product(test_df, predictions)

    # Native categorical support (enable_categorical=True) keeps product_id
    # as ONE column, not one-hot expanded — so feature_importances_ lines
    # up 1:1 with FEATURE_COLUMNS, no reconciliation needed. This is what
    # powers Analytics > Forecasting > Model Insights; previously this was
    # computed and immediately discarded.
    feature_importance = {
        col: float(score) for col, score in zip(columns, model.feature_importances_)
    }

    version = new_model_version()
    if persist:
        save_model_to_storage(model, version)

    metrics = {
        "aggregate": aggregate_metrics,
        "per_product": per_product_metrics,
        "feature_importance": feature_importance,
    }
    return model, metrics, version


def evaluate_predictions(actual: np.ndarray, predicted: np.ndarray) -> dict:
    """
    MAE, RMSE, MAPE. MAPE guards against division by zero (a day with
    0 actual sales would otherwise blow up the percentage error) —
    this matters more now than in the per-product design, since a
    global test set will definitely include some zero-sale days for
    low-volume products.
    """
    mae = mean_absolute_error(actual, predicted)
    rmse = np.sqrt(mean_squared_error(actual, predicted))

    nonzero_mask = actual != 0
    if nonzero_mask.sum() == 0:
        mape = None
    else:
        mape = float(np.mean(
            np.abs((actual[nonzero_mask] - predicted[nonzero_mask]) / actual[nonzero_mask])
        ) * 100)

    return {"mae": float(mae), "rmse": float(rmse), "mape": mape}


def evaluate_per_product(test_df: pd.DataFrame, predictions: np.ndarray) -> list:
    """
    Breaks the aggregate metrics down by product_id. A blended MAPE
    across 61 products of wildly different volumes hides exactly the
    products doing worst — this is the check that catches that.
    """
    scored = test_df[["product_id", "quantity_sold"]].copy()
    scored["predicted"] = predictions

    breakdown = []
    for product_id, group in scored.groupby("product_id", observed=True):
        metrics = evaluate_predictions(group["quantity_sold"].values, group["predicted"].values)
        breakdown.append({"product_id": product_id, "test_rows": len(group), **metrics})
    return breakdown
