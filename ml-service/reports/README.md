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

Seven stages, each with a terminal table and one plot in the HTML,
navigable from a sticky sidebar:

1. **Data Load & Preprocessing** — pooled sales pull, validation,
   cleaning; total daily quantity sold, all products.
2. **Outlier Check** — per-product IQR summary; boxplot for the top 10
   products by volume. Confirms nothing is actually removed as an
   outlier in production today (`clean_sales_data()` only dedupes and
   sorts) — this is a read of the real pipeline's behavior, not a
   proposal to change it.
3. **Chronological Train/Test Split** — the real 80/20 date-based split
   from `model_service.chronological_split()`, shown for one
   high-volume and one low-volume product.
4. **Feature Engineering** — sample engineered rows for one product,
   plus a chart of `rolling_7` against actual sales to visually confirm
   the per-product `.transform()` grouping isn't leaking across product
   boundaries.
5. **Feature Importance** — bar chart with the same human-readable
   labels as `FEATURE_LABELS` in
   `backend/services/analyticsService.js`. **These two label sets are
   kept in sync by hand** — there's no shared source across the
   Python/JS boundary, so if one changes, update the other.
6. **Evaluation Metrics** — aggregate MAE/RMSE/MAPE plus the full
   per-product breakdown (worst-to-best MAPE), with a reference line at
   10% (Lewis 1982's "highly accurate" threshold, cited in the paper).
7. **Predictions** — actual vs. predicted over the test period for the
   same two representative products. This is one-step evaluation
   against real held-out data, not a simulated recursive multi-day
   forecast — see the note in that section of the report for why that
   distinction matters (it's the same reason production forecasts are
   capped at 7 days).

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
