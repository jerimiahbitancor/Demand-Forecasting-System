# Phase 2 after-evidence

Same sections as `phase0-baseline.md`, measured after Phases 1 and 2.
Recorded: Oct 6, 2026. Branch `phase0_2`. Baseline tag `baseline-pre-hardening` @ `5da177b`.

## 1. Before / after

| What | Before (Phase 0) | After | Source |
|---|---|---|---|
| Dashboard re-checks | every **5 s**, also in a hidden tab | every **60 s**, one at a time, **paused** in a hidden tab | code + owner's browser checks |
| Requests/min, Uploaded Insufficient screen | ~30 (+2 bell) | **~6** (dashboard 1, screen check 1, products 2, bell 2) | code |
| Production rate limit | 100 per 15 min for everything; the owner got **429s** with only the dashboard open | 600 per 15 min (API) + 20 per 15 min (OTP/password POSTs only) | config |
| Supabase calls per dashboard check, Uploaded Insufficient | **43** | **9** (cached), **14** (cache refill) | equivalence test, production-size fake |
| Supabase calls per check, Fully Operational | 28 | 15 (cached: 14 + 1 `business_profile` read for the stale rule) | equivalence test |
| `dashboard-state`, **browser time, Manila to Railway** | 0.3–**4.93 s** | normal checks **0.9–1.6 s** | owner's HAR, 2026-10-06 |
| … first load after a redeploy (cold cache) | **10.1 s** | **2.1 s** | owner's HAR |
| … first check after an upload (cache refill) | **9.6 s** | **1.1 s** | owner's HAR |
| `dashboard-state` server time (`duration_ms`) | — | median ~260 ms, 95% under ~650 ms, max 1,315 ms (Phase 1A, before the view) | Railway logs, 83 samples |
| Request IDs | none | on every response (`X-Request-ID`), in every log line, shown as "Ref" on error screens | code + HAR |
| A failed check | showed "No Data" / "Uploaded Insufficient" | ConnectionProblem screen, or a banner over the last good state | code |
| Health overview | `/health` only ("process is up") | `/admin/health`: 6 checks with reasons | code |

## 2. Answer equivalence

- `dashboard-state-before.json` vs `dashboard-state-after-1A.json` (production): **MATCH** under the Phase 0 rule (ignore only `stats.days_of_history`, `stats.months_uploaded`, `stats.last_sync`).
- Since Phase 1A, every change to the dashboard's answers is either proven identical or a **deliberate, owner-approved change**:
  - **Proven identical:** `backend/tests/dashboardStateEquivalence.test.js` compares the new code with the baseline code (copied in the test word for word). It covers 16 state scenarios and 4 between-check data changes, each run **with the `daily_sales_date_summary` view and without it**.
  - **Deliberate change (Task 2.10):** "stale" now counts **missing expected operating days**, not `forecast_runs.stale_days`. A closed day such as a normal Sunday no longer makes the dashboard say "Data Needs Attention". The raw number is still returned as `rawStaleDays`. The test asserts that everything else (including `isStale` and the state) still matches the baseline.
- **Owner check still to do:** after deploying Phase 2, compare a fresh production `dashboard-state` with `dashboard-state-after-1A.json`. Expect the same `state`, `history` and `stats` (allowing for the 2026-09-29 upload, closed days, and training done since then). In an attention state, also expect the new `rawStaleDays` / `missingOperatingDays` / `operatingDaysSource`. `TO FILL BY OWNER`

## 3. Database changes (owner-run, 2026-10-06)

`backend/sql/2026-10-06_daily_sales_date_summary.sql`, run by the owner:
- `view_dates 340 = distinct_sale_dates 340`; `view_rows_total 17573 = daily_sales_rows 17573`
- `daily_sales_date_summary`: `security_invoker = true`, `anon_can_read = false`, `authenticated_can_read = false`
- `product_sales_summary`: `anon_can_read = false`, `authenticated_can_read = false` (`security_invoker` not set: listed in `docs/known-gaps.md` as a post-defense item)
- Schema dump confirms `daily_sales_sale_date_idx` and `daily_sales_date_summary` exist.

## 4. Tests, build, lint

| Check | Phase 0 | Now |
|---|---|---|
| Backend tests (`node --test tests/*.test.js tests/*.test.mjs`) | 8 files pass | **129 pass, 0 fail** |
| Frontend tests (plain Node) | 18 (`uploadRunState`) | **122**: `uploadRunState` 18, `apiError` 40, `poller` 29, `appEvents` 24, `apiBase` 11 |
| Frontend build | pass | **pass** |
| Frontend lint | 108 errors, 9 warnings | **108 errors, 6 warnings**. No new problems (compared problem by problem). 3 old `exhaustive-deps` warnings removed. |

## 5. Protected files

```
$ git log --format='%h %s' baseline-pre-hardening..HEAD -- ml-service/ backend/routes/upload.js \
    backend/utils/salesModifiers.js frontend/src/features/datamanagement/ backend/routes/auth.js \
    backend/utils/otpAttemptLimiter.js backend/services/businessDayService.js backend/services/mlService.js \
    backend/routes/ml.js backend/utils/historyGate.js backend/controllers/passwordResetController.js
fc63bda Dashboard loading fix

$ git diff baseline-pre-hardening HEAD -- backend/package.json frontend/package.json '*package-lock.json'
(empty)
```

`fc63bda "Dashboard loading fix"` is **the owner's own commit** (2026-10-06 20:05 +0800, made on this branch between Tasks 2.0 and 2.2). It holds only the owner's training-report work:
`ml-service/reports/generate_training_report.py`, `ml-service/reports/output/training_report.html`, `ml-service/tests/test_report_no_common_products.py`.
Those were the owner's uncommitted local changes, outside this work. **No commit made in this hardening work touches a protected path**: `fc63bda` is the only commit in `baseline-pre-hardening..HEAD` without the Claude co-author line.

`backend/database_schema.csv` has uncommitted local changes from the owner's schema dump. Not part of this work; left unstaged.

## 6. Oct 7 production check (owner HAR, 12:23 Manila)

Deployed api commit: **`9435440`** (the `staging` merge of `phase0_2`).

| What | Result |
|---|---|
| `GET /api/upload/dashboard-state` | **1.7 s** browser time. State **`data-needs-attention`**, for **low accuracy only**: the model does not beat the 7-day average (accuracy **65.58** vs **66.49**). **`missingOperatingDays` 0**, so the closed Sunday no longer counts as stale (Task 2.10 working as intended). |
| `GET /api/status` overall | **`degraded`** |
| `server` check | **warn**: p95 **3.0 s** over the last 5 minutes (threshold 2.0 s) |
| `mlService` check | **failed twice** (hit the 3 s check timeout), then **ok in 618 ms** with **`networkType: public`** |
| Errors | **No 5xx, no 429** |

What this shows:
- The dashboard's answer is honest: the only attention reason is model quality, which is real (the model's error is higher than the 7-day average's on the same test rows), not a stale-data false alarm.
- **The ML service is reached through its public URL.** The status page warns about this on purpose: long ML calls through the public edge can be cut. Switch `ML_SERVICE_URL` on the `api` service to the private `*.railway.internal` address (`docs/deployment.md`). The two 3 s timeouts followed by a 618 ms answer look like the ML service waking up or a slow public round trip; the private network should make this steadier.
- **p95 of 3.0 s** is above the 2 s warning line. The slow paths already measured are in `docs/known-gaps.md` (Performance follow-up: upload 15.2 s, product-categories 5.9 s, analytics 2.3–3.8 s, inventory items 2.5–3.2 s), and a few of those requests in a 5-minute window are enough to push p95 over 2 s. Not an outage.

## 7. Production measurements still to fill (owner)

- Supabase API requests per minute with only the dashboard open (target: far below the Phase 0 ~85–500/min): `TO FILL BY OWNER`
- `dashboard-state` browser time, 10 samples after the Phase 2 deploy: `TO FILL BY OWNER`
- Railway request rate for `/api/upload/dashboard-state` (expect about 2/min with the dashboard open: parent + screen): `TO FILL BY OWNER`
- `/admin/health` screenshot after deploy (all six cards): `TO FILL BY OWNER`
- Railway deployed commit hashes: api `9435440` (Oct 7 check); ml `TO FILL BY OWNER`
