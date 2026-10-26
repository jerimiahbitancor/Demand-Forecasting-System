"""
Forecast report, MODEL part (Oct 26 2026). Local, read-only.

For every product and day of a forecast window it rebuilds the exact
inputs the model was given (the 11 features), predicts again with the SAME
saved model version, and checks the result against the forecast stored in
the database. This shows, for Chapter 3, exactly what the model saw and
that the stored numbers come from it.

NOT called by Flask, NOT deployed. It imports the real service functions
(feature_engineering.build_feature_row, forecast_service.recent_series_from,
the operating-day rule) so nothing is reimplemented. It writes nothing to
Supabase and never trains.

Normally started by the backend report (backend/scripts/forecast-report.js),
which merges this JSON with the business calculations. On its own:

    cd ml-service
    python reports/forecast_inputs.py --from 2026-09-29 --to 2026-10-04 --json out.json

Needs ml-service/.env (the same file app.py and the training report use).

ASSUMPTION, checked rather than trusted: the forecast run started on the
window's first date. Day 1 uses only real sales before that date; each
later day also uses the model's own earlier predictions (the recursive
step), exactly like generate_forecast(). If the run really started on
another date, day 1 will not match and the report says so.
"""
import argparse
import json
import os
import sys
from datetime import date, timedelta

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from services.feature_engineering import (  # noqa: E402
    build_feature_row, apply_categorical_dtype, FEATURE_COLUMNS,
)
from services.forecast_service import recent_series_from, _is_operating_day  # noqa: E402

MATCH_TOLERANCE = 0.05  # items; the stored value is rounded to 2 decimals


def _prev_operating_day(d: date, operating_days: set) -> date:
    prev = d - timedelta(days=1)
    for _ in range(14):
        if _is_operating_day(prev, operating_days):
            return prev
        prev -= timedelta(days=1)
    return d - timedelta(days=1)


def reconstruct_product(product_id, window_dates, sales_by_date, open_dates, operating_days,
                        stored_by_date, model=None, known_categories=None):
    """
    Pure. Rebuilds the inputs of one product's forecast over `window_dates`
    (ascending) the way generate_forecast() built them, and predicts again
    when `model` is given. Returns one dict per date.

    stored_by_date: {date: predicted_quantity as stored} (may miss dates).
    """
    start = window_dates[0]
    history = recent_series_from(sales_by_date, open_dates, before_date=start)
    out = []
    step = 0
    for d in window_dates:
        stored = stored_by_date.get(d)
        if not _is_operating_day(d, operating_days):
            out.append({"product_id": product_id, "date": d.isoformat(), "closed": True,
                        "stored": stored, "recomputed": 0.0 if model is not None else None,
                        "match": stored in (None, 0, 0.0), "features": None, "step": None,
                        "uses_own_predictions": False})
            continue
        step += 1
        row = build_feature_row(product_id=product_id, target_date=d, history=history,
                                prev_open_date=_prev_operating_day(d, operating_days))
        recomputed = None
        if model is not None:
            X = pd.DataFrame([row])
            X = apply_categorical_dtype(X, known_categories=known_categories)
            X = X[FEATURE_COLUMNS]
            recomputed = max(0.0, float(model.predict(X)[0]))
        features = {k: (None if isinstance(v, float) and np.isnan(v) else (int(v) if k == "product_id" else float(v)))
                    for k, v in row.items() if k in FEATURE_COLUMNS}
        match = None
        if recomputed is not None and stored is not None:
            match = abs(round(recomputed, 2) - float(stored)) <= MATCH_TOLERANCE
        out.append({
            "product_id": product_id, "date": d.isoformat(), "closed": False, "step": step,
            # Day 2 onwards: lag_1 / rolling values include the model's own
            # earlier predictions, because those days had not happened yet.
            "uses_own_predictions": step > 1,
            "features": features, "stored": None if stored is None else float(stored),
            "recomputed": None if recomputed is None else round(recomputed, 4), "match": match,
        })
        # The recursive step, as in generate_forecast(): the next day sees
        # this day's prediction (the recomputed one, which is what production
        # used; the stored one when there is no model).
        carry = recomputed if recomputed is not None else (float(stored) if stored is not None else None)
        if carry is not None:
            history = history + [{"sale_date": d, "quantity_sold": carry, "is_real": False}]
    return out


def percentile_thresholds(quantities):
    """P40 / P80 exactly as business_logic.classify_demand computes them."""
    if not len(quantities):
        return None
    return {"p40": float(np.percentile(quantities, 40)), "p80": float(np.percentile(quantities, 80))}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Rebuild the model inputs of a forecast window (read-only).")
    parser.add_argument("--from", dest="start", required=True)
    parser.add_argument("--to", dest="end", required=True)
    parser.add_argument("--json", dest="out", required=True)
    parser.add_argument("--no-model", action="store_true", help="skip loading the model (inputs only)")
    args = parser.parse_args(argv)

    from config import supabase  # noqa: E402 — needs ml-service/.env
    from services.data_loader import (  # noqa: E402
        _fetch_all_rows, get_daily_sales, get_confirmed_open_dates, get_operating_days,
    )
    from services.model_storage import load_model_metadata, _download_model  # noqa: E402

    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    window = [start + timedelta(days=i) for i in range((end - start).days + 1)]

    rows = _fetch_all_rows(lambda: supabase.table("forecasts")
                           .select("product_id, forecast_date, predicted_quantity, model_version")
                           .gte("forecast_date", start.isoformat()).lte("forecast_date", end.isoformat())
                           .order("forecast_date").order("product_id"))
    versions = sorted({str(r["model_version"]).replace("_closed", "") for r in rows if r.get("model_version")})
    version = versions[-1] if versions else None

    metadata, model, notes = None, None, []
    if len(versions) > 1:
        notes.append(f"The window holds forecasts from {len(versions)} model versions {versions}; "
                     f"inputs are rebuilt for {version}.")
    if version:
        metadata = load_model_metadata(version)
        if not args.no_model:
            try:
                model = _download_model(version)
            except Exception as exc:  # noqa: BLE001 - report it, keep the inputs
                notes.append(f"Could not load model {version}: {exc}. Inputs are shown without re-prediction.")
    known_categories = (metadata or {}).get("product_categories")
    if model is not None and not known_categories:
        notes.append("The model has no product list saved, so it cannot be re-run safely; inputs only.")
        model = None

    open_dates = get_confirmed_open_dates()
    operating_days = get_operating_days()
    stored = {}
    for r in rows:
        if version and str(r["model_version"]).replace("_closed", "") != version:
            continue
        stored.setdefault(int(r["product_id"]), {})[date.fromisoformat(str(r["forecast_date"])[:10])] = r["predicted_quantity"]

    products, thresholds = [], {}
    for pid in sorted(stored):
        sales_df = get_daily_sales(pid)
        sales_by_date = {}
        if not sales_df.empty:
            sales_by_date = dict(zip(sales_df["sale_date"].dt.date, sales_df["quantity_sold"].astype(float)))
        before = [q for d, q in sales_by_date.items() if d < start]
        thresholds[pid] = percentile_thresholds(before)
        products.extend(reconstruct_product(pid, window, sales_by_date, open_dates, operating_days,
                                            stored[pid], model, known_categories))

    training = (metadata or {}).get("training") or {}
    result = {
        "window": {"from": start.isoformat(), "to": end.isoformat()},
        "model_version": version,
        "model_loaded": model is not None,
        "train_end_date": (metadata or {}).get("train_end_date"),
        "training": {k: training.get(k) for k in ("fit_period", "validation_period", "test_period",
                                                  "n_estimators", "fit_rows", "validation_rows", "test_rows")},
        "feature_columns": list(FEATURE_COLUMNS),
        "operating_days": sorted(operating_days),
        "thresholds": {str(k): v for k, v in thresholds.items()},
        "rows": products,
        "match_tolerance": MATCH_TOLERANCE,
        "notes": notes,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, default=str)
    matched = sum(1 for r in products if r.get("match") is True)
    checked = sum(1 for r in products if r.get("match") is not None)
    print(f"forecast_inputs: {len(stored)} product(s), {len(products)} row(s); re-prediction matched {matched}/{checked}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
