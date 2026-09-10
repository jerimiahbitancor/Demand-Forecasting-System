# ChefDuo ML Service

The Python microservice from Option A. Express calls this over HTTP;
this service never talks to the frontend directly and never writes to
any table except `forecasts`, `model_metrics`, `product_classifications`,
and `forecast_cogs`.

## Architecture: one global model, not one per product

**Decision log, for your defense:** an earlier version of this service
trained 61 separate models, one per product. That was replaced with a
**single global XGBoost model** trained on every active product's
pooled history at once, with `product_id` as a feature. Reasoning:

- Several of ChefDuo's 61 SKUs are low-volume. A model trained only on
  one sparse product's own history has very little to learn from. A
  global model lets every product benefit from what the model learns
  about calendar effects (weekends, paydays, holidays) across the
  *entire* pooled dataset, while `product_id` still lets it tell
  products apart.
- `product_id` is passed as a pandas `category` dtype with XGBoost's
  **native categorical support** (`enable_categorical=True`,
  `tree_method="hist"`) — deliberately *not* `.astype('category').cat.codes`
  cast to a plain integer. Manual label-encoding assigns a code based
  on which categories are present *in that specific training run*; if
  a product is added or archived between two training runs, the same
  product could silently get a different code each time, corrupting
  what the model learned without any error being raised. `product_id`
  is already a stable, permanent database primary key, so native
  categorical handling can use it directly and safely.
- **The tradeoff, and how it's handled:** a single high-volume product
  could dominate the pooled training loss. `model_service.py` always
  reports **per-product MAPE**, never only the aggregate — this is
  the concrete fix for the "blended metric hides bad products" problem
  from our earlier pipeline walkthrough. A synthetic-data test run
  during development showed exactly this pattern: aggregate MAPE 22%,
  but a high-volume product scored 5% while a low-volume product
  scored 51% — the kind of gap a single blended number would hide.

## Structure

```
ml-service/
├── app.py                          Flask routes only — no business logic lives here
├── config.py                       Env vars + the one shared Supabase client
├── services/
│   ├── data_loader.py              Every SELECT this service makes — reads only
│   ├── preprocessing.py            Validation + cleaning (before feature engineering)
│   ├── feature_engineering.py      THE shared feature logic — training AND forecasting import this
│   ├── model_service.py            Train / evaluate the global model
│   ├── model_storage.py            Persists the model to Supabase Storage (NOT local disk — see below)
│   ├── forecast_service.py         Loads the saved model and predicts — never trains
│   ├── business_logic.py           Demand classification, ingredient demand, COGS
│   └── supabase_writer.py          Every INSERT/UPSERT this service makes — writes only
├── utils/
│   └── holidays.py                 PH holiday calendar for is_holiday (needs yearly upkeep)
└── models/                         LOCAL SCRATCH ONLY, gitignored — see model_storage.py
```

## Why models live in Supabase Storage, not local disk

Render's web service disk is **ephemeral** — anything written to
`./models` disappears on the next restart, redeploy, or scale event.
`model_storage.py` uses `./models` only as a temporary staging path
(XGBoost's `save_model()`/`load_model()` need a real file path), then
immediately uploads/downloads the actual persistent copy to/from a
Supabase Storage bucket. **Create the bucket once** in your Supabase
dashboard (Storage tab) — default name `ml-models`, matching
`SUPABASE_MODEL_BUCKET` in `.env` — before your first training run.

Each training run saves a new, uniquely-timestamped file
(`model_v{YYYYMMDD_HHMMSS}.json`) — nothing is ever overwritten, which
is what makes rollback possible: `load_previous_model()` in
`model_storage.py` returns the second-most-recent version if a new
model's live accuracy turns out worse than the one it replaced.

## Confirmed project decisions (so this doesn't get re-litigated)

- **Data volume:** ~12 months of real ChefDuo history exists; the
  4-day sample was for understanding the POS export format only.
- **Closed days:** absent from `daily_sales` entirely — never
  zero-filled. A missing row means "didn't happen," not "sold zero."
- **Refunds:** already netted out of Loyverse's `Items sold` figure —
  no separate refund subtraction needed in this pipeline.
- **Operating hours:** ChefDuo recently changed to **Monday–Friday,
  3PM–3AM only**. Historical training data still contains some
  Saturday/Sunday sales from before the change — that's real signal,
  left in training as-is. Going forward, weekend forecast dates are
  resolved to 0 by business rule in `forecast_service.py` rather than
  sent through the model, since a future Saturday isn't a prediction
  problem anymore — it's a known closure.
- **Weekly forecast:** Monday–Sunday (7 calendar days), with the
  weekend-closure rule above applied to Saturday/Sunday specifically.
- **Retraining cadence:** monthly.
- **Product eligibility for training:** `is_active = true` AND
  `first_sold_date` at least 28 days before the training cutoff.
- **Rollback:** always deploy the newly trained model; the previous
  version stays retrievable by its timestamped filename in Storage.

## Setup

```bash
cd ml-service
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then fill in your real Supabase credentials
python app.py                   # runs on http://localhost:5001
```

Before your first `/train` call:
1. Create a `ml-models` bucket in Supabase Storage (dashboard → Storage → New bucket).
2. Confirm the `forecasts` table has a unique constraint on
   `(product_id, forecast_date)` — `supabase_writer.write_forecast`
   upserts on this pair; without the constraint, a re-run creates
   duplicate rows instead of overwriting.
3. Verify the PH holiday list in `utils/holidays.py` against the
   actual 2026 Presidential Proclamation once published.

## Endpoints

- `GET  /health` — no auth, for Render's health check
- `POST /train` — trains the global model on every eligible active product's pooled history
- `POST /forecast` — body optional: `{"horizon_days": 7}`, defaults to 1

Both `/train` and `/forecast` require the header:
```
X-ML-Service-Secret: <same value as ML_SERVICE_SHARED_SECRET in .env>
```

## Known simplifications (fine for a capstone, flag if a panelist asks)

- Per-product metric breakdown is summarized into `model_metrics.notes`
  as text (top-3 worst products). A dedicated per-product metrics
  table would be more queryable once the dashboard needs to browse
  this properly — deliberately kept simple for now.
- `/train` and `/forecast` are synchronous HTTP requests. At ChefDuo's
  current scale (61 products, one client) this is fine; if training
  time ever grows past what Render's request timeout allows, `/train`
  would need to become a background job with Express polling for
  status instead.
- `forecast_cogs` writing is stubbed with a comment in `app.py` — it
  needs the inserted `forecasts` row's `id`, which means capturing
  Supabase's response from `write_forecast` rather than a bare
  fire-and-forget call. Left as a clearly marked next step.
