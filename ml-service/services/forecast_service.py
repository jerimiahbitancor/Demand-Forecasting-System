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

from utils.dates import manila_today
from services.feature_engineering import (
    build_feature_row, apply_categorical_dtype, FEATURE_COLUMNS, WARMUP_OBSERVATIONS,
)
from services.data_loader import get_daily_sales, get_confirmed_open_dates
from services.business_logic import classify_demand
from services.zero_fill import build_open_day_series


class ModelNotReadyError(Exception):
    """Raised when no trained global model exists yet."""
    pass


class ForecastWindowError(ValueError):
    """
    A chosen start date that cannot give a fair forecast. The message is
    shown to the owner as-is, so it is plain language.
    """
    pass


# start_date value meaning "the first open day after the latest uploaded
# sales" (Oct 26 2026) — the usual choice for an accuracy test.
AFTER_LATEST_SALES = "after_latest_sales"


def _long_date(d: date) -> str:
    return f"{d.strftime('%b')} {d.day}, {d.year}"


def next_forecastable_date(latest_open_date: date, operating_days: set, closed_dates=()) -> date:
    """
    The first day after `latest_open_date` that is an operating weekday and
    is not confirmed closed: the earliest day a forecast can start without
    skipping sales days that were never uploaded.
    """
    closed = set(closed_dates)
    d = latest_open_date + timedelta(days=1)
    for _ in range(366):
        if _is_operating_day(d, operating_days) and d not in closed:
            return d
        d += timedelta(days=1)
    return latest_open_date + timedelta(days=1)  # no operating days set at all


def resolve_forecast_window(requested_start, horizon_days: int, *, operating_days: set,
                            latest_open_date, closed_dates=(), train_end_date=None):
    """
    Pure. Turns an owner-chosen start (a "YYYY-MM-DD" string or
    AFTER_LATEST_SALES) into (start_date, horizon_days), or raises
    ForecastWindowError. Added Oct 26 2026 for accuracy tests: forecast
    from the day after the last uploaded sales, upload the real sales
    later, compare.

    Two rules keep such a test fair:
      1. No leakage — the start must be AFTER the model's train_end_date.
         A model scored on days it already learned would look better than
         it is. (The lag/rolling inputs are safe on their own:
         generate_forecast only reads sales BEFORE the start date.)
      2. No gap — the start may not be later than the first open day
         after the latest uploaded sales. Starting later would skip
         unuploaded days and treat old sales as "yesterday", which is the
         exact problem this option exists to avoid.

    Length: horizon_days == 1 -> that one day; anything else -> from the
    start through that week's Sunday (Mon-Sun weeks, like the Monday run).
    """
    if latest_open_date is None:
        raise ForecastWindowError(
            "No sales day has been confirmed open yet, so there is no sales data to start a forecast from."
        )
    next_day = next_forecastable_date(latest_open_date, operating_days, closed_dates)

    if requested_start == AFTER_LATEST_SALES:
        start = next_day
    else:
        try:
            start = date.fromisoformat(str(requested_start))
        except ValueError:
            raise ForecastWindowError("The start date must be a date in the form YYYY-MM-DD.")

    if train_end_date is not None and start <= train_end_date:
        raise ForecastWindowError(
            f"The current model already learned the sales up to {_long_date(train_end_date)}. "
            f"Pick a start date after that day, or the test would check days the model has already seen."
        )
    if start > next_day:
        raise ForecastWindowError(
            f"Sales data ends on {_long_date(latest_open_date)}. A forecast starting on "
            f"{_long_date(start)} would skip the days in between. Upload those days (or mark them "
            f"closed), or start on {_long_date(next_day)}."
        )

    horizon = 1 if int(horizon_days) == 1 else 7 - start.weekday()
    return start, horizon


def _is_operating_day(d: date, operating_days: set) -> bool:
    """
    Owner-configured operating schedule (0=Mon..6=Sun), read from
    business_profile.operating_days by the caller — see
    data_loader.get_operating_days(). This used to hardcode Mon-Fri
    directly here, which meant a schedule change required a code
    deploy; now it's data the owner edits in Settings.
    """
    return d.weekday() in operating_days


def recent_series_from(sales_by_date: dict, open_dates, before_date: date,
                       lookback_open_days: int = 60) -> list:
    """
    Pure: the newest `lookback_open_days` entries of the product's
    zero-filled series, built over its FULL history and only then trimmed.

    The order matters. Building the series from just the last 60 open days
    (the Oct 1 2026 first version) made the product's first sale INSIDE
    the window look like its first sale ever, so every open day before it
    went unfilled. A product last sold 20 open days before the window
    started and again near its end came back with 4 observations instead
    of 60 — skipped as "not enough history" even though it was trained —
    and any product with a gap at the window edge got different lag and
    rolling values here than training saw for the same dates. Building the
    whole series exactly as engineer_features() does and keeping the tail
    makes the two identical by construction (tests/test_feature_parity.py).
    """
    earlier_open = [d for d in open_dates if d < before_date]
    earlier_sales = {d: q for d, q in sales_by_date.items() if d < before_date}
    series = build_open_day_series(earlier_sales, earlier_open)
    return series[-lookback_open_days:]


def _get_recent_series(product_id: int, before_date: date, lookback_open_days: int = 60,
                       open_dates=None) -> list:
    """
    The product's zero-filled open-day series for the most recent
    `lookback_open_days` CONFIRMED-OPEN days before `before_date`.

    Two things changed here on Oct 1 2026, and both matter:

    1. The window is counted in OPEN DAYS, not rows. It used to fetch the
       newest 60 daily_sales ROWS, which for a slow-selling dish reached
       back months (it has no rows on the days it didn't sell) while a
       popular dish got exactly 60 days. The lag and rolling features
       assume a fixed-length window, so those two products were being
       described on completely different timescales.

    2. The gaps are zero-filled by the SAME function training uses
       (services/zero_fill.py), so a day the store was open and this dish
       sold nothing now reads as 0 on both sides instead of vanishing.

    Real recorded sales only — never predictions. The recursive step in
    generate_forecast() appends its own predictions on top of this.

    Reads the product's full history (one product is a few hundred rows,
    one page) and trims AFTER zero-filling — see recent_series_from() for
    why trimming first was wrong. `open_dates` should be loaded once per
    forecast run by the caller; it is fetched here only as a fallback.
    """
    if open_dates is None:
        open_dates = get_confirmed_open_dates()
    sales_df = get_daily_sales(product_id)
    sales_by_date = {}
    if not sales_df.empty:
        sales_by_date = dict(zip(sales_df["sale_date"].dt.date, sales_df["quantity_sold"].astype(float)))
    return recent_series_from(sales_by_date, open_dates, before_date, lookback_open_days)


def generate_forecast(
    product_id: int,
    model,
    model_version: str,
    known_categories: list,
    horizon_days: int = 1,
    start_offset: int = 0,
    operating_days: set = None,
    open_dates=None,
    start_date: date = None,
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

    # Day 1 of the run. Normally today (Asia/Manila, not the container's UTC
    # date). start_date (Oct 26 2026) lets an accuracy test start right after
    # the latest uploaded sales; only sales BEFORE it are read, so actual
    # sales uploaded later for the forecast days can never leak in.
    today = start_date or manila_today()
    history = _get_recent_series(product_id, before_date=today, open_dates=open_dates)

    if len(history) < WARMUP_OBSERVATIONS:
        raise ModelNotReadyError(
            f"Product {product_id} has only {len(history)} recent open-day "
            f"observations — needs at least {WARMUP_OBSERVATIONS} to seed "
            "lag/rolling features."
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
            continue  # do NOT feed this into `history` — see docstring

        # For a FUTURE date, "the previous open day" comes from the
        # owner's operating-days rule, not business_days (nobody has
        # confirmed tomorrow yet). Walk back to the nearest operating day
        # so days_since_last_open is 1 on an ordinary day and 2 on a
        # Monday after a closed Sunday, exactly as in training.
        prev_open = target_date - timedelta(days=1)
        while not _is_operating_day(prev_open, operating_days):
            prev_open -= timedelta(days=1)

        feature_row = build_feature_row(
            product_id=product_id,
            target_date=target_date,
            history=history,
            prev_open_date=prev_open,
        )
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

        # Feed this day's prediction back in as the next operating day's
        # most recent observation — the recursive step. It carries its
        # date too, because same_dow_last_open searches by weekday.
        history = history + [{
            "sale_date": target_date,
            "quantity_sold": predicted,
            "is_real": False,
        }]

    return results


def classify_forecast(product_id: int, predicted_quantity: float, before_date: date = None) -> dict:
    """
    Wraps business_logic.classify_demand with this product's own
    historical distribution, pulled fresh so the P40/P80 thresholds
    stay current as more sales accumulate.

    before_date (Oct 26 2026): for a run with a chosen start date, only
    sales before that date set P40/P80, the same history the forecast saw.
    """
    sales_df = get_daily_sales(product_id)
    if before_date is not None and not sales_df.empty:
        sales_df = sales_df[sales_df["sale_date"].dt.date < before_date]
    if sales_df.empty:
        return {"demand_tier": "Low", "p40_threshold": 0, "p80_threshold": 0}
    return classify_demand(predicted_quantity, sales_df["quantity_sold"])
