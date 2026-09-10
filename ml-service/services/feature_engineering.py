"""
THE most important file in this service.

Every feature used by the trained model is defined exactly once, here.
Both model_service.py (training) and forecast_service.py (live
forecasting) import from this file — neither one re-implements any of
this logic.

Why this matters: if training computed `is_weekend` one way and
forecasting computed it slightly differently, the model would be fed
inputs at prediction time that don't match what it learned from during
training. This is "training/serving skew" — the most common reason a
model that tested well quietly produces bad live results. Having one
shared source of truth for feature logic is how you prevent it
structurally, not just by being careful.

UPDATED for the global model: product_id is now a feature (one model
across all products, not one model per product). It's added as a
pandas `category` dtype and passed to XGBoost with
`enable_categorical=True`, rather than being one-hot encoded by hand —
XGBoost's native categorical support (2.x+) splits on categories
directly, which is cleaner than manufacturing 61 extra binary columns
and doesn't impose a false numeric ordering the way plain integer
label-encoding would.
"""
from datetime import date
import pandas as pd
from utils.holidays import is_holiday

# product_id is listed first deliberately — see engineer_features()
# for how its dtype gets set to 'category' before this list is used
# to slice the training/prediction matrix.
FEATURE_COLUMNS = [
    "product_id",
    "dow", "month", "day", "is_weekend", "is_holiday", "is_payday",
    "lag_1", "lag_7", "rolling_7", "rolling_14",
]

CATEGORICAL_COLUMNS = ["product_id"]


def calendar_features(d: date) -> dict:
    """
    The 6 calendar-derived features. Pure function of the date alone —
    these never depend on sales history, so they're always knowable in
    advance for both training rows and future forecast dates.
    """
    dow = d.weekday()  # 0=Mon ... 6=Sun, matches the paper's convention
    return {
        "dow": dow,
        "month": d.month,
        "day": d.day,
        "is_weekend": 1 if dow in (5, 6) else 0,
        "is_holiday": is_holiday(d),
        "is_payday": 1 if d.day in (15, 30) else 0,
    }


def engineer_features(sales_df: pd.DataFrame) -> pd.DataFrame:
    """
    Builds the full training feature set from cleaned daily_sales rows,
    across ALL products at once (this is the global-model dataset).

    Expects columns: product_id, sale_date (datetime), quantity_sold.
    Returns the same rows with all FEATURE_COLUMNS added, plus
    quantity_sold as the target.

    CLOSED-DAY HANDLING (deliberate, do not "fix" this into a
    zero-filled calendar grid): this function only ever computes
    lag/rolling values from rows that actually exist in daily_sales.
    A date with no row for a product is simply absent — not zero-filled
    — so lag_1 naturally resolves to "the last day this product
    actually had a recorded sale," which is correct whether that gap is
    a single closed Sunday or a whole recent shift in operating hours.
    Building a full product-x-date grid and filling gaps with 0 would
    reintroduce exactly the "closed day counted as zero demand" mistake
    documented in the paper's Step 1(a) — do not do that here.

    CRITICAL: lag/rolling values are computed per product (groupby),
    never across the whole table — mixing products would let one
    product's sales history leak into another's lag features. This
    still applies with the global model: pooling products into one
    training set is about sharing the MODEL, not sharing each other's
    lag history.

    Rows with insufficient history to compute lag_7/rolling_14 (a
    product's first ~14 recorded days) will have NaNs in those columns
    and should be dropped before training — see model_service.py.
    """
    sales_df = sales_df.sort_values(["product_id", "sale_date"]).copy()

    cal = sales_df["sale_date"].dt.date.apply(calendar_features).apply(pd.Series)
    sales_df = pd.concat([sales_df.reset_index(drop=True), cal.reset_index(drop=True)], axis=1)

    grouped = sales_df.groupby("product_id")["quantity_sold"]
    sales_df["lag_1"] = grouped.shift(1)
    sales_df["lag_7"] = grouped.shift(7)
    # shift(1) before rolling() so rolling_7 for day i uses days i-1..i-7,
    # never day i itself — this is the off-by-one leak called out in the
    # pipeline walkthrough.
    sales_df["rolling_7"] = grouped.shift(1).rolling(window=7).mean()
    sales_df["rolling_14"] = grouped.shift(1).rolling(window=14).mean()

    sales_df["product_id"] = sales_df["product_id"].astype("category")

    return sales_df


def build_forecast_feature_row(product_id: int, target_date: date, recent_quantities: list) -> dict:
    """
    Builds a single feature row for ONE product on ONE future date, for
    live forecasting against the global model.

    `recent_quantities` must be a chronologically-ordered list of the
    most recent quantities for this specific product, ending the day
    before target_date — actual sales where available, or previously
    predicted values when doing a recursive multi-day forecast (see
    forecast_service.py). At least 14 entries are needed to compute
    rolling_14; fewer than that means this product isn't ready to
    forecast yet.
    """
    if len(recent_quantities) < 14:
        raise ValueError(
            f"Need at least 14 days of recent history, got {len(recent_quantities)}"
        )

    row = calendar_features(target_date)
    row["product_id"] = product_id
    row["lag_1"] = recent_quantities[-1]
    row["lag_7"] = recent_quantities[-7]
    row["rolling_7"] = sum(recent_quantities[-7:]) / 7
    row["rolling_14"] = sum(recent_quantities[-14:]) / 14
    return row


def apply_categorical_dtype(df: pd.DataFrame, known_categories=None) -> pd.DataFrame:
    """
    Ensures product_id is a pandas 'category' dtype before it reaches
    XGBoost. At PREDICT time this must use the SAME category set the
    model was trained on (known_categories) — otherwise a product_id
    XGBoost never saw during training would be silently mis-handled.
    """
    df = df.copy()
    if known_categories is not None:
        df["product_id"] = pd.Categorical(df["product_id"], categories=known_categories)
    else:
        df["product_id"] = df["product_id"].astype("category")
    return df
