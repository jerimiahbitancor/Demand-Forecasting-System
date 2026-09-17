"""
Local-only diagnostic report for the training pipeline.

NOT called by Flask, NOT deployed to Render, NOT imported by app.py or
anything under services/ — this is a separate tool a developer runs by
hand on their own machine to see what each stage of /train actually
produces. It imports the real service functions directly (data_loader,
preprocessing, feature_engineering, model_service, model_storage) so
every stage genuinely matches production behavior; nothing here
reimplements that logic.

Run from the ml-service/ directory (needs ml-service/.env with real
Supabase credentials, same file app.py uses):

    cd ml-service
    pip install -r requirements-dev.txt
    python reports/generate_training_report.py

By default this does NOT train a new model — it loads the latest model
already saved in Supabase Storage (read-only) and re-evaluates it
against a freshly pooled dataset, purely for reporting. Pass --train if
you explicitly want this run to train (and upload) a brand new model
version:

    python reports/generate_training_report.py --train

--train is opt-in on purpose. Supabase Storage's ml-models bucket is
the same bucket /forecast reads from (load_latest_model() always picks
the newest file by timestamp) — a diagnostic script that trained
silently by default could accidentally become the model driving real
forecasts. See ml-service/reports/README.md.

Every OTHER model this script trains for diagnostics — the rolling-
features-removed ablation, and both two-fold time-stability runs — is
always trained with persist=False and is never uploaded anywhere,
regardless of whether --train was passed. Only the single model
acquired by _acquire_report_model() (shared by every section that needs
"the current model") can ever be a freshly-trained, uploaded model, and
only when --train is passed.

Output:
  - Printed tables to the terminal, one per pipeline stage.
  - ml-service/reports/output/training_report.html — a single
    self-contained HTML file (all plots embedded as base64 PNGs, no
    external CSS/JS) with a sticky sidebar for jumping between stages.
"""
import argparse
import base64
import io
import os
import sys
from datetime import datetime

import matplotlib
matplotlib.use("Agg")  # headless — this script has no display attached
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

# This script lives in ml-service/reports/, but config.py and services/
# live in ml-service/ itself. Running "python reports/generate_training_report.py"
# only puts ml-service/reports/ on sys.path automatically, so ml-service/
# has to be added explicitly before any of the real service imports below
# will resolve.
ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

# Belt-and-suspenders: this script's OWN directory (for the sibling
# metrics.py import below). Normally already sys.path[0] when run
# directly as "python reports/generate_training_report.py", but made
# explicit so this doesn't silently depend on how it's invoked.
REPORTS_DIR = os.path.dirname(os.path.abspath(__file__))
if REPORTS_DIR not in sys.path:
    sys.path.insert(0, REPORTS_DIR)

from config import MIN_TRAINING_OBSERVATIONS  # noqa: E402
from services.data_loader import (  # noqa: E402
    get_active_products, get_daily_sales,
    get_forecast_runs_history, get_model_metrics_history,
)
from services.preprocessing import (  # noqa: E402
    validate_sales_data, clean_sales_data, DataValidationError,
)
from services.feature_engineering import (  # noqa: E402
    engineer_features, FEATURE_COLUMNS,
    build_forecast_feature_row, apply_categorical_dtype,
)
from services.model_service import (  # noqa: E402
    filter_training_eligible, chronological_split, train_global_model,
    evaluate_predictions, evaluate_per_product,
)
from services.model_storage import load_latest_model, load_previous_model  # noqa: E402
from metrics import wmape, smape, mase  # noqa: E402

REPORT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
REPORT_PATH = os.path.join(REPORT_DIR, "training_report.html")

# Kept in sync BY HAND with FEATURE_LABELS in
# backend/services/analyticsService.js (the Model Insights panel's
# display names) — if one changes, update the other. There is no shared
# source for this mapping across the JS/Python boundary.
FEATURE_LABELS = {
    "product_id": "Product",
    "dow": "Day of Week",
    "month": "Month",
    "day": "Day of Month",
    "is_weekend": "Weekend",
    "is_holiday": "Holiday",
    "is_payday": "Payday",
    "lag_1": "Yesterday's Sales",
    "lag_7": "Sales From Last Week (Same Day)",
    "rolling_7": "Rolling Average (7 days)",
    "rolling_14": "Rolling Average (14 days)",
}

# --- Module-level report constants (deliberately here, not in services/,
# since these are report-only diagnostic thresholds, not production
# business rules) ---
VOLUME_TIER_HIGH = 15      # avg daily quantity >= this -> "High"
VOLUME_TIER_MEDIUM = 5     # avg daily quantity >= this (and < HIGH) -> "Medium"; below -> "Low"
LOW_OBS_REVIEW_THRESHOLD = 20   # fewer than this many lifetime rows -> flagged for manual review
LOW_VOLUME_REP_FLOOR = 50       # total_quantity floor for a genuine low-volume representative

REDUCED_FEATURE_COLUMNS = [c for c in FEATURE_COLUMNS if c not in ("rolling_7", "rolling_14")]

FINAL_SECTION_ORDER = [
    "preprocessing", "outliers", "split", "features", "baseline",
    "importance", "importance_ablation", "metrics", "train_test_metrics",
    "horizon", "predictions", "stability", "production_reality",
]

pd.set_option("display.width", 140)
pd.set_option("display.max_columns", None)

# One dict per stage: {"id", "title", "body"} — appended as each stage
# runs, rendered into the HTML template once at the very end, per the
# "assemble first, render once" instruction (no inline string-concat of
# HTML at each stage). Final HTML/nav order is enforced separately by
# FINAL_SECTION_ORDER right before render_html() — see main() — so the
# ORDER these get appended in during execution doesn't have to match
# the order they're displayed in.
_sections = []

# Model acquired ONCE per report run and reused by every section that
# needs "the current model" (Feature Importance, Evaluation Metrics,
# Baseline Comparison, the ablation section's "original" side, Train
# vs. Test, Production Reality Check) — see _acquire_report_model().
_MODEL_CACHE = {}

# product_id -> "High"/"Medium"/"Low", populated by stage_1_preprocessing
# (computed from full lifetime all_sales_df) and reused later by the
# Evaluation Metrics section's grouped-by-tier table, so both places
# agree on the same tier for the same product.
_VOLUME_TIERS_CACHE = {}


def print_table(stage_name: str, df: pd.DataFrame) -> None:
    print(f"\n{'=' * 78}")
    print(f"STAGE: {stage_name}")
    print(f"{'=' * 78}")
    print(df.to_string(index=False))
    print(f"{'=' * 78}\n")


def fig_to_base64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
    plt.close(fig)  # free memory between stages — 7 figures held open would add up
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


def img_tag(fig, alt: str) -> str:
    return f'<img src="data:image/png;base64,{fig_to_base64(fig)}" alt="{alt}">'


def add_section(section_id: str, title: str, body_html: str) -> None:
    _sections.append({"id": section_id, "title": title, "body": body_html})


def df_to_html_table(df: pd.DataFrame) -> str:
    """Shared HTML table rendering — every new table in this report goes
    through this one function so they all look consistent."""
    return df.to_html(index=False, classes="data-table", border=0, na_rep="—")


def iqr_summary_table(df: pd.DataFrame) -> pd.DataFrame:
    """Per-product Q1/Q3/IQR/whisker-outlier-count for quantity_sold."""
    rows = []
    for product_id, group in df.groupby("product_id"):
        q1 = group["quantity_sold"].quantile(0.25)
        q3 = group["quantity_sold"].quantile(0.75)
        iqr = q3 - q1
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        rows.append({
            "product_id": product_id,
            "count": len(group),
            "total_quantity": int(group["quantity_sold"].sum()),
            "q1": q1,
            "q3": q3,
            "iqr": iqr,
            "lower_whisker": lower,
            "upper_whisker": upper,
            "n_below_whisker": int((group["quantity_sold"] < lower).sum()),
            "n_above_whisker": int((group["quantity_sold"] > upper).sum()),
        })
    return pd.DataFrame(rows).sort_values("total_quantity", ascending=False)


def _volume_tier(avg_daily_qty: float) -> str:
    if avg_daily_qty >= VOLUME_TIER_HIGH:
        return "High"
    if avg_daily_qty >= VOLUME_TIER_MEDIUM:
        return "Medium"
    return "Low"


def pick_representative_products(eligible_df: pd.DataFrame):
    """
    One high-volume, one low-volume product_id, both training-eligible.

    The low-volume pick only considers products with total_quantity >=
    LOW_VOLUME_REP_FLOOR — without this floor, the "low-volume
    representative" used throughout this report (split/feature/
    baseline/horizon sections) could land on a data-hygiene artifact
    (e.g. a test SKU or a since-discontinued one-off with a handful of
    sales) rather than a genuine sparse-but-real dish. If every
    eligible product is below the floor, falls back to the
    lowest-volume product overall (today's original behavior) and
    prints a one-line warning.
    """
    volume = eligible_df.groupby("product_id", observed=True)["quantity_sold"].sum()
    volume = volume.sort_values(ascending=False)
    if len(volume) < 2:
        pid = int(volume.index[0])
        return pid, pid

    high_id = int(volume.index[0])

    floor_eligible = volume[volume >= LOW_VOLUME_REP_FLOOR]
    if not floor_eligible.empty:
        low_id = int(floor_eligible.index[-1])
    else:
        print(f"  WARNING: no product cleared the LOW_VOLUME_REP_FLOOR="
              f"{LOW_VOLUME_REP_FLOOR} total-quantity floor — falling back to the "
              "lowest-volume product overall as the low-volume representative.")
        low_id = int(volume.index[-1])
    return high_id, low_id


def _acquire_report_model(eligible_df: pd.DataFrame, force_train: bool):
    """
    Shared model acquisition. Every section that needs the CURRENT
    model's predictions or feature importance — Feature Importance,
    Evaluation Metrics, Baseline Comparison, the rolling-features-
    removed ablation's "original" comparison side, Train vs. Test, and
    Production Reality Check — goes through this one function instead
    of each independently calling load_latest_model()/
    train_global_model().

    Cached at module level (one report run, one model) so a --train run
    calls train_global_model() with persist=True exactly ONCE no matter
    how many sections ask for the model. Calling it a second time would
    silently upload a second, redundant model_v... file to the same
    Supabase Storage bucket /forecast reads from — exactly the kind of
    surprise side effect the --train flag is meant to avoid causing
    casually.

    Returns (model, model_version, metrics_or_None, trained_now, feature_importance).
    """
    if "result" in _MODEL_CACHE:
        return _MODEL_CACHE["result"]

    if not force_train:
        model, model_version = load_latest_model()
    else:
        model, model_version = None, None

    trained_now = False
    metrics = None
    if model is None:
        if not force_train:
            print("  No saved model found in Supabase Storage.")
        print("  Training a new global model now via train_global_model()...")
        print("  *** This uploads a new model_v... file to the ml-models bucket ***")
        model, metrics, model_version = train_global_model(eligible_df)
        trained_now = True
        feature_importance = metrics["feature_importance"]
    else:
        print(f"  Using latest saved model: {model_version} (read-only — no retraining, no new Storage write)")
        feature_importance = {
            col: float(score) for col, score in zip(FEATURE_COLUMNS, model.feature_importances_)
        }

    result = (model, model_version, metrics, trained_now, feature_importance)
    _MODEL_CACHE["result"] = result
    return result


# ---------------------------------------------------------------------
# Stage 1: Data Load & Preprocessing
# ---------------------------------------------------------------------
def stage_1_preprocessing():
    print("[1/13] Data load & preprocessing...")

    active_ids = get_active_products()["id"].astype(int).tolist()

    pooled_frames = []
    skipped = []
    for product_id in active_ids:
        try:
            sales_df = get_daily_sales(product_id)
            validate_sales_data(sales_df)
            sales_df = clean_sales_data(sales_df)
            pooled_frames.append(sales_df)
        except (DataValidationError, ValueError) as e:
            skipped.append({"product_id": product_id, "reason": str(e)})

    if not pooled_frames:
        print("No active products had validated sales history — nothing to report on.")
        sys.exit(1)

    all_sales_df = pd.concat(pooled_frames, ignore_index=True)

    summary = pd.DataFrame([{
        "total_rows": len(all_sales_df),
        "unique_products": all_sales_df["product_id"].nunique(),
        "date_min": all_sales_df["sale_date"].min().date(),
        "date_max": all_sales_df["sale_date"].max().date(),
        "active_products": len(active_ids),
        "products_included": len(pooled_frames),
        "products_skipped": len(skipped),
    }])
    print_table("1. Data Load & Preprocessing — summary", summary)
    if skipped:
        print_table("1. Data Load & Preprocessing — skipped (validation failed)", pd.DataFrame(skipped))
    else:
        print("  (no products skipped at the preprocessing stage)")

    daily_totals = all_sales_df.groupby("sale_date")["quantity_sold"].sum().reset_index()
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(daily_totals["sale_date"], daily_totals["quantity_sold"], color="#2563eb", linewidth=1)
    ax.set_title("Total Daily Quantity Sold — All Active Products, Pooled")
    ax.set_xlabel("Date")
    ax.set_ylabel("Total Quantity Sold")
    fig.autofmt_xdate()

    body = f"""
    <p>Pulled via <code>get_active_products()</code>, then per product
    <code>get_daily_sales()</code> &rarr; <code>validate_sales_data()</code> &rarr;
    <code>clean_sales_data()</code> — the exact same calls, in the exact same order,
    that <code>/train</code> makes. {len(pooled_frames)} of {len(active_ids)} active
    products had valid history and were pooled; {len(skipped)} were skipped
    (see terminal for reasons). Pooled range:
    {all_sales_df['sale_date'].min().date()} to {all_sales_df['sale_date'].max().date()},
    {len(all_sales_df)} rows.</p>
    <p>Closed days are simply absent from this chart's underlying data, never
    zero-filled — a gap in the line reflects that, not a real zero-demand day.</p>
    {img_tag(fig, "Total daily quantity sold, all active products")}
    """

    # --- NEW: zero-inflation table ---
    zero_rows = []
    for product_id, group in all_sales_df.groupby("product_id"):
        n = len(group)
        zero_count = int((group["quantity_sold"] == 0).sum())
        zero_rows.append({
            "product_id": product_id,
            "total_rows": n,
            "zero_rows": zero_count,
            "zero_pct": round(zero_count / n * 100, 1) if n else 0.0,
        })
    zero_inflation_df = pd.DataFrame(zero_rows).sort_values("zero_pct", ascending=False)
    print_table("1. Data Load & Preprocessing — zero-inflation per product", zero_inflation_df)

    # --- NEW: volume tiers (also populates _VOLUME_TIERS_CACHE for later sections) ---
    iqr_for_tiers = iqr_summary_table(all_sales_df)
    tier_rows = []
    for _, row in iqr_for_tiers.iterrows():
        avg_daily = (row["total_quantity"] / row["count"]) if row["count"] else 0.0
        tier = _volume_tier(avg_daily)
        _VOLUME_TIERS_CACHE[int(row["product_id"])] = tier
        tier_rows.append({
            "product_id": int(row["product_id"]),
            "total_quantity": row["total_quantity"],
            "count": int(row["count"]),
            "avg_daily_quantity": round(avg_daily, 2),
            "volume_tier": tier,
        })
    volume_tier_df = pd.DataFrame(tier_rows).sort_values("avg_daily_quantity", ascending=False)
    print_table("1. Data Load & Preprocessing — volume tiers", volume_tier_df)
    tier_counts = (
        volume_tier_df["volume_tier"].value_counts()
        .reindex(["High", "Medium", "Low"]).fillna(0).astype(int)
    )

    # --- NEW: low-observation review flag (neutral surfacing only) ---
    low_obs_df = volume_tier_df.loc[
        volume_tier_df["count"] < LOW_OBS_REVIEW_THRESHOLD, ["product_id", "count"]
    ].copy()
    if not low_obs_df.empty:
        low_obs_df["note"] = (
            "Very few recorded sales — worth checking in Product Management whether "
            "this is a real, currently-sold menu item before relying on its forecast."
        )
        print_table("1. Data Load & Preprocessing — low-observation review flag", low_obs_df)
    else:
        print("  (no products fell below the low-observation review threshold)")

    zero_inflation_html = df_to_html_table(zero_inflation_df)
    volume_tier_html = df_to_html_table(volume_tier_df)
    low_obs_html = (
        df_to_html_table(low_obs_df) if not low_obs_df.empty
        else "<p>No products fell below the low-observation review threshold.</p>"
    )
    skipped_html = (
        df_to_html_table(pd.DataFrame(skipped)) if skipped
        else "<p>No products were skipped at the preprocessing stage.</p>"
    )

    body += f"""
    <h3>Zero-Inflation Check</h3>
    <p>Per product, how many of its rows are a genuine recorded zero — a confirmed-open day
    with real zero sales, not a closed/absent day (which never produces a row at all — see
    above). A high zero rate on a real menu item is a legitimate signal the model needs to
    learn, not a data quality problem.</p>
    {zero_inflation_html}

    <h3>Volume Tiers</h3>
    <p>Every product bucketed by lifetime average daily quantity: High (&ge;{VOLUME_TIER_HIGH}/day),
    Medium ({VOLUME_TIER_MEDIUM}&ndash;{VOLUME_TIER_HIGH}/day), Low (&lt;{VOLUME_TIER_MEDIUM}/day) —
    {tier_counts.get('High', 0)} High, {tier_counts.get('Medium', 0)} Medium,
    {tier_counts.get('Low', 0)} Low. Reused later in this report's Evaluation Metrics section so a
    low-volume product's typically-worse metrics don't get silently blended into the same average
    as a high-volume one.</p>
    {volume_tier_html}

    <h3>Low-Observation Review Flag</h3>
    <p>Products with fewer than {LOW_OBS_REVIEW_THRESHOLD} total lifetime rows in daily_sales.
    This is a neutral surfacing only — nothing here is auto-classified or auto-excluded; that
    decision belongs to whoever manages Product Management, not this report.</p>
    {low_obs_html}

    <h3>Skipped Products (Validation Failed)</h3>
    <p>Products with sales history that failed <code>validate_sales_data()</code>.</p>
    {skipped_html}
    """
    add_section("preprocessing", "1. Data Load &amp; Preprocessing", body)
    print("[1/13] Done.")
    return all_sales_df, skipped


def extend_preprocessing_with_excluded(excluded: list) -> None:
    """
    Appends the eligibility-excluded products table to Stage 1's
    already-added section body. Called from main() AFTER
    filter_training_eligible() runs — `excluded` doesn't exist yet at
    the point stage_1_preprocessing() builds and adds its section, so
    this has to happen as a separate, later step rather than being
    computed inside that function.
    """
    excluded_html = (
        df_to_html_table(pd.DataFrame(excluded)) if excluded
        else "<p>No products were excluded at the eligibility-filtering stage.</p>"
    )
    extra = f"""
    <h3>Excluded Products (Eligibility Filter)</h3>
    <p>Products with valid sales history that still didn't clear
    <code>MIN_TRAINING_OBSERVATIONS={MIN_TRAINING_OBSERVATIONS}</code> usable post-warmup
    rows — see <code>model_service.filter_training_eligible()</code>.</p>
    {excluded_html}
    """
    for section in _sections:
        if section["id"] == "preprocessing":
            section["body"] += extra
            return


# ---------------------------------------------------------------------
# Stage 2: Outlier Check
# ---------------------------------------------------------------------
def stage_2_outliers(all_sales_df: pd.DataFrame):
    print("[2/13] Outlier check...")

    iqr_df = iqr_summary_table(all_sales_df)
    print_table("2. Outlier Check — per-product IQR summary", iqr_df)

    top_ids = iqr_df.head(10)["product_id"].tolist()
    data = [all_sales_df.loc[all_sales_df["product_id"] == pid, "quantity_sold"].values for pid in top_ids]

    fig, ax = plt.subplots(figsize=(10, 5))
    ax.boxplot(data, labels=[str(pid) for pid in top_ids])
    ax.set_title("Quantity Sold Distribution — Top 10 Products by Total Volume")
    ax.set_xlabel("Product ID")
    ax.set_ylabel("Quantity Sold")

    body = f"""
    <p>IQR (Q1, Q3, whisker bounds, count of points beyond each whisker) computed
    per product across its full pooled history — see the terminal table for every
    product. The chart below is restricted to the top 10 products by total quantity
    sold; a 61-product boxplot in one chart isn't readable.</p>
    <p><strong>Nothing is currently removed as an outlier anywhere in the production
    pipeline</strong> — confirmed directly against
    <code>services/preprocessing.py::clean_sales_data()</code>, which only drops
    duplicate <code>(product_id, sale_date)</code> rows and sorts. It does not trim,
    cap, or winsorize by IQR or any other bound. That is intentional (a real spike —
    a catering order, a promo day — is a legitimate demand signal the model should
    learn from, not noise to remove) and this report does not add removal logic the
    real pipeline doesn't have; it only shows you where the outliers currently sit.</p>
    {img_tag(fig, "Boxplot of quantity sold, top 10 products by total volume")}
    """
    add_section("outliers", "2. Outlier Check", body)
    print("[2/13] Done.")


# ---------------------------------------------------------------------
# Stage 3: Chronological Train/Test Split
# ---------------------------------------------------------------------
def stage_3_split(eligible_df: pd.DataFrame, high_id: int, low_id: int):
    print("[3/13] Chronological train/test split...")

    train_df, test_df = chronological_split(eligible_df)
    split_date = test_df["sale_date"].min() if not test_df.empty else None

    rows = []
    for role, pid in [("high-volume", high_id), ("low-volume", low_id)]:
        prod_train = train_df[train_df["product_id"] == pid]
        prod_test = test_df[test_df["product_id"] == pid]
        rows.append({
            "role": role,
            "product_id": pid,
            "train_rows": len(prod_train),
            "test_rows": len(prod_test),
            "train_ends": prod_train["sale_date"].max().date() if len(prod_train) else None,
            "test_starts": prod_test["sale_date"].min().date() if len(prod_test) else None,
        })
    split_table = pd.DataFrame(rows)
    print_table("3. Chronological Train/Test Split", split_table)
    print(f"  Global 80/20 split date (start of test set, all products): {split_date}")

    fig, ax = plt.subplots(figsize=(9, 3))
    labels = []
    for i, (role, pid) in enumerate([("high-volume", high_id), ("low-volume", low_id)]):
        prod_train = train_df[train_df["product_id"] == pid]
        prod_test = test_df[test_df["product_id"] == pid]
        if len(prod_train):
            ax.plot([prod_train["sale_date"].min(), prod_train["sale_date"].max()], [i, i],
                     color="#2563eb", linewidth=10, solid_capstyle="butt",
                     label="Train" if i == 0 else None)
        if len(prod_test):
            ax.plot([prod_test["sale_date"].min(), prod_test["sale_date"].max()], [i, i],
                     color="#f59e0b", linewidth=10, solid_capstyle="butt",
                     label="Test" if i == 0 else None)
        labels.append(f"Product {pid} ({role})")
    ax.set_yticks([0, 1])
    ax.set_yticklabels(labels)
    ax.set_ylim(-0.5, 1.5)
    ax.set_title("Train (blue) vs. Test (amber) Date Ranges")
    ax.legend(loc="upper left")

    body = f"""
    <p>Split via <code>model_service.chronological_split()</code>, reused as-is: one
    80/20 index cutoff across the whole pooled, feature-engineered, eligibility-filtered
    dataset sorted by date — never a per-product cutoff, and never shuffled. The global
    test period starts <strong>{split_date}</strong>. The table shows how that single
    global cutoff lands in very different row counts for a high- vs. low-volume product,
    since low-volume products simply have fewer rows on either side of the same date.</p>
    {img_tag(fig, "Train vs test date ranges for two products")}
    """
    add_section("split", "3. Chronological Train/Test Split", body)
    print("[3/13] Done.")
    return train_df, test_df


# ---------------------------------------------------------------------
# Stage 4: Feature Engineering
# ---------------------------------------------------------------------
def stage_4_features(eligible_df: pd.DataFrame, sample_product_id: int):
    print("[4/13] Feature engineering...")

    display_cols = [
        "sale_date", "quantity_sold", "dow", "month", "is_weekend",
        "is_holiday", "is_payday", "lag_1", "lag_7", "rolling_7", "rolling_14",
    ]
    sample = (
        eligible_df[eligible_df["product_id"] == sample_product_id][display_cols]
        .sort_values("sale_date")
        .head(15)
    )
    print_table(f"4. Feature Engineering — sample rows (product {sample_product_id})", sample)

    prod_rows = eligible_df[eligible_df["product_id"] == sample_product_id].sort_values("sale_date")
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(prod_rows["sale_date"], prod_rows["quantity_sold"], color="#94a3b8",
            linewidth=1, label="Actual quantity_sold")
    ax.plot(prod_rows["sale_date"], prod_rows["rolling_7"], color="#2563eb",
            linewidth=1.5, label="rolling_7")
    ax.set_title(f"rolling_7 vs. Actual Quantity Sold — Product {sample_product_id}")
    ax.set_xlabel("Date")
    ax.legend()
    fig.autofmt_xdate()

    body = f"""
    <p>Output of <code>feature_engineering.engineer_features()</code> — the single
    shared source of truth both training and forecasting import, so this is exactly
    what the model was fed, not a re-derivation. Sample rows are for product
    {sample_product_id} only.</p>
    <p>rolling_7 is computed with <code>.transform()</code> inside a
    <code>groupby("product_id")</code>, specifically so it never crosses product
    boundaries. If that grouping were broken, this product's rolling_7 line would
    show an unexplained jump or discontinuity wherever this product's block happens
    to sit next to a very different product's data in the sorted table — it doesn't,
    which is the visual confirmation the task asked for.</p>
    {img_tag(fig, "Rolling 7-day average vs actual quantity sold")}
    """
    add_section("features", "4. Feature Engineering", body)
    print("[4/13] Done.")


# ---------------------------------------------------------------------
# NEW Section: Baseline Comparison
# ---------------------------------------------------------------------
def stage_baseline_comparison(model, test_df: pd.DataFrame):
    print("[5/13] Baseline comparison...")

    model_predictions = model.predict(test_df[FEATURE_COLUMNS])
    model_agg = evaluate_predictions(test_df["quantity_sold"].values, model_predictions)
    model_per_product = {r["product_id"]: r for r in evaluate_per_product(test_df, model_predictions)}
    model_wmape = wmape(test_df["quantity_sold"].values, model_predictions)

    naive_lag7_agg = evaluate_predictions(test_df["quantity_sold"].values, test_df["lag_7"].values)
    naive_lag7_per_product = {
        r["product_id"]: r for r in evaluate_per_product(test_df, test_df["lag_7"].values)
    }
    naive_lag7_wmape = wmape(test_df["quantity_sold"].values, test_df["lag_7"].values)

    naive_rolling7_agg = evaluate_predictions(test_df["quantity_sold"].values, test_df["rolling_7"].values)
    naive_rolling7_per_product = {
        r["product_id"]: r for r in evaluate_per_product(test_df, test_df["rolling_7"].values)
    }
    naive_rolling7_wmape = wmape(test_df["quantity_sold"].values, test_df["rolling_7"].values)

    summary_df = pd.DataFrame([
        {"source": "Model", "mae": model_agg["mae"], "rmse": model_agg["rmse"],
         "mape": model_agg["mape"], "wmape": model_wmape},
        {"source": "Naive: same day last week (lag_7)", "mae": naive_lag7_agg["mae"],
         "rmse": naive_lag7_agg["rmse"], "mape": naive_lag7_agg["mape"], "wmape": naive_lag7_wmape},
        {"source": "Naive: 7-day rolling average", "mae": naive_rolling7_agg["mae"],
         "rmse": naive_rolling7_agg["rmse"], "mape": naive_rolling7_agg["mape"], "wmape": naive_rolling7_wmape},
    ])
    print_table("5. Baseline Comparison — aggregate summary", summary_df)

    rows = []
    for pid in sorted(model_per_product.keys(), key=lambda x: int(x)):
        m_mae = model_per_product[pid]["mae"]
        l_mae = naive_lag7_per_product.get(pid, {}).get("mae")
        r_mae = naive_rolling7_per_product.get(pid, {}).get("mae")
        beats_both = bool(l_mae is not None and r_mae is not None and m_mae < l_mae and m_mae < r_mae)
        rows.append({
            "product_id": pid,
            "model_mae": m_mae,
            "naive_lag7_mae": l_mae,
            "naive_rolling7_mae": r_mae,
            "model_beats_both": beats_both,
        })
    per_product_baseline_df = pd.DataFrame(rows).sort_values(
        ["model_beats_both", "model_mae"], ascending=[True, False]
    )
    print_table("5. Baseline Comparison — per product (failures first)", per_product_baseline_df)

    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    sources = ["Model", "Naive\n(lag_7)", "Naive\n(rolling_7)"]
    mae_values = [model_agg["mae"], naive_lag7_agg["mae"], naive_rolling7_agg["mae"]]
    wmape_values = [model_wmape or 0, naive_lag7_wmape or 0, naive_rolling7_wmape or 0]
    axes[0].bar(sources, mae_values, color="#2563eb")
    axes[0].set_title("Aggregate MAE")
    axes[1].bar(sources, wmape_values, color="#f59e0b")
    axes[1].set_title("Aggregate WMAPE (%)")
    fig.suptitle("Model vs. Naive Baselines")
    fig.tight_layout()

    n_beats_both = int(per_product_baseline_df["model_beats_both"].sum())
    n_total = len(per_product_baseline_df)
    body = f"""
    <p>Compares the current model against two naive baselines that require no training at all:
    "same day last week" (<code>lag_7</code>) and the 7-day rolling average (<code>rolling_7</code>)
    — both columns already exist on <code>test_df</code> straight from
    <code>engineer_features()</code>, no extra computation needed to get the naive predictions
    themselves.</p>
    <p><strong>{n_beats_both} of {n_total}</strong> products beat BOTH naive baselines on MAE.
    Products that don't are sorted to the top of the per-product table below — a model that
    doesn't beat a free, untrained guess for a given product is a real finding worth investigating,
    not a rounding error.</p>
    {df_to_html_table(summary_df)}
    {img_tag(fig, "Model vs naive baselines, aggregate MAE and WMAPE")}
    {df_to_html_table(per_product_baseline_df)}
    """
    add_section("baseline", "5. Baseline Comparison", body)
    print("[5/13] Done.")


# ---------------------------------------------------------------------
# Stage 5 + 6: Feature Importance & Evaluation Metrics
# (share one model — trained or loaded — so they're one function)
# ---------------------------------------------------------------------
def stage_5_and_6(eligible_df: pd.DataFrame, force_train: bool):
    print("[6/13] Feature importance...")

    model, model_version, metrics, trained_now, feature_importance = _acquire_report_model(
        eligible_df, force_train
    )

    train_df, test_df = chronological_split(eligible_df)
    X_test, y_test = test_df[FEATURE_COLUMNS], test_df["quantity_sold"]

    predictions = model.predict(X_test)
    if trained_now:
        aggregate_metrics = metrics["aggregate"]
        per_product_metrics = metrics["per_product"]
    else:
        aggregate_metrics = evaluate_predictions(y_test.values, predictions)
        per_product_metrics = evaluate_per_product(test_df, predictions)

    # --- Feature Importance ---
    fi_df = pd.DataFrame([
        {"feature": col, "label": FEATURE_LABELS.get(col, col), "importance": score}
        for col, score in feature_importance.items()
    ]).sort_values("importance", ascending=False)
    print_table("5. Feature Importance", fi_df)

    fig, ax = plt.subplots(figsize=(8, 5))
    ordered = fi_df.sort_values("importance")
    ax.barh(ordered["label"], ordered["importance"], color="#2563eb")
    ax.set_title(f"XGBoost Feature Importance — {model_version}")
    ax.set_xlabel("Importance (gain-based)")

    source_note = (
        "the model just trained in this run"
        if trained_now else
        f"the latest saved model (<code>{model_version}</code>), loaded read-only from "
        "Supabase Storage — re-evaluated against a freshly pooled dataset rather than "
        "retrained. If products were added or archived since that model was trained, "
        "its internal product_id category mapping may not perfectly line up with "
        "today's pooled categories; pass <code>--train</code> to this script for a "
        "fully faithful, freshly-trained reproduction instead."
    )
    body = f"""
    <p>Feature importance from {source_note}.</p>
    <p>Labels here match <code>FEATURE_LABELS</code> in
    <code>backend/services/analyticsService.js</code> (the Analytics &gt; Model
    Insights panel) — <strong>the two lists are kept in sync by hand</strong>; there
    is no shared source between the Python and JS sides, so update both if either
    changes.</p>
    {img_tag(fig, "Feature importance bar chart")}
    """
    add_section("importance", "5. Feature Importance", body)
    print("[6/13] Done.")

    # --- Evaluation Metrics ---
    print("[7/13] Evaluation metrics...")
    print_table("6. Evaluation Metrics — aggregate", pd.DataFrame([aggregate_metrics]))

    per_product_df = pd.DataFrame(per_product_metrics).sort_values(
        "mape", ascending=False, na_position="last"
    )

    # NEW: WMAPE / sMAPE / MASE per product (reports/metrics.py). Sample
    # size is already present as "test_rows" from evaluate_per_product().
    scored_for_metrics = test_df[["product_id", "quantity_sold", "lag_7"]].copy()
    scored_for_metrics["predicted"] = predictions
    extra_by_product = {}
    for pid, grp in scored_for_metrics.groupby("product_id", observed=True):
        train_grp = train_df[train_df["product_id"] == pid]
        w = wmape(grp["quantity_sold"].values, grp["predicted"].values)
        s = smape(grp["quantity_sold"].values, grp["predicted"].values)
        m = (
            mase(grp["quantity_sold"].values, grp["predicted"].values,
                 train_grp["quantity_sold"].values, train_grp["lag_7"].values)
            if len(train_grp) > 0 else None
        )
        extra_by_product[pid] = {"wmape": w, "smape": s, "mase": m}

    per_product_df["wmape"] = per_product_df["product_id"].map(
        lambda p: extra_by_product.get(p, {}).get("wmape")
    )
    per_product_df["smape"] = per_product_df["product_id"].map(
        lambda p: extra_by_product.get(p, {}).get("smape")
    )
    per_product_df["mase"] = per_product_df["product_id"].map(
        lambda p: extra_by_product.get(p, {}).get("mase")
    )
    print_table("6. Evaluation Metrics — per product (worst to best MAPE)", per_product_df)

    # NEW: aggregate metrics grouped by volume tier (Stage 1's tiering)
    per_product_df["volume_tier"] = per_product_df["product_id"].map(
        lambda p: _VOLUME_TIERS_CACHE.get(p, "Unknown")
    )
    tier_rows = []
    for tier, grp in per_product_df.groupby("volume_tier"):
        tier_rows.append({
            "volume_tier": tier,
            "n_products": len(grp),
            "avg_mae": grp["mae"].mean(),
            "avg_rmse": grp["rmse"].mean(),
            "avg_mape": grp["mape"].mean(skipna=True),
            "avg_wmape": grp["wmape"].mean(skipna=True),
        })
    tier_order = {"High": 0, "Medium": 1, "Low": 2, "Unknown": 3}
    tier_group_df = pd.DataFrame(tier_rows).sort_values(
        "volume_tier", key=lambda s: s.map(tier_order)
    )
    print_table("6. Evaluation Metrics — grouped by volume tier", tier_group_df)

    plot_df = per_product_df.dropna(subset=["mape"])
    fig2, ax2 = plt.subplots(figsize=(10, 5))
    ax2.bar(plot_df["product_id"].astype(str), plot_df["mape"], color="#2563eb")
    ax2.axhline(10, color="crimson", linestyle="--", linewidth=1,
                label="10% — Lewis (1982) 'highly accurate' threshold")
    ax2.set_title("MAPE per Product")
    ax2.set_xlabel("Product ID")
    ax2.set_ylabel("MAPE (%)")
    ax2.legend()
    plt.setp(ax2.get_xticklabels(), rotation=90, fontsize=7)

    mape_display = f"{aggregate_metrics['mape']:.1f}%" if aggregate_metrics["mape"] is not None else "N/A"
    body2 = f"""
    <p>Aggregate: MAE={aggregate_metrics['mae']:.2f}, RMSE={aggregate_metrics['rmse']:.2f},
    MAPE={mape_display}. Full per-product breakdown (sorted worst-to-best MAPE) is in
    the terminal output — an aggregate number alone can hide a bad low-volume product
    behind a good high-volume one, which is exactly why this breakdown exists.</p>
    <p>The red line marks the 10% "highly accurate" threshold from Lewis (1982),
    referenced in the paper's Forecast Accuracy discussion — products with bars below
    the line clear it; products above it don't yet.</p>
    {img_tag(fig2, "MAPE per product, with 10% reference line")}
    <h3>Per-Product Metrics — Full Breakdown</h3>
    <p>Adds WMAPE (volume-weighted — a low-volume product's error counts proportionally less),
    sMAPE (bounded 0-200%, softer on near-zero actuals), and MASE (scaled against this product's
    own naive "same day last week" error observed during TRAINING — see
    <code>reports/metrics.py</code> for the exact formulas, in plain terms) alongside MAE/RMSE/MAPE.
    <code>test_rows</code> is each product's sample size — a metric computed on 5 test rows
    deserves a lot less confidence than one computed on 50.</p>
    {df_to_html_table(per_product_df)}
    <h3>Aggregate Metrics by Volume Tier</h3>
    <p>Same tiers as Stage 1 (High/Medium/Low average daily quantity) — grouping this way shows
    whether accuracy problems concentrate in low-volume products specifically, rather than being
    spread evenly across the whole menu.</p>
    {df_to_html_table(tier_group_df)}
    """
    add_section("metrics", "6. Evaluation Metrics", body2)
    print("[7/13] Done.")

    return test_df, predictions


# ---------------------------------------------------------------------
# NEW Section: Feature Importance — Rolling Features Removed
# ---------------------------------------------------------------------
def stage_feature_importance_ablation(eligible_df: pd.DataFrame, feature_importance: dict):
    print("[8/13] Feature importance — rolling features removed (ablation)...")

    _ablation_model, ablation_metrics, _ablation_version = train_global_model(
        eligible_df, persist=False, feature_columns=REDUCED_FEATURE_COLUMNS
    )
    ablation_importance = ablation_metrics["feature_importance"]

    rows = [
        {
            "feature": col,
            "label": FEATURE_LABELS.get(col, col),
            "original_importance": feature_importance.get(col, 0.0),
            "ablation_importance": ablation_importance.get(col, 0.0),
        }
        for col in REDUCED_FEATURE_COLUMNS
    ]
    comparison_df = pd.DataFrame(rows).sort_values("ablation_importance", ascending=False)
    print_table("7. Feature Importance — Rolling Features Removed", comparison_df)

    fig, ax = plt.subplots(figsize=(9, 5))
    y = np.arange(len(comparison_df))
    height = 0.35
    ax.barh(y - height / 2, comparison_df["original_importance"], height,
            label="Original (rolling_7/rolling_14 included)", color="#2563eb")
    ax.barh(y + height / 2, comparison_df["ablation_importance"], height,
            label="Ablation (rolling_7/rolling_14 removed)", color="#f59e0b")
    ax.set_yticks(y)
    ax.set_yticklabels(comparison_df["label"])
    ax.set_xlabel("Importance (gain-based)")
    ax.set_title("Feature Importance — With vs. Without Rolling Features")
    ax.legend()

    calendar_features_ids = ["dow", "is_weekend", "is_holiday", "is_payday", "month", "day"]
    orig_calendar_sum = sum(feature_importance.get(c, 0.0) for c in calendar_features_ids)
    ablation_calendar_sum = sum(ablation_importance.get(c, 0.0) for c in calendar_features_ids)
    if ablation_calendar_sum > orig_calendar_sum * 1.2:
        interpretation = (
            f"Calendar features' combined importance rose from {orig_calendar_sum:.3f} to "
            f"{ablation_calendar_sum:.3f} once rolling_7/rolling_14 were removed — this points "
            "to shadowing: the rolling features were partly capturing calendar-pattern signal too "
            "(a 7-day rolling average is itself influenced by which days of the week fall inside "
            "it), not that calendar features were simply irrelevant on their own."
        )
    else:
        interpretation = (
            f"Calendar features' combined importance barely moved ({orig_calendar_sum:.3f} to "
            f"{ablation_calendar_sum:.3f}) once rolling_7/rolling_14 were removed — this suggests "
            "the rolling features weren't shadowing calendar effects; the model simply relies on "
            "recent-history features more than calendar patterns, with or without them present."
        )

    body = f"""
    <p>Diagnostic-only ablation run — trains a SEPARATE model with <code>rolling_7</code> and
    <code>rolling_14</code> excluded from <code>FEATURE_COLUMNS</code>
    (<code>train_global_model(eligible_df, persist=False, feature_columns=REDUCED_FEATURE_COLUMNS)</code>).
    This model is never saved to Supabase Storage and is discarded once this section renders — it
    exists only to answer one question: are the rolling features doing real work, or are they
    crowding out calendar features that would otherwise show more importance?</p>
    {img_tag(fig, "Feature importance with vs without rolling features")}
    <p>{interpretation}</p>
    {df_to_html_table(comparison_df)}
    """
    add_section("importance_ablation", "7. Feature Importance &mdash; Rolling Features Removed", body)
    print("[8/13] Done.")


# ---------------------------------------------------------------------
# NEW Section: Train vs. Test Metrics
# ---------------------------------------------------------------------
def stage_train_vs_test_metrics(model, train_df: pd.DataFrame, test_df: pd.DataFrame):
    print("[9/13] Train vs. test metrics...")

    train_predictions = model.predict(train_df[FEATURE_COLUMNS])
    test_predictions = model.predict(test_df[FEATURE_COLUMNS])

    train_metrics = evaluate_predictions(train_df["quantity_sold"].values, train_predictions)
    test_metrics = evaluate_predictions(test_df["quantity_sold"].values, test_predictions)

    comparison_df = pd.DataFrame([
        {"metric": "MAE", "train": train_metrics["mae"], "test": test_metrics["mae"]},
        {"metric": "RMSE", "train": train_metrics["rmse"], "test": test_metrics["rmse"]},
        {"metric": "MAPE", "train": train_metrics["mape"], "test": test_metrics["mape"]},
    ])
    print_table("9. Train vs. Test Metrics", comparison_df)

    train_mae, test_mae = train_metrics["mae"], test_metrics["mae"]
    gap_ratio = (test_mae / train_mae) if train_mae else None

    if gap_ratio is not None and gap_ratio >= 1.5:
        verdict = (
            f"Test MAE ({test_mae:.2f}) is {gap_ratio:.1f}&times; train MAE ({train_mae:.2f}) — "
            "a gap this size points to likely <strong>OVERFITTING</strong>: the model has learned "
            "the training data's specific noise rather than a pattern that generalizes to unseen "
            "dates."
        )
    elif train_mae > 2 and test_mae > 2:
        verdict = (
            f"Both train MAE ({train_mae:.2f}) and test MAE ({test_mae:.2f}) are high with a "
            "similar gap — this points to likely <strong>UNDERFITTING</strong> or a feature/data "
            "limitation rather than overfitting: the model isn't even fitting its own training "
            "data well, so more regularization wouldn't help."
        )
    else:
        verdict = (
            f"Train MAE ({train_mae:.2f}) and test MAE ({test_mae:.2f}) are reasonably close — "
            "no strong overfitting signal here based on this gap alone."
        )

    body = f"""
    <p>Same model, evaluated on its own training data vs. the held-out test set — the gap
    between the two is the standard overfitting/underfitting diagnostic. Uses the same
    <code>train_df</code>/<code>test_df</code> from <code>chronological_split()</code> used
    throughout this report.</p>
    {df_to_html_table(comparison_df)}
    <p>{verdict}</p>
    """
    add_section("train_test_metrics", "9. Train vs. Test Metrics", body)
    print("[9/13] Done.")


# ---------------------------------------------------------------------
# NEW Section: Forecast Horizon Breakdown
# ---------------------------------------------------------------------
def _actual_series_for_product(eligible_df: pd.DataFrame, product_id: int) -> pd.DataFrame:
    prod = eligible_df[eligible_df["product_id"] == product_id].sort_values("sale_date")
    return prod[["sale_date", "quantity_sold"]].reset_index(drop=True)


def _pick_horizon_start_dates(actual_series: pd.DataFrame, test_start, test_end, n: int = 4):
    window = actual_series[
        (actual_series["sale_date"] >= test_start) & (actual_series["sale_date"] <= test_end)
    ]
    if window.empty:
        return []
    count = min(n, len(window))
    idx = sorted(set(np.linspace(0, len(window) - 1, num=count).astype(int).tolist()))
    return [window.iloc[i]["sale_date"] for i in idx]


def stage_forecast_horizon(eligible_df: pd.DataFrame, model, known_categories: list,
                            high_id: int, low_id: int, test_start, test_end):
    print("[10/13] Forecast horizon breakdown (recursive simulation)...")

    records = []
    skipped_starts = []
    for pid, role in [(high_id, "high-volume"), (low_id, "low-volume")]:
        actual_series = _actual_series_for_product(eligible_df, pid)
        start_dates = _pick_horizon_start_dates(actual_series, test_start, test_end)

        for start_date in start_dates:
            history = actual_series[actual_series["sale_date"] < start_date]
            recent_quantities = history.tail(60)["quantity_sold"].tolist()
            if len(recent_quantities) < 14:
                skipped_starts.append({
                    "product_id": pid, "start_date": start_date.date(),
                    "reason": f"only {len(recent_quantities)} prior days available (need >= 14)",
                })
                continue

            recent = list(recent_quantities)
            for day_offset in range(7):
                target_date = (start_date + pd.Timedelta(days=day_offset)).date()

                feature_row = build_forecast_feature_row(pid, target_date, recent)
                X = pd.DataFrame([feature_row])
                X = apply_categorical_dtype(X, known_categories=known_categories)
                X = X[FEATURE_COLUMNS]
                predicted = max(0.0, float(model.predict(X)[0]))

                actual_row = actual_series[actual_series["sale_date"].dt.date == target_date]
                actual_value = float(actual_row["quantity_sold"].iloc[0]) if not actual_row.empty else None

                records.append({
                    "product_id": pid, "role": role, "start_date": start_date.date(),
                    "horizon_day": day_offset + 1, "forecast_date": target_date,
                    "actual": actual_value, "predicted": round(predicted, 2),
                })
                # feed this day's prediction back in as the next day's lag_1 — the
                # recursive step, mirroring generate_forecast() exactly.
                recent.append(predicted)

    records_df = pd.DataFrame(records)
    if records_df.empty:
        print("  No start dates had >= 14 days of prior history — nothing to simulate.")
        body = (
            "<p>No start dates within the test period had at least 14 days of prior actual "
            "history to seed a recursive forecast from for either representative product — this "
            "section could not be populated for this dataset.</p>"
        )
        add_section("horizon", "10. Forecast Horizon Breakdown", body)
        print("[10/13] Done.")
        return

    scored = records_df.dropna(subset=["actual"]).copy()
    scored["abs_error"] = (scored["actual"] - scored["predicted"]).abs()
    scored["pct_error"] = np.where(
        scored["actual"] != 0, scored["abs_error"] / scored["actual"] * 100, np.nan
    )

    horizon_summary = scored.groupby("horizon_day").agg(
        n_comparisons=("abs_error", "size"),
        mae=("abs_error", "mean"),
        mape=("pct_error", "mean"),
    ).reset_index()
    print_table("10. Forecast Horizon Breakdown — by horizon day", horizon_summary)
    if skipped_starts:
        print_table("10. Forecast Horizon Breakdown — skipped start dates", pd.DataFrame(skipped_starts))

    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    axes[0].bar(horizon_summary["horizon_day"], horizon_summary["mae"], color="#2563eb")
    axes[0].set_title("MAE by Horizon Day")
    axes[0].set_xlabel("Horizon Day (1 = first forecasted day)")
    axes[0].set_ylabel("MAE")
    axes[1].bar(horizon_summary["horizon_day"], horizon_summary["mape"], color="#f59e0b")
    axes[1].set_title("MAPE by Horizon Day (actual != 0 rows only)")
    axes[1].set_xlabel("Horizon Day")
    axes[1].set_ylabel("MAPE (%)")
    fig.tight_layout()

    n_combos = records_df[["product_id", "start_date"]].drop_duplicates().shape[0]
    skipped_note = (
        f" {len(skipped_starts)} candidate start date(s) were skipped for not having 14 days of "
        "prior history."
        if skipped_starts else ""
    )
    body = f"""
    <p><strong>This section is recursive</strong> — day N's prediction depends on day N-1's
    prediction, exactly as production forecasting does
    (<code>forecast_service.generate_forecast()</code>). Sections 5/6/9 above are single-step
    backtests (every row uses REAL actual lag/rolling values, never a prior prediction) and are
    <strong>NOT directly comparable</strong> to the numbers here.</p>
    <p>Simulated for both representative products (product {high_id}, high-volume; product
    {low_id}, low-volume) across {n_combos} (product, start date) combination(s) spread evenly
    across the test period.{skipped_note} Each day's prediction is fed back in as the next day's
    <code>lag_1</code> via <code>build_forecast_feature_row()</code> — the exact function
    <code>generate_forecast()</code> calls, not a reimplementation. Known actual values are used
    here only to SCORE the simulation after the fact — they are never fed into the simulation
    itself.</p>
    <p>Simplification, stated explicitly: this simulation predicts every calendar day in the
    7-day horizon and does not apply production's weekend/closed-day short-circuit
    (<code>forecast_service._is_operating_day()</code>) — the goal here is isolating pure model
    recursive-error growth by horizon day, not reproducing the business-day rule on top of it.</p>
    {img_tag(fig, "MAE and MAPE by forecast horizon day")}
    {df_to_html_table(horizon_summary)}
    """
    add_section("horizon", "10. Forecast Horizon Breakdown", body)
    print("[10/13] Done.")


# ---------------------------------------------------------------------
# Stage 7: Predictions
# ---------------------------------------------------------------------
def stage_7_predictions(test_df: pd.DataFrame, predictions, high_id: int, low_id: int):
    print("[11/13] Predictions...")

    scored = test_df[["product_id", "sale_date", "quantity_sold"]].copy()
    scored["predicted"] = predictions

    fig, axes = plt.subplots(2, 1, figsize=(10, 7))
    for ax, pid, role in [(axes[0], high_id, "high-volume"), (axes[1], low_id, "low-volume")]:
        prod = scored[scored["product_id"] == pid].sort_values("sale_date")
        ax.plot(prod["sale_date"], prod["quantity_sold"], color="#16a34a", marker="o",
                markersize=3, linewidth=1, label="Actual")
        ax.plot(prod["sale_date"], prod["predicted"], color="#dc2626", marker="x",
                markersize=4, linewidth=1, label="Predicted")
        ax.set_title(f"Product {pid} ({role}) — Test Period")
        ax.set_ylabel("Quantity")
        ax.legend()
    fig.tight_layout()

    # NEW: exact last-15-rows tables for both representative products,
    # reusing the `scored` frame already built above — rendering only.
    last_rows_blocks = []
    for pid, role in [(high_id, "high-volume"), (low_id, "low-volume")]:
        prod_rows = scored[scored["product_id"] == pid].sort_values("sale_date").tail(15).copy()
        prod_rows["sale_date"] = prod_rows["sale_date"].dt.date
        prod_rows["error"] = (prod_rows["quantity_sold"] - prod_rows["predicted"]).round(2)
        last_rows_blocks.append(
            f"<h4>Product {pid} ({role}) — Last 15 Test Rows</h4>"
            + df_to_html_table(prod_rows[["sale_date", "quantity_sold", "predicted", "error"]])
        )

    body = f"""
    <p>Actual vs. predicted quantity over the held-out test period, for the same
    high- and low-volume products used in the split stage.</p>
    <p>Note on what this does and doesn't show: every test row here uses
    <code>lag_1</code>/<code>lag_7</code>/<code>rolling_7</code>/<code>rolling_14</code>
    computed from real, actual historical sales (that's what
    <code>engineer_features()</code> produced before the split ever happened) — this is
    <strong>one-step evaluation against real held-out data</strong>, not a simulated
    multi-day recursive forecast. A live forecast run (see
    <code>forecast_service.generate_forecast()</code>) instead feeds each day's own
    prediction back in as the next day's <code>lag_1</code> when the real value isn't
    known yet, which compounds error the further out it recurses — that's the reason
    forecasts are capped at 7 days in production, and it's a different (harder)
    scenario than what this chart evaluates. See Section 10 for that recursive scenario.</p>
    {img_tag(fig, "Actual vs predicted quantity, test period, two products")}
    {''.join(last_rows_blocks)}
    """
    add_section("predictions", "7. Predictions", body)
    print("[11/13] Done.")


# ---------------------------------------------------------------------
# NEW Section: Two-Fold Time-Stability Check
# ---------------------------------------------------------------------
def expanding_window_split(df: pd.DataFrame, train_end_fraction: float, test_end_fraction: float):
    """
    Report-specific evaluation-window helper — deliberately NOT added to
    services/model_service.chronological_split(), since production only
    ever needs the one 80/20 cutoff.

    df must already be sorted by sale_date (same convention
    chronological_split() relies on — this function does its own sort
    too, so it's safe to call with an unsorted frame). Returns
    (train_df, test_df) where train_df = df[:train_end_idx] and
    test_df = df[train_end_idx:test_end_idx].
    """
    df = df.sort_values("sale_date").reset_index(drop=True)
    train_end_idx = int(len(df) * train_end_fraction)
    test_end_idx = int(len(df) * test_end_fraction)
    return df.iloc[:train_end_idx], df.iloc[train_end_idx:test_end_idx]


def stage_two_fold_stability(eligible_df: pd.DataFrame, train_df: pd.DataFrame, test_df: pd.DataFrame):
    print("[12/13] Two-fold time-stability check...")

    fold1_train, fold1_test = expanding_window_split(eligible_df, 0.60, 0.80)
    fold2_train, fold2_test = train_df, test_df  # today's existing default 80/20 split, reused

    rows = []
    for label, f_train, f_test in [
        ("Fold 1 (train 0-60%, test 60-80%)", fold1_train, fold1_test),
        ("Fold 2 (train 0-80%, test 80-100% — today's default split)", fold2_train, fold2_test),
    ]:
        if len(f_train) < 200 or f_test.empty:
            rows.append({
                "fold": label, "train_rows": len(f_train), "test_rows": len(f_test),
                "mae": None, "rmse": None, "mape": None, "wmape": None,
                "note": "skipped — fewer than 200 pooled training rows, or an empty test window",
            })
            continue

        # persist=False — a fold model is diagnostic-only and must never
        # be uploaded to Supabase Storage. train_global_model() still
        # does its own internal 80/20 split of f_train to actually FIT
        # the model (the same methodology production always uses); we
        # discard its internally-computed metrics and evaluate the
        # returned model ourselves against THIS fold's own designated
        # test window (f_test) instead, so both folds are compared on
        # equal, externally-defined test windows.
        fold_model, _fold_internal_metrics, _fold_version = train_global_model(f_train, persist=False)
        fold_predictions = fold_model.predict(f_test[FEATURE_COLUMNS])
        agg = evaluate_predictions(f_test["quantity_sold"].values, fold_predictions)
        fold_wmape = wmape(f_test["quantity_sold"].values, fold_predictions)
        rows.append({
            "fold": label, "train_rows": len(f_train), "test_rows": len(f_test),
            "mae": agg["mae"], "rmse": agg["rmse"], "mape": agg["mape"], "wmape": fold_wmape,
            "note": "",
        })

    fold_df = pd.DataFrame(rows)
    print_table("12. Two-Fold Time-Stability Check", fold_df)

    body = f"""
    <p><strong>Directional check only, not a variance estimate</strong> — two folds is a
    directional check only, not a variance estimate; approximately 12 months of total history
    doesn't support more folds without unacceptably shrinking each fold's training window.</p>
    <p>Fold 1 trains on the first 60% of pooled rows and tests on the next 20% (60-80%). Fold 2 is
    today's existing default split (train 0-80%, test 80-100%) — both test windows are 20% of
    pooled rows by construction, which matters for comparing them fairly. <code>train_rows</code>
    is shown directly next to each fold's metrics on purpose — it's what lets you tell "this fold
    genuinely performed worse" apart from "this fold just had less training data to work with."
    Both fold models are trained with <code>persist=False</code> and are never uploaded to
    Supabase Storage.</p>
    {df_to_html_table(fold_df)}
    """
    add_section("stability", "12. Two-Fold Time-Stability Check", body)
    print("[12/13] Done.")


# ---------------------------------------------------------------------
# NEW Section: Production Reality Check
# ---------------------------------------------------------------------
def stage_production_reality_check(model, model_version: str,
                                    train_df: pd.DataFrame, test_df: pd.DataFrame):
    print("[13/13] Production reality check...")

    # --- (a) Stale-data correlation ---
    forecast_runs_df = get_forecast_runs_history()
    if forecast_runs_df.empty:
        print("  No forecast_runs history found.")
        stale_html = "<p>No <code>forecast_runs</code> rows found — no forecasts have been generated yet.</p>"
    else:
        print_table("13a. Production Reality Check — forecast_runs history", forecast_runs_df.head(20))
        stale_html = df_to_html_table(forecast_runs_df)

    model_metrics_history_df = get_model_metrics_history()
    if model_metrics_history_df.empty:
        print("  No model_metrics history found.")
        metrics_history_html = "<p>No <code>model_metrics</code> rows found — no training run has been logged yet.</p>"
    else:
        display_history = model_metrics_history_df.drop(columns=["feature_importance"], errors="ignore")
        print_table("13a. Production Reality Check — model_metrics history", display_history)
        metrics_history_html = df_to_html_table(display_history)

    # --- (b) Drift indicators ---
    drift_rows = [
        {
            "feature": col,
            "train_mean": train_df[col].mean(),
            "train_std": train_df[col].std(),
            "test_mean": test_df[col].mean(),
            "test_std": test_df[col].std(),
        }
        for col in FEATURE_COLUMNS if col != "product_id"
    ]
    drift_df = pd.DataFrame(drift_rows)
    print_table("13b. Production Reality Check — train vs test drift", drift_df)

    pooled_sorted = pd.concat([train_df, test_df]).sort_values("sale_date")
    daily_rolling7 = pooled_sorted.groupby("sale_date")["rolling_7"].mean().reset_index()
    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(daily_rolling7["sale_date"], daily_rolling7["rolling_7"], color="#2563eb", linewidth=1)
    ax.set_title("rolling_7 Mean Over Time — Full Pooled Dataset")
    ax.set_xlabel("Date")
    ax.set_ylabel("Mean rolling_7 across products")
    fig.autofmt_xdate()

    # --- (c) Previous-model comparison ---
    previous_model, previous_version = load_previous_model()
    if previous_model is None:
        print("  No previous model to compare against (only one model has ever been trained).")
        previous_html = "<p>Only one model has ever been trained — there is no previous version to compare against.</p>"
        warning_html = ""
    else:
        current_predictions = model.predict(test_df[FEATURE_COLUMNS])
        current_agg = evaluate_predictions(test_df["quantity_sold"].values, current_predictions)
        current_wmape = wmape(test_df["quantity_sold"].values, current_predictions)

        previous_predictions = previous_model.predict(test_df[FEATURE_COLUMNS])
        previous_agg = evaluate_predictions(test_df["quantity_sold"].values, previous_predictions)
        previous_wmape = wmape(test_df["quantity_sold"].values, previous_predictions)

        compare_df = pd.DataFrame([
            {"model": f"Current ({model_version})", "mae": current_agg["mae"],
             "rmse": current_agg["rmse"], "mape": current_agg["mape"], "wmape": current_wmape},
            {"model": f"Previous ({previous_version})", "mae": previous_agg["mae"],
             "rmse": previous_agg["rmse"], "mape": previous_agg["mape"], "wmape": previous_wmape},
        ])
        print_table("13c. Production Reality Check — current vs previous model", compare_df)
        previous_html = df_to_html_table(compare_df)

        is_worse = (
            current_agg["mae"] > previous_agg["mae"]
            or current_agg["rmse"] > previous_agg["rmse"]
            or (
                current_agg["mape"] is not None and previous_agg["mape"] is not None
                and current_agg["mape"] > previous_agg["mape"]
            )
        )
        warning_html = (
            '<p style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; '
            'padding:12px 16px; border-radius:8px; font-weight:600;">'
            "&#9888; New model may be worse than the previous version — review before "
            "treating this as the active model.</p>"
        ) if is_worse else ""

    body = f"""
    <h3>a) Stale-Data Correlation</h3>
    <p>Recent <code>forecast_runs</code> rows (<code>get_forecast_runs_history()</code>) and
    <code>model_metrics</code> rows (<code>get_model_metrics_history()</code>) — a correlation
    SURFACE only, not a new accuracy computation. Matching forecast staleness against realized
    accuracy would require joining against sales data recorded AFTER each forecast ran, which is
    outside this report's scope; these tables only show what staleness looked like and which
    model version was active at each point in time.</p>
    {stale_html}
    {metrics_history_html}

    <h3>b) Drift Indicators</h3>
    <p>Simple mean/std comparison of train vs. test for every feature — <strong>this is a simple
    mean/std comparison, not a formal distribution-shift test (e.g. KS-test or population
    stability index)</strong> — sufficient for a local diagnostic tool, not a substitute for real
    drift monitoring in production.</p>
    {df_to_html_table(drift_df)}
    {img_tag(fig, "Mean rolling_7 over time, full pooled dataset")}

    <h3>c) Previous-Model Comparison</h3>
    {warning_html}
    {previous_html}
    """
    add_section("production_reality", "13. Production Reality Check", body)
    print("[13/13] Done.")


# ---------------------------------------------------------------------
# HTML assembly (single template render, once, at the end)
# ---------------------------------------------------------------------
def render_html():
    nav_items = "\n".join(
        f'      <li><a href="#{s["id"]}">{s["title"]}</a></li>' for s in _sections
    )
    body_sections = "\n".join(
        f"""
    <section id="{s['id']}">
      <h2>{s['title']}</h2>
      {s['body']}
      <p class="back-to-top"><a href="#top">&uarr; back to top</a></p>
    </section>""" for s in _sections
    )

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ChefDuo Training Pipeline Report</title>
<style>
  :root {{
    --bg: #f8fafc;
    --panel: #ffffff;
    --text: #0f172a;
    --muted: #475569;
    --border: #e2e8f0;
    --accent: #2563eb;
    --code-bg: #eef2ff;
  }}
  * {{ box-sizing: border-box; }}
  html {{ scroll-behavior: smooth; }}
  body {{
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    display: flex;
    align-items: flex-start;
    min-height: 100vh;
  }}
  nav {{
    position: sticky;
    top: 0;
    width: 200px;
    min-width: 200px;
    max-height: 100vh;
    overflow-y: auto;
    background: var(--panel);
    border-right: 1px solid var(--border);
    padding: 24px 12px;
  }}
  nav h1 {{
    font-size: 12px;
    margin: 0 0 16px 8px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .06em;
  }}
  nav ul {{ list-style: none; margin: 0; padding: 0; }}
  nav li a {{
    display: block;
    padding: 8px;
    border-radius: 6px;
    color: var(--text);
    text-decoration: none;
    font-size: 13px;
    line-height: 1.3;
  }}
  nav li a:hover {{ background: var(--bg); }}
  main {{
    flex: 1;
    min-width: 0;
    padding: 32px 24px 80px;
    max-width: 880px;
  }}
  section {{
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 24px 28px;
    margin-bottom: 24px;
    scroll-margin-top: 16px;
  }}
  h2 {{ margin-top: 0; }}
  h3 {{ margin: 20px 0 8px; font-size: 16px; }}
  h4 {{ margin: 14px 0 6px; font-size: 14px; color: var(--muted); }}
  p {{ line-height: 1.6; }}
  code {{
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 0.9em;
  }}
  img {{
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 16px 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
  }}
  table.data-table {{
    border-collapse: collapse;
    width: 100%;
    margin: 10px 0 18px;
    font-size: 12.5px;
    overflow-x: auto;
    display: block;
  }}
  table.data-table th, table.data-table td {{
    border: 1px solid var(--border);
    padding: 5px 9px;
    text-align: left;
    white-space: nowrap;
  }}
  table.data-table th {{ background: var(--bg); position: sticky; top: 0; }}
  table.data-table tr:nth-child(even) {{ background: #fafbfc; }}
  .back-to-top {{ margin: 8px 0 0; }}
  .back-to-top a {{ color: var(--accent); text-decoration: none; font-size: 13px; }}
  header.report-header {{ margin-bottom: 8px; }}
  header.report-header h1 {{ margin: 0 0 4px; font-size: 22px; }}
  header.report-header p {{ margin: 0; color: var(--muted); font-size: 14px; }}
  @media (max-width: 700px) {{
    body {{ flex-direction: column; }}
    nav {{ position: static; width: 100%; max-height: none; border-right: none; border-bottom: 1px solid var(--border); }}
    main {{ padding: 20px 16px 60px; max-width: 100%; }}
  }}
</style>
</head>
<body id="top">
  <nav>
    <h1>Pipeline Stages</h1>
    <ul>
{nav_items}
    </ul>
  </nav>
  <main>
    <header class="report-header">
      <h1>ChefDuo Training Pipeline — Diagnostic Report</h1>
      <p>Generated {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} &middot; local diagnostic only, not part of the deployed ml-service</p>
    </header>
{body_sections}
  </main>
</body>
</html>
"""
    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\nHTML report written to: {os.path.abspath(REPORT_PATH)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--train", action="store_true",
        help="Actually train a new global model for this report (uploads a new "
             "model_v... file to the ml-models Supabase Storage bucket). Without "
             "this flag, the script loads the latest existing model read-only.",
    )
    args = parser.parse_args()

    print("=" * 78)
    print("ChefDuo ML Training Pipeline — Diagnostic Report")
    print("=" * 78)

    all_sales_df, _skipped = stage_1_preprocessing()
    stage_2_outliers(all_sales_df)

    features_df = engineer_features(all_sales_df).dropna(subset=FEATURE_COLUMNS)
    eligible_df, excluded = filter_training_eligible(features_df, MIN_TRAINING_OBSERVATIONS)

    if eligible_df.empty:
        print("No product had enough usable post-warmup observations "
              f"(MIN_TRAINING_OBSERVATIONS={MIN_TRAINING_OBSERVATIONS}) — cannot report "
              "on split/features/importance/metrics/predictions.")
        sys.exit(1)
    if excluded:
        print(f"  ({len(excluded)} product(s) excluded from training eligibility — see model_service.filter_training_eligible)")
    extend_preprocessing_with_excluded(excluded)

    high_id, low_id = pick_representative_products(eligible_df)
    print(f"  Representative products for this report: high-volume={high_id}, low-volume={low_id}")

    train_df, test_df = stage_3_split(eligible_df, high_id, low_id)
    stage_4_features(eligible_df, high_id)

    model, model_version, _metrics, _trained_now, feature_importance = _acquire_report_model(
        eligible_df, args.train
    )
    known_categories = eligible_df["product_id"].cat.categories.tolist()

    stage_baseline_comparison(model, test_df)
    test_df_s6, predictions_s6 = stage_5_and_6(eligible_df, force_train=args.train)
    stage_feature_importance_ablation(eligible_df, feature_importance)
    stage_train_vs_test_metrics(model, train_df, test_df)
    stage_forecast_horizon(
        eligible_df, model, known_categories, high_id, low_id,
        test_df["sale_date"].min(), test_df["sale_date"].max(),
    )
    stage_7_predictions(test_df_s6, predictions_s6, high_id, low_id)
    stage_two_fold_stability(eligible_df, train_df, test_df)
    stage_production_reality_check(model, model_version, train_df, test_df)

    # Enforce the documented final section order regardless of the
    # execution order above (which is chosen for a sensible terminal
    # narrative, not for HTML layout) — see FINAL_SECTION_ORDER.
    _sections.sort(key=lambda s: FINAL_SECTION_ORDER.index(s["id"]))

    render_html()


if __name__ == "__main__":
    main()
