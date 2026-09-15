"""
Stage-by-stage terminal visibility for the training pipeline.

Why not matplotlib: this runs as a headless Flask service on Render,
with no display attached — a plt.show() call would either do nothing
or error out. What actually helps here is the terminal/log equivalent:
shape, dtypes, and a few sample rows printed at each stage, which is
readable in Render's log viewer exactly where you'd be looking when
something goes wrong. If you want an actual chart (e.g. predicted vs.
actual over time), that belongs in a local Jupyter notebook you run
against exported data, not in this service — different tool for a
different job.

Controlled by ML_DEBUG=true in .env — leave it off in normal operation
so production logs aren't flooded with DataFrame dumps on every run.
"""
import os
import pandas as pd

ML_DEBUG = os.environ.get("ML_DEBUG", "false").lower() == "true"


def log_stage(stage_name: str, df: pd.DataFrame, extra: dict = None):
    """
    Prints a compact summary of a DataFrame at a named pipeline stage.
    No-op unless ML_DEBUG=true, so it's safe to leave these calls in
    the code permanently rather than adding/removing print statements
    by hand every time you need to debug something.
    """
    if not ML_DEBUG:
        return

    print(f"\n{'=' * 60}")
    print(f"STAGE: {stage_name}")
    print(f"{'=' * 60}")
    print(f"shape: {df.shape}")
    if not df.empty:
        print(f"columns: {list(df.columns)}")
        print(df.head(5).to_string())
        if "product_id" in df.columns:
            print(f"unique products: {df['product_id'].nunique()}")
        if "sale_date" in df.columns:
            print(f"date range: {df['sale_date'].min()} to {df['sale_date'].max()}")
    if extra:
        for key, value in extra.items():
            print(f"{key}: {value}")
    print(f"{'=' * 60}\n")


def log_metrics(stage_name: str, metrics: dict):
    """Prints evaluation metrics in a readable block."""
    if not ML_DEBUG:
        return

    print(f"\n{'=' * 60}")
    print(f"METRICS: {stage_name}")
    print(f"{'=' * 60}")
    if "aggregate" in metrics:
        print("Aggregate:", metrics["aggregate"])
        print("\nPer-product (sorted worst-to-best MAPE):")
        sorted_products = sorted(
            metrics["per_product"], key=lambda p: p["mape"] or 0, reverse=True
        )
        for p in sorted_products:
            print(f"  product_id={p['product_id']:>4}  "
                  f"mape={p['mape']:.1f}%  mae={p['mae']:.2f}  "
                  f"rmse={p['rmse']:.2f}  (n={p['test_rows']})")
    else:
        print(metrics)
    print(f"{'=' * 60}\n")
