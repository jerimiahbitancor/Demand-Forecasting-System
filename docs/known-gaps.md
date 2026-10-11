# Known gaps

Things we know about, decided not to fix right now, and how to fix them later.
Each entry says what it is, why it was accepted, the risk, and the fix.
Last updated: Oct 11, 2026.

Numbers are stable (other docs refer to them), so new items are added at the end of the numbering, not in reading order.

---

## Critical: data safety

### 9. Settings backup silently keeps only 1,000 rows per table; reset deletes without a backup
- **What:** `backend/controllers/historyController.js` `dumpAllData()` reads each table with `.limit(100000)`. The project's Supabase **Max rows is 1,000**, which overrides that, so each table is cut at 1,000 rows **with no warning**: the backup reports success. Today `daily_sales` has 17,573 rows, so a backup holds about **6%** of the sales history. The data export (JSON/CSV) uses the same dump and is cut the same way. Separately, **Reset Historical Data** (`resetData`) deletes every row of `daily_sales`, `forecasts`, `forecast_runs`, `forecast_cogs`, `model_metrics`, `inventory_transactions` and `market_price` **without taking a backup first**.
- **Why not fixed now:** found during pre-defense wrap-up; `historyController.js` changes need care (and a test) and were out of scope.
- **Risk:** **high for data**, low for day-to-day use. Anyone who relies on the in-app backup before a reset (or before any risky step) would lose almost all history with no sign that anything was missing.
- **Workaround until fixed:** before any risky step, export the tables by hand in Supabase (Table editor → table → Export to CSV), at least `daily_sales`, `uploads`, `business_days`, `products`, `product_ingredients`, `ingredients`. Don't rely on the in-app backup.
- **Fix later:** page each table with the existing `utils/fetchAllRows.js` (stable `order('id')`), report the row count per table in the backup and fail loudly if a table can't be read; make Reset refuse to run unless a backup was taken in the same session (or take one itself first).

---

## Security

### 1. `/create-password` has no time limit after OTP verification
- **What:** `backend/services/otpService.js` defines `OTP_EXPIRATION_MINUTES` but does not export it. In `routes/auth.js` `/create-password`, the check `timeDiff > OTP_EXPIRATION_MINUTES` compares against `undefined`, which is always false, so the "OTP verified too long ago" check never fires. (Found by `backend/tests/serviceExports.test.js`, which lists it as a documented exception.)
- **Why accepted:** decision by the owner, 2026-10-06. Exporting the constant (= 1) would switch on a 1-minute window between OTP verification and password creation. That changes registration behavior during defense week, and `routes/auth.js` is protected.
- **Risk:** low. Registration is closed once the single owner account exists. The OTP itself still expires at `/verify-otp`. Only the gap between "OTP verified" and "password set" has no limit.
- **Fix later:** export a separate, longer constant for this check (10–15 minutes is sensible), use it in `/create-password`, then remove the two `KNOWN_MISSING` entries in `serviceExports.test.js`. That test fails if the export is fixed but the entries are left in.

### 2. `product_sales_summary` view: turn on `security_invoker` (defense in depth)
- **What:** checked 2026-10-06 with `backend/sql/2026-10-06_check_view_exposure.sql`: anon and authenticated **cannot** read it, so it is not exposed today. But it does not have `security_invoker = true`, so it runs with its owner's rights.
- **Why accepted:** it isn't exposed, and the owner chose not to change permissions before the defense.
- **Risk:** low. It matters only if someone later grants anon or authenticated access by mistake.
- **Fix later (post-defense):** run the commented-out block at the end of `backend/sql/2026-10-06_check_view_exposure.sql` (`alter view ... set (security_invoker = true)` plus the revoke and grant). Export nothing; it changes permissions only.

### 10. `xlsx` 0.18.5 has two known vulnerabilities
- **What:** `xlsx` `^0.18.5` in **both** `backend/package.json` and `frontend/package.json`. Known issues: **CVE-2023-30533** (prototype pollution, fixed in 0.19.3) and **CVE-2024-22363** (ReDoS, fixed in 0.20.2). SheetJS no longer publishes new versions to npm, so `npm update` cannot fix it. The backend uses it to parse uploaded spreadsheets (`services/fileProcessor.js`) and to write CSV in `historyController.js`.
- **Why not fixed now:** `package.json` / lockfiles were protected in this phase; changing the parser right before the defense risks the upload path.
- **Risk:** low. Only the single authenticated owner can upload, and uploads pass the ClamAV/heuristic scan first. Still, a crafted file could slow the API (ReDoS) or tamper with object prototypes in the API process.
- **Fix later (post-defense):** install the fixed version from the SheetJS CDN tarball (`npm install https://cdn.sheetjs.com/xlsx-<version>/xlsx-<version>.tgz`, pinned to an exact version) in both packages, then re-run the upload tests and one real upload.

### 11. The frontend (Vercel) sends no security headers
- **What:** the API sends a Content-Security-Policy and `X-Frame-Options` through Helmet, but the Vercel-hosted frontend sends neither. `frontend/vercel.json` only has the SPA rewrite.
- **Risk:** low to moderate. Without `X-Frame-Options` / `frame-ancestors` the site can be framed by another site (clickjacking); without a CSP an injected script would have nothing to block it.
- **Fix later:** add a `headers` block to `frontend/vercel.json`: at least `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a CSP that allows the app's own origin, the Railway API, Supabase and Google Fonts. Test the CSP in report-only mode first.

---

## Performance follow-up

Measured from the browser in production (Manila → Railway), 2026-10-06. Upload logic is protected, so none of these were changed.

| Request | Time | Cause | Candidate fix |
|---|---|---|---|
| `POST /api/upload` (1 file) | **15.2 s** | Now that recipes exist, stock deduction makes **2 calls to Supabase, one after the other, per ingredient** (the `deduct_ingredient_stock` RPC, then an `inventory_transactions` insert). | One batched RPC that deducts all ingredients and writes all transactions in one call. |
| `GET /api/product-categories` | **5.9 s** | Not investigated yet. | Profile first: check the access log's `duration_ms`, then the Supabase API log for that request ID. |
| `GET /api/analytics/forecasting` | **2.3–3.8 s** | Several reads one after another, some paged. | Run independent reads in parallel; cache by data fingerprint like the dashboard. |
| `GET /api/analytics/product-performance` | **3.6 s** | Same pattern. | Same. |
| `GET /api/inventory/items` | **2.5–3.2 s** | Works out ingredient daily needs again on every request. | Cache the daily-needs result by data fingerprint (changes only when forecasts, recipes or stock change). |

Also known (from earlier passes):
- `uploadService.getUploadStats()` reads the `uploads` list without paging, so it cuts off at 1,000 uploads (336 today, about 2 years away).
- `marketPriceController.js` loads all ingredients and all market prices and pages in JavaScript.

---

## Reliability

### 3. ML calls have no timeout of their own on the API side
- **What:** `backend/services/mlService.js` calls `/train` and `/forecast` with no timeout, so Node's built-in `fetch` default applies: it stops waiting for response headers after **300 s**. Training took 88 s on 2026-10-06.
- **Risk:** when training passes ~5 minutes, the API gives up even if gunicorn (900 s, see `docs/deployment.md`) is still running it. Training may then finish on the ML side while the owner sees an error.
- **Fix later:** give the ML calls an explicit, documented timeout (e.g. 15 minutes for `/train`), or make training a background job with a status endpoint. `mlService.js` was protected in this phase.

### 12. `ml-service/Procfile` still says `--timeout 120`
- **What:** the Procfile is `web: gunicorn app:app --bind 0.0.0.0:$PORT --timeout 120`. The longer limit (`--timeout 900 --workers 1 --threads 2`, see `docs/deployment.md`) comes **only** from the custom start command set in Railway's `ml` service settings.
- **Risk:** if that Railway setting is ever cleared, or the service is recreated or moved, it silently falls back to 120 s, and training (88 s on 2026-10-06, growing with data) can be killed mid-run.
- **Fix later:** update the Procfile to the same command (ml-service was protected in this phase), so the repo and Railway agree.

### 4. In-memory state is per process
Request counters, scheduler last runs, the dashboard cache and the "training in progress" flag all live in memory. They reset on every restart or redeploy, and they would be wrong with more than one replica. Railway runs **1 replica** today. Don't scale `api` past 1 replica without moving these to the database.

---

## Frontend follow-up

### 5. Older files still fall back to `localhost` for the API
Only `frontend/src/services/apiClient.js` uses the guarded `frontend/src/config/apiBase.js`. These files still have their own `import.meta.env.VITE_API_URL || 'http://localhost:5000/api'`. In a deployed build with no `VITE_API_URL` they would call the visitor's own computer. Today `VITE_API_URL` is set for Production and Preview, so it doesn't happen. Migrate them to `apiClient` (or at least `API_URL` from `config/apiBase.js`):

- `src/context/AuthContext.jsx`
- `src/context/BusinessProfileContext.jsx`
- `src/hooks/useSetupGuard.js`
- `src/services/auditClient.js`
- `src/services/authService.js`
- `src/features/analytics/components/Forecasting.jsx`
- `src/features/analytics/components/IngredientDemand.jsx`
- `src/features/analytics/components/ProductPerformance.jsx`
- `src/features/auth/pages/forgotpass/ForgotPassword.jsx`
- `src/features/auth/pages/forgotpass/ResetPassword.jsx`
- `src/features/components/Notification/NotificationDropdown.jsx` (its 30 s poll already uses `apiClient`; its other actions don't)
- `src/features/components/Notification/NotificationsPage.jsx`
- `src/features/dashboard/components/HistoryGapReview.jsx`
- `src/features/dashboard/states/DataNeedsAttention.jsx`
- `src/features/dashboard/states/FullyOperational.jsx`
- `src/features/dashboard/states/ReadyToTrain.jsx`
- `src/features/datamanagement/components/HistoricalData.jsx` (protected in this phase)
- `src/features/datamanagement/components/UploadData.jsx` (protected in this phase)
- `src/features/datamanagement/pages/DataManagement.jsx` (protected in this phase)
- `src/features/inventory/pages/IngredientManagement.jsx`
- `src/features/inventory/pages/MarketPriceManagement.jsx`
- `src/features/inventory/pages/ProductManagement.jsx`
- `src/features/settings/components/AboutDocumentation.jsx`
- `src/features/settings/components/AccountSettings.jsx`
- `src/features/settings/components/AuditLogs.jsx`
- `src/features/settings/components/BusinessProfile.jsx`
- `src/features/settings/components/DataManagementSettings.jsx`
- `src/features/settings/components/ForecastConfig.jsx`

### 6. Dashboard panels with no real data source yet
These used to show invented numbers; since 2026-10-06 they say "Not available yet" (Task 2.7). Still not wired (checked 2026-10-11):
- `FullyOperational.jsx`: the **Demand Overview chart**, **Top Best Sellers** and **Top Ingredients to Prepare**.

Wiring them needs decisions first: the Performance Ratio date default, and a chart-range endpoint.

No longer open: `ForecastsReady.jsx` (the "forecasts ready, recipes pending" state) now reads its counts from the API (`mapping` from `/upload/dashboard-state`, plus `/mapping/products`), lists the products still missing a recipe, shows "—" when a count is unknown, and its buttons go to Forecasting, Product Performance and Inventory Management.

### 7. The "Data Needs Attention" stale message
Since 2026-10-06, `staleDays` on this screen means **missing expected operating days** (days the store should have been open with no upload and no closed mark), not calendar days. The screen text still says "is N days behind today". That's close, but "N operating days have no upload" would be more accurate. Text change only.

### 8. "Mark a single day closed" has no everyday UI
`POST /api/business-days/close` exists, but nothing in the app calls it. The one-time history review only handles dates inside the sales history. A normal day off after the last upload can only be resolved by uploading, or by the operating days in Business Profile. This is the planned "operating calendar".

---

## Process and repo hygiene

### 13. Client data and a schema dump are committed to the repo
- **What:** `ml-service/reports/output/` (`training_report.html`, `accuracy_experiment_summary.md`, `regularization_search_log.csv`) contains ChefDuo's sales figures and per-product results, and `backend/database_schema.csv` is a full schema dump. Both are tracked by git, so they are on GitHub.
- **Risk:** low to moderate. The client's business numbers sit in the repository history, visible to anyone with repo access, and the schema dump makes the database layout easy to study.
- **Fix later (post-defense):** add both paths to `.gitignore`, then `git rm --cached` them (this removes them from future commits, not from history). If the repository is or becomes public, consider rewriting history to remove them, and agree that with the client.

### 14. No CI: nothing builds or tests on push
- **What:** there is no GitHub Actions workflow. Nothing runs the build, the backend tests or the frontend tests before a merge. Unresolved merge-conflict markers once reached `staging` (in `App.jsx` and 4 dashboard state files); fixed in `9435440`.
- **Risk:** moderate. A broken build or failing test can be merged and deployed without anyone noticing until a page breaks in production.
- **Fix later (post-defense):** a GitHub Actions workflow on every push and pull request that runs `npm ci`, the frontend build and lint (fail on new errors), `node --test tests/*.test.js tests/*.test.mjs` in `backend/`, the plain-Node tests in `frontend/tests/`, the Python tests in `ml-service/tests/`, and a merge-marker check (`git grep -nE '^(<<<<<<<|=======|>>>>>>>)( |$)'`). Then protect `staging`/`main`: require the workflow to pass and turn on **"Require review from Code Owners"**.
