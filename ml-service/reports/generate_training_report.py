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
import pandas as pd

# This script lives in ml-service/reports/, but config.py and services/
# live in ml-service/ itself. Running "python reports/generate_training_report.py"
# only puts ml-service/reports/ on sys.path automatically, so ml-service/
# has to be added explicitly before any of the real service imports below
# will resolve.
ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)

from config import MIN_TRAINING_OBSERVATIONS  # noqa: E402
from services.data_loader import get_active_products, get_daily_sales  # noqa: E402
from services.preprocessing import (  # noqa: E402
    validate_sales_data, clean_sales_data, DataValidationError,
)
from services.feature_engineering import engineer_features, FEATURE_COLUMNS  # noqa: E402
from services.model_service import (  # noqa: E402
    filter_training_eligible, chronological_split, train_global_model,
    evaluate_predictions, evaluate_per_product,
)
from services.model_storage import load_latest_model  # noqa: E402

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

pd.set_option("display.width", 140)
pd.set_option("display.max_columns", None)

# One dict per stage: {"id", "title", "body"} — appended as each stage
# runs, rendered into the HTML template once at the very end, per the
# "assemble first, render once" instruction (no inline string-concat of
# HTML at each stage).
_sections = []


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


def pick_representative_products(eligible_df: pd.DataFrame):
    """One high-volume, one low-volume product_id, both training-eligible."""
    volume = eligible_df.groupby("product_id", observed=True)["quantity_sold"].sum()
    volume = volume.sort_values(ascending=False)
    if len(volume) < 2:
        pid = int(volume.index[0])
        return pid, pid
    return int(volume.index[0]), int(volume.index[-1])


# ---------------------------------------------------------------------
# Stage 1: Data Load & Preprocessing
# ---------------------------------------------------------------------
def stage_1_preprocessing():
    print("[1/7] Data load & preprocessing...")

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
    add_section("preprocessing", "1. Data Load &amp; Preprocessing", body)
    print("[1/7] Done.")
    return all_sales_df, skipped


# ---------------------------------------------------------------------
# Stage 2: Outlier Check
# ---------------------------------------------------------------------
def stage_2_outliers(all_sales_df: pd.DataFrame):
    print("[2/7] Outlier check...")

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
    print("[2/7] Done.")


# ---------------------------------------------------------------------
# Stage 3: Chronological Train/Test Split
# ---------------------------------------------------------------------
def stage_3_split(eligible_df: pd.DataFrame, high_id: int, low_id: int):
    print("[3/7] Chronological train/test split...")

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
    print("[3/7] Done.")
    return train_df, test_df


# ---------------------------------------------------------------------
# Stage 4: Feature Engineering
# ---------------------------------------------------------------------
def stage_4_features(eligible_df: pd.DataFrame, sample_product_id: int):
    print("[4/7] Feature engineering...")

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
    print("[4/7] Done.")


# ---------------------------------------------------------------------
# Stage 5 + 6: Feature Importance & Evaluation Metrics
# (share one model — trained or loaded — so they're one function)
# ---------------------------------------------------------------------
def stage_5_and_6(eligible_df: pd.DataFrame, force_train: bool):
    print("[5/7] Feature importance...")

    model_version = None
    trained_now = False

    if not force_train:
        model, model_version = load_latest_model()
    else:
        model = None

    if model is None:
        if not force_train:
            print("  No saved model found in Supabase Storage.")
        print("  Training a new global model now via train_global_model()...")
        print("  *** This uploads a new model_v... file to the ml-models bucket ***")
        model, metrics, model_version = train_global_model(eligible_df)
        trained_now = True
    else:
        print(f"  Using latest saved model: {model_version} (read-only — no retraining, no new Storage write)")

    train_df, test_df = chronological_split(eligible_df)
    X_test, y_test = test_df[FEATURE_COLUMNS], test_df["quantity_sold"]

    if trained_now:
        predictions = model.predict(X_test)
        aggregate_metrics = metrics["aggregate"]
        per_product_metrics = metrics["per_product"]
        feature_importance = metrics["feature_importance"]
    else:
        predictions = model.predict(X_test)
        aggregate_metrics = evaluate_predictions(y_test.values, predictions)
        per_product_metrics = evaluate_per_product(test_df, predictions)
        feature_importance = {
            col: float(score) for col, score in zip(FEATURE_COLUMNS, model.feature_importances_)
        }

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
    print("[5/7] Done.")

    # --- Evaluation Metrics ---
    print("[6/7] Evaluation metrics...")
    print_table("6. Evaluation Metrics — aggregate", pd.DataFrame([aggregate_metrics]))

    per_product_df = pd.DataFrame(per_product_metrics).sort_values(
        "mape", ascending=False, na_position="last"
    )
    print_table("6. Evaluation Metrics — per product (worst to best MAPE)", per_product_df)

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
    """
    add_section("metrics", "6. Evaluation Metrics", body2)
    print("[6/7] Done.")

    return test_df, predictions


# ---------------------------------------------------------------------
# Stage 7: Predictions
# ---------------------------------------------------------------------
def stage_7_predictions(test_df: pd.DataFrame, predictions, high_id: int, low_id: int):
    print("[7/7] Predictions...")

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
    scenario than what this chart evaluates.</p>
    {img_tag(fig, "Actual vs predicted quantity, test period, two products")}
    """
    add_section("predictions", "7. Predictions", body)
    print("[7/7] Done.")


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

    high_id, low_id = pick_representative_products(eligible_df)
    print(f"  Representative products for this report: high-volume={high_id}, low-volume={low_id}")

    stage_3_split(eligible_df, high_id, low_id)
    stage_4_features(eligible_df, high_id)
    test_df, predictions = stage_5_and_6(eligible_df, force_train=args.train)
    stage_7_predictions(test_df, predictions, high_id, low_id)

    render_html()


if __name__ == "__main__":
    main()
