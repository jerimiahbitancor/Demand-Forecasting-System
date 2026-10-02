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

HOW THAT IS NOW ENFORCED (Oct 1 2026): there is ONE function,
build_feature_row(), and both sides call it. Training calls it once per
observation; /forecast calls it once per forecast date. It used to be two
functions — a vectorised pandas path for training and a separate
hand-rolled dict for forecasting — which is exactly the shape that lets
the two drift apart. The vectorised version was faster, but a per-row
loop over ~13,000 training rows costs well under a second, and buying a
structural parity guarantee for that is a trade worth making.
tests/test_feature_parity.py asserts the two paths agree row for row.

UPDATED for the global model: product_id is a feature (one model across
all products, not one model per product). It's added as a pandas
`category` dtype and passed to XGBoost with `enable_categorical=True`,
rather than being one-hot encoded by hand. Note that XGBoost stores each
category's POSITION, not the product id, so the exact training category
list is saved with the model — see model_storage.save_model_metadata().

THE OBSERVATION SERIES: features are built from the zero-filled
CONFIRMED-OPEN-DAY series, not from raw daily_sales rows — see
services/zero_fill.py for why and for what is never filled. Closed and
unconfirmed days never appear in it at all.
"""
from datetime import date

import pandas as pd

from services.zero_fill import build_open_day_series, previous_open_date
from utils.holidays import is_holiday

# product_id is listed first deliberately — see engineer_features()
# for how its dtype gets set to 'category' before this list is used
# to slice the training/prediction matrix.
#
# 12 features as of Oct 1 2026 (owner-approved change from 11):
#   - `lag_7` REMOVED. It meant "7 rows back," which is only "same day
#     last week" when there are no gaps. On a Mon-Sat schedule, 7 open
#     days back from a Monday is a Saturday — so more than half the
#     training rows had a lag_7 pointing at the wrong weekday.
#   - `same_dow_last_open` ADDED in its place: the real "same weekday,
#     last time we were open" value, found by searching the series.
#   - `days_since_last_open` ADDED: tells the model how big the gap
#     before this day was (1 normally, 2 after a closed Sunday, 15 after
#     a two-week closure), so it can tell a normal Tuesday from the first
#     day back after a shutdown.
# `month` and `day` were deliberately KEPT (the owner declined removing
# them). If FEATURE_COLUMNS changes again, every saved model becomes
# unusable until retrained — /forecast refuses to predict on a mismatch,
# see app.py.
FEATURE_COLUMNS = [
    "product_id",
    "dow", "month", "day", "is_weekend", "is_holiday", "is_payday",
    "lag_1", "same_dow_last_open", "days_since_last_open",
    "rolling_7", "rolling_14",
]

CATEGORICAL_COLUMNS = ["product_id"]

# Longest window any feature needs before it stops being NaN. rolling_14
# is the binding one. Rows below this are warm-up rows and get dropped by
# the caller's dropna(subset=FEATURE_COLUMNS).
WARMUP_OBSERVATIONS = 14


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


def build_feature_row(product_id: int, target_date: date, history: list,
                      prev_open_date: date = None) -> dict:
    """
    THE one feature function. Training and forecasting both call this.

    Args:
        product_id: this product's database id.
        target_date: the day being described (a past observation during
            training, a future date during forecasting).
        history: this product's zero-filled open-day series STRICTLY
            BEFORE target_date, oldest first. Each entry needs
            "quantity_sold" and "sale_date"; build_open_day_series()
            produces exactly this shape. During a recursive forecast the
            caller appends its own predictions here, which is what makes
            day 3 depend on day 2's guess.
        prev_open_date: the previous CONFIRMED-OPEN store date. Passed in
            rather than read off `history` on purpose — it is a
            store-level fact, and a product that was off the menu would
            otherwise report a gap the store never had. None yields NaN.

    Returns a plain dict with every key in FEATURE_COLUMNS. Anything that
    cannot be computed yet is float("nan"), which the training path drops
    as a warm-up row and the forecast path treats as "not ready".
    """
    row = calendar_features(target_date)
    row["product_id"] = product_id

    quantities = [float(h["quantity_sold"]) for h in history]

    row["lag_1"] = quantities[-1] if quantities else float("nan")

    # Same weekday, last time the store was open. Searched backwards
    # through real observations instead of assuming a fixed offset, which
    # is the whole point of replacing lag_7.
    row["same_dow_last_open"] = float("nan")
    target_dow = target_date.weekday()
    for past in reversed(history):
        if past["sale_date"].weekday() == target_dow:
            row["same_dow_last_open"] = float(past["quantity_sold"])
            break

    row["days_since_last_open"] = (
        float((target_date - prev_open_date).days) if prev_open_date is not None
        else float("nan")
    )

    row["rolling_7"] = sum(quantities[-7:]) / 7 if len(quantities) >= 7 else float("nan")
    row["rolling_14"] = sum(quantities[-14:]) / 14 if len(quantities) >= 14 else float("nan")

    return row


def engineer_features(sales_df: pd.DataFrame, open_dates=None) -> pd.DataFrame:
    """
    Builds the full training feature set across ALL products at once
    (this is the global-model dataset).

    Expects columns: product_id, sale_date (datetime), quantity_sold.
    `open_dates` is every CONFIRMED-OPEN store date (a set/list of
    datetime.date). Passing None disables zero-filling and falls back to
    "every date that has a row is an open day" — only for callers with no
    business_days access; production always passes the real list.

    Returns one row per observation in each product's zero-filled
    open-day series, with all FEATURE_COLUMNS plus:
      - quantity_sold: the target
      - is_real: False for a filled zero. Training eligibility counts
        real observations only — see filter_training_eligible().

    Per-product isolation is structural now: each product's series is
    built and walked on its own, so one product's history cannot leak
    into another's lag features. That used to depend on getting
    groupby(...).transform() exactly right.

    Rows without enough history for rolling_14 come back with NaNs and
    are dropped by the caller's dropna(subset=FEATURE_COLUMNS).
    """
    if sales_df.empty:
        return pd.DataFrame(columns=["product_id", "sale_date", "quantity_sold", "is_real", *FEATURE_COLUMNS])

    sales_df = sales_df.sort_values(["product_id", "sale_date"]).copy()
    sales_df["_date"] = sales_df["sale_date"].dt.date

    if open_dates is None:
        open_date_set = set(sales_df["_date"])
    else:
        open_date_set = set(open_dates)
    sorted_open = sorted(open_date_set)

    rows = []
    for product_id, group in sales_df.groupby("product_id", observed=True):
        sales_by_date = dict(zip(group["_date"], group["quantity_sold"]))
        series = build_open_day_series(sales_by_date, sorted_open)

        for index, entry in enumerate(series):
            target_date = entry["sale_date"]
            feature_row = build_feature_row(
                product_id=int(product_id),
                target_date=target_date,
                history=series[:index],
                prev_open_date=previous_open_date(target_date, sorted_open),
            )
            feature_row["sale_date"] = pd.Timestamp(target_date)
            feature_row["quantity_sold"] = float(entry["quantity_sold"])
            feature_row["is_real"] = entry["is_real"]
            rows.append(feature_row)

    features_df = pd.DataFrame(rows)
    if features_df.empty:
        return pd.DataFrame(columns=["product_id", "sale_date", "quantity_sold", "is_real", *FEATURE_COLUMNS])

    features_df = features_df.sort_values(["product_id", "sale_date"]).reset_index(drop=True)
    features_df["product_id"] = features_df["product_id"].astype("category")
    return features_df


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
