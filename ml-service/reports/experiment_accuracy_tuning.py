"""
Diagnostic-only accuracy-improvement experiment script.

NOT called by Flask, NOT deployed, NOT imported by app.py or anything
under services/ — same category as generate_training_report.py, run by
hand:

    cd ml-service
    pip install -r requirements-dev.txt
    python reports/experiment_accuracy_tuning.py

Every model this script trains uses persist=False semantics (nothing is
ever written to Supabase Storage) and this script never calls
save_model_to_storage or model_storage.new_model_version's persisted
path — it only ever builds xgb.XGBRegressor objects directly in memory.
Nothing here can become the model /forecast loads.

METHODOLOGY (see the task this was written for — repeated here so the
constraint is visible in the code, not just the prompt that asked for
it): the true held-out test set (chronological_split()'s test portion)
is evaluated AT MOST ONCE, for the single final chosen configuration, at
the very end of main(). Every experiment before that trains on fit_df
and is scored on val_df — a second chronological split carved out of
train_df, using chronological_split() again (not new splitting logic).
Comparing candidate after candidate against the real test set and
reporting whichever wins would be test-set leakage via model selection:
it produces a great-looking number and an untrustworthy model. val_df
is where that comparison happens instead.

Every experiment logs ALL candidates tried, not just the winner — see
the *_log.csv files written to reports/output/ and the printed tables.
"""
import argparse
import json
import os
import random
import sys
import time

import numpy as np
import pandas as pd
import xgboost as xgb

ML_SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ML_SERVICE_DIR not in sys.path:
    sys.path.insert(0, ML_SERVICE_DIR)
REPORTS_DIR = os.path.dirname(os.path.abspath(__file__))
if REPORTS_DIR not in sys.path:
    sys.path.insert(0, REPORTS_DIR)

from config import MIN_TRAINING_OBSERVATIONS  # noqa: E402
from services.data_loader import get_active_products, get_daily_sales  # noqa: E402
from services.preprocessing import validate_sales_data, clean_sales_data, DataValidationError  # noqa: E402
from services.feature_engineering import engineer_features, FEATURE_COLUMNS  # noqa: E402
from services.model_service import (  # noqa: E402
    filter_training_eligible, chronological_split,
    evaluate_predictions, evaluate_per_product,
)
from metrics import wmape  # noqa: E402

OUTPUT_DIR = os.path.join(REPORTS_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

REDUCED_FEATURE_COLUMNS = [c for c in FEATURE_COLUMNS if c not in ("rolling_7", "rolling_14")]

# Today's production defaults (model_service.train_global_model) — the
# baseline every experiment is trying to beat. Kept here as a plain dict,
# NOT imported from model_service, so nothing in this file can drift
# production behavior by accident; if these ever get out of sync with
# model_service.py, that's a signal to re-check both by hand.
PRODUCTION_DEFAULTS = {
    "n_estimators": 200, "max_depth": 5, "learning_rate": 0.1,
    "min_child_weight": 1, "colsample_bytree": 1.0, "subsample": 0.9,
    "reg_lambda": 1.0, "reg_alpha": 0.0, "gamma": 0.1,
}

VOLUME_TIER_HIGH = 15
VOLUME_TIER_MEDIUM = 5

RANDOM_SEED = 42


def volume_tier(avg_daily_qty: float) -> str:
    if avg_daily_qty >= VOLUME_TIER_HIGH:
        return "High"
    if avg_daily_qty >= VOLUME_TIER_MEDIUM:
        return "Medium"
    return "Low"


def log(msg=""):
    print(msg)


def section(title):
    log(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


# ---------------------------------------------------------------------
# Data loading — same pipeline generate_training_report.py's Stage 1
# uses, condensed to just what this script needs.
# ---------------------------------------------------------------------
def load_eligible_df():
    active_ids = get_active_products()["id"].astype(int).tolist()
    pooled = []
    for pid in active_ids:
        try:
            sales_df = get_daily_sales(pid)
            validate_sales_data(sales_df)
            sales_df = clean_sales_data(sales_df)
            pooled.append(sales_df)
        except (DataValidationError, ValueError):
            continue
    if not pooled:
        raise SystemExit("No active products had validated sales history — nothing to experiment on.")
    all_sales_df = pd.concat(pooled, ignore_index=True)
    features_df = engineer_features(all_sales_df).dropna(subset=FEATURE_COLUMNS)
    eligible_df, excluded = filter_training_eligible(features_df, MIN_TRAINING_OBSERVATIONS)
    return eligible_df, excluded


def volume_tier_map(eligible_df: pd.DataFrame) -> dict:
    tiers = {}
    for pid, grp in eligible_df.groupby("product_id", observed=True):
        avg_daily = grp["quantity_sold"].mean()
        tiers[pid] = volume_tier(avg_daily)
    return tiers


# ---------------------------------------------------------------------
# Naive baselines — lag_7 and rolling_7 are already columns on any
# feature-engineered split, exactly like generate_training_report.py's
# baseline section uses on test_df.
# ---------------------------------------------------------------------
def naive_baselines(df: pd.DataFrame, label: str) -> dict:
    actual = df["quantity_sold"].values
    results = {}
    for name, col in [("lag_7", "lag_7"), ("rolling_7", "rolling_7")]:
        pred = df[col].values
        m = evaluate_predictions(actual, pred)
        w = wmape(actual, pred)
        results[name] = {**m, "wmape": w}
        mape_str = f"{m['mape']:.2f}%" if m["mape"] is not None else "N/A"
        wmape_str = f"{w:.2f}%" if w is not None else "N/A"
        log(f"  [{label}] naive {name}: MAE={m['mae']:.3f} RMSE={m['rmse']:.3f} "
            f"MAPE={mape_str} WMAPE={wmape_str}")
    return results


# ---------------------------------------------------------------------
# Core training helper. target_mode='quantity' trains directly on
# quantity_sold (the normal case); target_mode='ratio' trains on
# quantity_sold/rolling_7 and the caller is responsible for converting
# predictions back to quantity units before scoring — see
# relative_target_experiment().
# ---------------------------------------------------------------------
def fit_candidate(fit_df, eval_df, columns, params, seed=RANDOM_SEED,
                   early_stopping_rounds=20, max_n_estimators=500,
                   target_mode="quantity"):
    X_fit = fit_df[columns]
    X_eval = eval_df[columns]

    if target_mode == "quantity":
        y_fit = fit_df["quantity_sold"]
        y_eval = eval_df["quantity_sold"]
    elif target_mode == "ratio":
        y_fit = fit_df["_ratio_target"]
        y_eval = eval_df["_ratio_target"]
    else:
        raise ValueError(f"unknown target_mode {target_mode!r}")

    model = xgb.XGBRegressor(
        n_estimators=max_n_estimators,
        max_depth=params["max_depth"],
        learning_rate=params.get("learning_rate", 0.1),
        min_child_weight=params["min_child_weight"],
        colsample_bytree=params["colsample_bytree"],
        subsample=params["subsample"],
        reg_lambda=params["reg_lambda"],
        reg_alpha=params["reg_alpha"],
        gamma=params.get("gamma", 0.1),
        tree_method="hist",
        enable_categorical=True,
        random_state=seed,
        early_stopping_rounds=early_stopping_rounds,
        eval_metric="mae",
    )
    model.fit(X_fit, y_fit, eval_set=[(X_eval, y_eval)], verbose=False)
    best_iteration = int(model.best_iteration) if hasattr(model, "best_iteration") and model.best_iteration is not None else max_n_estimators
    return model, best_iteration


def score_quantity(model, df, columns, ratio_col=None):
    """Predicts and scores in real quantity units. If ratio_col is set,
    the model's raw output is a ratio and gets multiplied back by that
    row's ratio_col value (clipped at 0) before scoring — see
    relative_target_experiment()."""
    raw_pred = model.predict(df[columns])
    if ratio_col is not None:
        pred = np.clip(raw_pred * df[ratio_col].values, 0, None)
    else:
        pred = np.clip(raw_pred, 0, None)
    m = evaluate_predictions(df["quantity_sold"].values, pred)
    w = wmape(df["quantity_sold"].values, pred)
    return pred, {**m, "wmape": w}


# ---------------------------------------------------------------------
# Experiment 1: weekend-row diagnostic (no training).
# ---------------------------------------------------------------------
def experiment_weekend_diagnostic(fit_df, val_df, test_df):
    section("EXPERIMENT 1: Weekend-row diagnostic")
    rows = []
    for label, df in [("fit_df", fit_df), ("val_df", val_df), ("test_df", test_df)]:
        n = len(df)
        n_weekend = int((df["is_weekend"] == 1).sum())
        pct = round(n_weekend / n * 100, 2) if n else 0.0
        date_min = df["sale_date"].min()
        date_max = df["sale_date"].max()
        rows.append({
            "split": label, "n_rows": n, "n_weekend_rows": n_weekend,
            "weekend_pct": pct, "date_min": date_min.date() if pd.notna(date_min) else None,
            "date_max": date_max.date() if pd.notna(date_max) else None,
        })
    df_out = pd.DataFrame(rows)
    log(df_out.to_string(index=False))
    return df_out


# ---------------------------------------------------------------------
# Experiment 2: regularization search (random search over the given
# grid, not exhaustive) with early stopping against val_df.
# ---------------------------------------------------------------------
def experiment_regularization_search(fit_df, val_df, n_trials=30, seed=RANDOM_SEED):
    section(f"EXPERIMENT 2: Regularization search ({n_trials} random trials + production-defaults baseline)")

    grid = {
        "max_depth": [3, 4, 5],
        "min_child_weight": [1, 3, 5, 10],
        "colsample_bytree": [0.6, 0.8, 1.0],
        "subsample": [0.7, 0.8, 0.9],
        "reg_lambda": [1.0, 3.0, 5.0],
        "reg_alpha": [0, 0.5, 1.0],
    }
    keys = list(grid.keys())
    rng = random.Random(seed)

    tried = set()
    results = []

    # Always include today's production defaults as trial 0 — the
    # number every other trial is actually trying to beat, evaluated
    # under the exact same fit/val/early-stopping harness as everything
    # else here (production's own train_global_model() does NOT use
    # early stopping or a held-out val set, so this is not literally
    # "reproducing production" — it's giving the production
    # hyperparameters a fair shot in this experiment's harness).
    baseline_params = {k: PRODUCTION_DEFAULTS[k] for k in keys}
    combos = [tuple(baseline_params[k] for k in keys)]
    tried.add(combos[0])

    while len(combos) < n_trials + 1:
        combo = tuple(rng.choice(grid[k]) for k in keys)
        if combo in tried:
            continue
        tried.add(combo)
        combos.append(combo)

    for i, combo in enumerate(combos):
        params = dict(zip(keys, combo))
        t0 = time.time()
        model, best_iter = fit_candidate(fit_df, val_df, FEATURE_COLUMNS, params)
        _, val_metrics = score_quantity(model, val_df, FEATURE_COLUMNS)
        elapsed = time.time() - t0
        tag = "production-defaults" if i == 0 else f"trial {i}"
        row = {"trial": tag, **params, "best_iteration": best_iter,
               "val_mae": val_metrics["mae"], "val_rmse": val_metrics["rmse"],
               "val_mape": val_metrics["mape"], "val_wmape": val_metrics["wmape"],
               "seconds": round(elapsed, 1)}
        results.append(row)
        wmape_str = f"{val_metrics['wmape']:.2f}%" if val_metrics["wmape"] is not None else "N/A"
        log(f"  [{tag}] {params} best_iter={best_iter} -> "
            f"val MAE={val_metrics['mae']:.3f} WMAPE={wmape_str} ({elapsed:.1f}s)")

    results_df = pd.DataFrame(results).sort_values("val_wmape")
    out_path = os.path.join(OUTPUT_DIR, "regularization_search_log.csv")
    results_df.to_csv(out_path, index=False)
    log(f"\n  Full log written to {out_path}")
    log("\n  Top 5 by val WMAPE:")
    log(results_df.head(5).to_string(index=False))
    return results_df


# ---------------------------------------------------------------------
# Experiment 3: rolling-features-removed ablation, scored for real
# (not just feature importance) using the best regularization from
# experiment 2.
# ---------------------------------------------------------------------
def experiment_ablation(fit_df, val_df, best_params):
    section("EXPERIMENT 3: Rolling-features-removed ablation (scored on val_df)")
    log(f"  Feature columns: {REDUCED_FEATURE_COLUMNS}")
    log(f"  Regularization: {best_params}")

    model, best_iter = fit_candidate(fit_df, val_df, REDUCED_FEATURE_COLUMNS, best_params)
    _, val_metrics = score_quantity(model, val_df, REDUCED_FEATURE_COLUMNS)
    wmape_str = f"{val_metrics['wmape']:.2f}%" if val_metrics["wmape"] is not None else "N/A"
    log(f"  best_iteration={best_iter} -> val MAE={val_metrics['mae']:.3f} "
        f"RMSE={val_metrics['rmse']:.3f} WMAPE={wmape_str}")
    return {"feature_columns": REDUCED_FEATURE_COLUMNS, "params": best_params,
            "best_iteration": best_iter, **val_metrics}


# ---------------------------------------------------------------------
# Experiment 4: relative-target (predict quantity_sold / rolling_7,
# multiply back by rolling_7 before scoring — comparison stays in real
# quantity units throughout).
# ---------------------------------------------------------------------
def relative_target_experiment(fit_df, val_df, best_params):
    section("EXPERIMENT 4: Relative-target (quantity_sold / rolling_7)")

    fit_mask = fit_df["rolling_7"] > 0
    val_mask = val_df["rolling_7"] > 0
    n_fit_dropped = int((~fit_mask).sum())
    n_val_dropped = int((~val_mask).sum())
    log(f"  Dropping {n_fit_dropped} fit_df row(s) and {n_val_dropped} val_df row(s) "
        f"with rolling_7 == 0 from ratio-target TRAINING (division by zero) — "
        f"those val rows are still SCORED below (ratio * 0 = 0 predicted quantity).")

    fit_ratio_df = fit_df[fit_mask].copy()
    fit_ratio_df["_ratio_target"] = fit_ratio_df["quantity_sold"] / fit_ratio_df["rolling_7"]
    val_ratio_df = val_df[val_mask].copy()
    val_ratio_df["_ratio_target"] = val_ratio_df["quantity_sold"] / val_ratio_df["rolling_7"]

    if len(fit_ratio_df) == 0 or len(val_ratio_df) == 0:
        log("  Not enough rows with rolling_7 > 0 to run this experiment — skipping.")
        return None

    model, best_iter = fit_candidate(
        fit_ratio_df, val_ratio_df, FEATURE_COLUMNS, best_params, target_mode="ratio"
    )

    # Score on ALL of val_df (not just val_ratio_df) — a row with
    # rolling_7 == 0 still needs a real-quantity prediction to be
    # comparable to every other experiment's val_df score.
    _, val_metrics = score_quantity(model, val_df, FEATURE_COLUMNS, ratio_col="rolling_7")
    wmape_str = f"{val_metrics['wmape']:.2f}%" if val_metrics["wmape"] is not None else "N/A"
    log(f"  best_iteration={best_iter} -> val MAE={val_metrics['mae']:.3f} "
        f"RMSE={val_metrics['rmse']:.3f} WMAPE={wmape_str} (real quantity units)")
    return {"target_mode": "ratio", "params": best_params, "best_iteration": best_iter, **val_metrics}


# ---------------------------------------------------------------------
# Final step: retrain the chosen winner on the FULL train_df (80%),
# evaluate ONCE on test_df. This is the only test_df evaluation in the
# entire script.
# ---------------------------------------------------------------------
def final_test_evaluation(train_df, test_df, columns, params, n_estimators, target_mode, tiers):
    section("FINAL: retrain winner on full train_df, evaluate ONCE on test_df")
    log(f"  Feature columns: {columns}")
    log(f"  Params: {params}")
    log(f"  n_estimators (fixed, from val-based early stopping — NOT early-stopped against test_df): {n_estimators}")
    log(f"  target_mode: {target_mode}")

    X_train = train_df[columns]
    if target_mode == "ratio":
        train_mask = train_df["rolling_7"] > 0
        y_train = (train_df.loc[train_mask, "quantity_sold"] / train_df.loc[train_mask, "rolling_7"])
        X_train = train_df.loc[train_mask, columns]
    else:
        y_train = train_df["quantity_sold"]

    model = xgb.XGBRegressor(
        n_estimators=n_estimators,
        max_depth=params["max_depth"],
        learning_rate=params.get("learning_rate", 0.1),
        min_child_weight=params["min_child_weight"],
        colsample_bytree=params["colsample_bytree"],
        subsample=params["subsample"],
        reg_lambda=params["reg_lambda"],
        reg_alpha=params["reg_alpha"],
        gamma=params.get("gamma", 0.1),
        tree_method="hist",
        enable_categorical=True,
        random_state=RANDOM_SEED,
    )
    model.fit(X_train, y_train)

    ratio_col = "rolling_7" if target_mode == "ratio" else None
    test_pred, test_metrics = score_quantity(model, test_df, columns, ratio_col=ratio_col)

    naive = naive_baselines(test_df, "test_df (FINAL)")

    wmape_str = f"{test_metrics['wmape']:.2f}%" if test_metrics["wmape"] is not None else "N/A"
    log(f"\n  MODEL  (final, real test set): MAE={test_metrics['mae']:.3f} "
        f"RMSE={test_metrics['rmse']:.3f} WMAPE={wmape_str}")

    # Per-product / per-tier breakdown on the real test set.
    per_product = evaluate_per_product(test_df, test_pred)
    for row in per_product:
        row["volume_tier"] = tiers.get(row["product_id"], "Unknown")
    per_product_df = pd.DataFrame(per_product)

    scored = test_df[["product_id", "quantity_sold"]].copy()
    scored["predicted"] = test_pred
    tier_rows = []
    for tier in ["High", "Medium", "Low"]:
        pids = [pid for pid, t in tiers.items() if t == tier]
        sub = scored[scored["product_id"].isin(pids)]
        if sub.empty:
            continue
        w = wmape(sub["quantity_sold"].values, sub["predicted"].values)
        naive_lag7_w = wmape(sub["quantity_sold"].values, test_df.loc[sub.index, "lag_7"].values)
        naive_roll7_w = wmape(sub["quantity_sold"].values, test_df.loc[sub.index, "rolling_7"].values)
        tier_rows.append({
            "volume_tier": tier, "n_products": sub["product_id"].nunique(), "n_rows": len(sub),
            "model_wmape": w, "naive_lag7_wmape": naive_lag7_w, "naive_rolling7_wmape": naive_roll7_w,
            "beats_lag7": (w is not None and naive_lag7_w is not None and w < naive_lag7_w),
            "beats_rolling7": (w is not None and naive_roll7_w is not None and w < naive_roll7_w),
        })
    tier_df = pd.DataFrame(tier_rows)
    log("\n  By volume tier (test_df, real quantity units):")
    log(tier_df.to_string(index=False))

    return {
        "model_metrics": test_metrics, "naive": naive,
        "per_product_df": per_product_df, "tier_df": tier_df,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=30, help="regularization search random trials")
    parser.add_argument("--skip-final", action="store_true",
                         help="Run every val_df experiment and print the winner, but do NOT touch "
                              "test_df at all. Use this for any exploratory/smoke-test run so "
                              "test_df stays genuinely single-use for the real final run.")
    args = parser.parse_args()

    section("Loading pooled, eligible dataset (same pipeline as /train)")
    eligible_df, excluded = load_eligible_df()
    log(f"  {len(eligible_df)} usable rows, {eligible_df['product_id'].nunique()} eligible products, "
        f"{len(excluded)} excluded for insufficient data.")
    tiers = volume_tier_map(eligible_df)

    # Step 1 of the required methodology: the REAL 80/20 split. test_df
    # from here is touched exactly once more, at the very end.
    train_df, test_df = chronological_split(eligible_df)
    log(f"  train_df: {len(train_df)} rows ({train_df['sale_date'].min().date()} to {train_df['sale_date'].max().date()})")
    log(f"  test_df:  {len(test_df)} rows ({test_df['sale_date'].min().date()} to {test_df['sale_date'].max().date()})")

    # Step 2: carve fit/val OUT OF train_df only, reusing chronological_split().
    fit_df, val_df = chronological_split(train_df, train_fraction=0.8)
    log(f"  fit_df:   {len(fit_df)} rows ({fit_df['sale_date'].min().date()} to {fit_df['sale_date'].max().date()})")
    log(f"  val_df:   {len(val_df)} rows ({val_df['sale_date'].min().date()} to {val_df['sale_date'].max().date()})")

    section("Naive baselines on val_df (the comparison every candidate below is scored against)")
    val_naive = naive_baselines(val_df, "val_df")

    weekend_df = experiment_weekend_diagnostic(fit_df, val_df, test_df)

    reg_results_df = experiment_regularization_search(fit_df, val_df, n_trials=args.trials)
    best_row = reg_results_df.iloc[0]
    best_params = {k: best_row[k] for k in
                   ["max_depth", "min_child_weight", "colsample_bytree", "subsample", "reg_lambda", "reg_alpha"]}
    best_params["max_depth"] = int(best_params["max_depth"])
    best_params["min_child_weight"] = float(best_params["min_child_weight"])
    best_n_estimators = int(best_row["best_iteration"])
    log(f"\n  Best regularization by val WMAPE: {best_params} (best_iteration={best_n_estimators}, "
        f"trial={best_row['trial']})")

    ablation_result = experiment_ablation(fit_df, val_df, best_params)
    ratio_result = relative_target_experiment(fit_df, val_df, best_params)

    # --- Pick the winner among everything scored on val_df ---
    candidates = [{
        "name": "full-features (best regularization)",
        "columns": FEATURE_COLUMNS, "params": best_params,
        "n_estimators": best_n_estimators, "target_mode": "quantity",
        "val_wmape": float(best_row["val_wmape"]) if pd.notna(best_row["val_wmape"]) else None,
        "val_mae": float(best_row["val_mae"]),
    }]
    if ablation_result is not None:
        candidates.append({
            "name": "rolling-features-removed ablation",
            "columns": REDUCED_FEATURE_COLUMNS, "params": ablation_result["params"],
            "n_estimators": ablation_result["best_iteration"], "target_mode": "quantity",
            "val_wmape": ablation_result["wmape"], "val_mae": ablation_result["mae"],
        })
    if ratio_result is not None:
        candidates.append({
            "name": "relative-target (ratio)",
            "columns": FEATURE_COLUMNS, "params": ratio_result["params"],
            "n_estimators": ratio_result["best_iteration"], "target_mode": "ratio",
            "val_wmape": ratio_result["wmape"], "val_mae": ratio_result["mae"],
        })

    section("CANDIDATE SUMMARY (val_df — this is the selection step)")
    cand_df = pd.DataFrame([{k: v for k, v in c.items() if k not in ("columns", "params")} for c in candidates])
    cand_df = cand_df.sort_values("val_wmape")
    log(cand_df.to_string(index=False))
    naive_lag7_wmape = val_naive["lag_7"]["wmape"]
    naive_roll7_wmape = val_naive["rolling_7"]["wmape"]
    log(f"\n  val_df naive lag_7 WMAPE:     {naive_lag7_wmape:.2f}%" if naive_lag7_wmape is not None else "  val_df naive lag_7 WMAPE: N/A")
    log(f"  val_df naive rolling_7 WMAPE: {naive_roll7_wmape:.2f}%" if naive_roll7_wmape is not None else "  val_df naive rolling_7 WMAPE: N/A")

    winner = sorted(candidates, key=lambda c: (c["val_wmape"] is None, c["val_wmape"]))[0]
    log(f"\n  WINNER (lowest val WMAPE): {winner['name']}")

    if args.skip_final:
        log("\n  --skip-final passed — stopping here. test_df was NOT touched by this run.")
        return

    final = final_test_evaluation(
        train_df, test_df, winner["columns"], winner["params"],
        winner["n_estimators"], winner["target_mode"], tiers,
    )

    # --- Write everything to a plain-text/markdown summary file ---
    # Tables as fenced ```text blocks (df.to_string()), not df.to_markdown()
    # — that needs the `tabulate` package, which isn't in
    # requirements-dev.txt and this diagnostic-only script shouldn't add
    # a new dependency just for prettier output.
    def block(df):
        return "```text\n" + df.to_string(index=False) + "\n```\n"

    summary_path = os.path.join(OUTPUT_DIR, "accuracy_experiment_summary.md")
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("# Accuracy tuning experiment summary\n\n")
        f.write(f"Dataset: {len(eligible_df)} usable rows, {eligible_df['product_id'].nunique()} eligible products.\n\n")
        f.write("## Splits\n\n")
        f.write(f"- fit_df: {len(fit_df)} rows\n- val_df: {len(val_df)} rows\n- test_df: {len(test_df)} rows\n\n")
        f.write("## Weekend-row diagnostic\n\n")
        f.write(block(weekend_df) + "\n")
        f.write("## Regularization search (all trials)\n\n")
        f.write(block(reg_results_df) + "\n")
        f.write("## Candidate summary (val_df selection)\n\n")
        f.write(block(cand_df) + "\n")
        f.write(f"Winner: **{winner['name']}**\n\n")
        f.write("## FINAL real test-set result (evaluated once)\n\n")
        mm = final["model_metrics"]
        f.write(f"- Model: MAE={mm['mae']:.3f}, RMSE={mm['rmse']:.3f}, WMAPE={mm['wmape']:.2f}%\n")
        for name, m in final["naive"].items():
            f.write(f"- Naive {name}: MAE={m['mae']:.3f}, RMSE={m['rmse']:.3f}, WMAPE={m['wmape']:.2f}%\n")
        f.write("\n### By volume tier\n\n")
        f.write(block(final["tier_df"]) + "\n")
    log(f"\nWritten summary: {summary_path}")


if __name__ == "__main__":
    main()
