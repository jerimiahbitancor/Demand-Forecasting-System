# Training Pipeline Diagnostic Report

`generate_training_report.py` is a **local-only diagnostic tool**. It is
not called by Flask, not deployed to Render, and not imported by
`app.py` or anything under `services/`. Nobody but a developer running
it by hand on their own machine ever touches it.

It exists to answer "what does each stage of `/train` actually produce"
without adding matplotlib (or any charting) to the deployed service —
`utils/debug_log.py` already explains why the production service stays
headless and log-only. This script imports the real functions from
`services/data_loader.py`, `services/preprocessing.py`,
`services/feature_engineering.py`, `services/model_service.py`, and
`services/model_storage.py` directly, so every stage in the report
genuinely matches what `/train` does — nothing here is a separate
reimplementation of that logic that could quietly drift out of sync
with it.

## What it needs

- A real `ml-service/.env` with working `SUPABASE_URL` /
  `SUPABASE_SERVICE_KEY` (the same file `app.py` uses — `config.py`
  loads it via `load_dotenv()` regardless of which script imports it).
- The normal `requirements.txt` dependencies already installed, plus
  matplotlib from the new dev-only `requirements-dev.txt`:

  ```bash
  cd ml-service
  pip install -r requirements.txt -r requirements-dev.txt
  ```

`requirements-dev.txt` is never installed on Render and is not
referenced by `Procfile` or `app.py` — it exists purely so a developer
can run this one script locally.

## How to run it

```bash
cd ml-service
python reports/generate_training_report.py
```

This prints one table per pipeline stage to the terminal, then writes:

```
ml-service/reports/output/training_report.html
```

a single self-contained HTML file — every plot is embedded as a base64
PNG, no external CSS/JS, no CDN — so it's easy to open directly in a
browser, drop into the paper, or send to a teammate without also
sending an `output/` folder of loose image files.

### Important: this does NOT train a new model by default

By default the script **loads the latest model already saved in
Supabase Storage, read-only**, and re-evaluates it against a freshly
pooled dataset purely for the report. It does not call
`train_global_model()` and does not upload anything.

This is deliberate: `load_latest_model()` (used by the real `/forecast`
route) always picks the newest file in the `ml-models` bucket by
timestamp. If this "diagnostic" script trained a new model by default
every time someone generated a report, that report-run model would
silently become the model driving real forecasts — a reporting tool
should not have that side effect by accident.

If you explicitly want this run to train a fresh model (and accept
that it uploads a new `model_v...json` to the `ml-models` bucket, same
as a real `/train` call would):

```bash
python reports/generate_training_report.py --train
```

The script prints an unmissable warning to the terminal whenever it's
about to do this (whether because you passed `--train`, or because no
model exists yet and it had to train one to produce a report at all).

## What's in the report

Sections, in reading order (updated Oct 17 2026):

1. **Data Load & Preprocessing** — pooled sales pull, validation, cleaning.
2. **Calendar Coverage** — open, closed and unconfirmed days.
3. **Data Cleaning Output** — the result of the cleaning steps in DFS Data
   Cleaning Notes v3.2 Part B: rows before/after zero fill and warm-up, and one
   row per product (real sales days, zero-filled days, outliers, included or not).
4. **Outlier Check / Outlier Review** — flagged days, report only; nothing is removed.
5. **Feature Engineering** — sample engineered rows for one product.
6. **Training Data Set** — the exact table the model learns from: a column
   dictionary, the fit / validation / test parts, and 20 sample rows. The full
   table (with product names and each row's part) is written to
   `output/local/training_dataset.csv`.
7. **Chronological Split** — fit, validation and test periods, cut by date.
8. **Training Settings and Early Stopping** — the tuned settings, the tree count
   early stopping chose, and the learning curve (error after each tree).
9. **Feature Importance** — every feature's gain share, including both rolling
   averages, plus the rolling-features-removed ablation.
10. **Final Evaluation Metrics** — WMAPE (headline), MAE, RMSE for the model and
    both benchmarks; skill scores; whole-store-per-day WMAPE; before vs after the
    longest closure.
11. **Baseline Comparison / Evaluation Metrics / Train vs Test** — per product
    and per volume tier.
12. **Forecast Horizon Breakdown / Predictions** — recursive backtest and
    actual vs predicted.
13. **Forecast Preview (Next 7 Days)** — what `/forecast` would produce now,
    using the production `generate_forecast()`; read-only, nothing is written.
    Per-product rows go to `output/local/forecast_preview.csv`.
14. **Production Reality Check** — staleness, drift, previous model.

The Two-Fold Time-Stability Check was removed on Oct 17 2026.

## Good source for paper figures

The HTML report is a reasonable source to pull figures from for the
capstone paper (Chapter 2/3 Algorithm Discussion, evaluation section,
etc.) — the underlying numbers come straight from the real pipeline
code, not a hand-built illustration. If you use a screenshot from it,
note in the paper whether that run was against the currently deployed
model (default, read-only) or a fresh `--train` run, since those can
differ.

## Housekeeping

`ml-service/reports/output/` is regenerated every run and isn't
currently listed in `ml-service/.gitignore` — consider adding it there
(alongside the existing `models/*.json` entry) so generated reports
don't get committed by accident.
