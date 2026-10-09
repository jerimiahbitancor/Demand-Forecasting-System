# Known gaps

Things we know about, decided not to fix right now, and how to fix them later.
Each entry says what it is, why it was accepted, the risk, and the fix.
Last updated: Oct 6, 2026.

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
These used to show invented numbers. Since 2026-10-06 they say "Not available yet" (Task 2.7):
- `FullyOperational.jsx`: the Demand Overview chart, Top Best Sellers, Top Ingredients to Prepare.
- `ForecastsReady.jsx` (the "forecasts ready, recipes pending" state): all four cards. Its two buttons ("View Full Forecast", "Export Report") still do nothing, and the screen does not yet say which recipes are pending, although the API already returns `mapping: { unmappedCount, activeCount }` for this state.

Wiring them needs decisions first: the Performance Ratio date default, and a chart-range endpoint.

### 7. The "Data Needs Attention" stale message
Since 2026-10-06, `staleDays` on this screen means **missing expected operating days** (days the store should have been open with no upload and no closed mark), not calendar days. The screen text still says "is N days behind today". That's close, but "N operating days have no upload" would be more accurate. Text change only.

### 8. "Mark a single day closed" has no everyday UI
`POST /api/business-days/close` exists, but nothing in the app calls it. The one-time history review only handles dates inside the sales history. A normal day off after the last upload can only be resolved by uploading, or by the operating days in Business Profile. This is the planned "operating calendar".
