# Phase 0 baseline (before hardening)

Recorded: Oct 6, 2026. Rollback point for Phases 1–2.

## 1. Rollback point

| Item | Value |
|---|---|
| Branch | `phase0_2` |
| Tag | `baseline-pre-hardening` (local only, not pushed) |
| Commit | `5da177bddab1427a2c4ada2209c397f343debc41` |

To go back: `git checkout baseline-pre-hardening -- <path>` for one file, or `git reset --hard baseline-pre-hardening` for everything.

## 2. Build, lint and tests (measured locally)

Node `v22.20.0`, Windows.

| Check | Command | Result |
|---|---|---|
| Backend tests | `cd backend && node --test tests/*.test.js tests/*.test.mjs` | **8 / 8 files pass**, 0 fail |
| Frontend build | `cd frontend && npm run build` | **Pass** (exit 0). One pre-existing warning: a chunk is larger than 500 kB. |
| Frontend lint | `cd frontend && npm run lint` | **Exit 1 — 117 problems (108 errors, 9 warnings).** All pre-existing. Phase 1 must not raise either number. |
| Upload run state test | `cd frontend && node tests/uploadRunState.test.mjs` | **18 PASS, 0 FAIL** |

Note on the backend command: the handoff says `node --test tests/`. On Node 22 that fails with `Cannot find module ...\backend\tests`, because Node 22 does not accept a folder there. The glob above runs the same 8 files. Each file is a plain script, so `node --test` counts one test per file.

`npm install` was run in both folders from the existing lockfiles. No `package.json` or lockfile changed.

## 3. Owner's production measurements (Oct 6, 2026)

Dashboard state at the time: **Uploaded Insufficient**.

- The dashboard re-checks every **5 s**, **also in a hidden tab**. Confirmed in the browser and in Supabase API logs.
- `GET /api/upload/dashboard-state` response time: **min 0.3 s, max 4.93 s**.
- `NODE_ENV` on the Railway api service: **production**. So the current rate limit is **100 requests / 15 min per IP**.

### Deployment

- Backend (api) and ml-service run on **Railway**: 1 replica each, **0.5 GB RAM per service**. Free plan limits apply after the trial. Frontend runs on Vercel.
- Railway trial started **2026-09-18**. It ends on **2026-10-18**, or sooner if the **$5 credit** runs out.

### ML state

- **0** `model_metrics` rows, **0** `forecast_runs`, **0** `forecasts`. No model has been trained yet.

### Supabase API log, 2026-10-05 18:35:39–18:37:43 UTC

228 requests, all HTTP 200.

- About **85 Supabase requests/min with the tab hidden**. Chrome throttled the background timers to once per minute, so the bursts land in the same second each minute.
- About **43 Supabase calls per dashboard check**. That includes two full paged reads of `daily_sales.sale_date`, 19 pages each: offsets 0 to 17000, plus an empty page at 17312.
- One check took about **4.6 s** from first call to last (60–120 ms per page, run one after another). This explains the measured 4.93 s maximum.
- **Two dashboard checks ran in the same seconds.** This is proof of overlap (bug #2).
- Estimate with the tab visible: about 12 checks/min × ~43 calls = **~500 Supabase calls/min**.

### Rate limit seen in production (2026-10-06)

- With only the dashboard open, some `dashboard-state` requests got **HTTP 429** `{"success":false,"error":"Too many requests, please try again later."}`. The production limit (100 / 15 min) blocks the only user.
- On a 429 the dashboard falls back to a business state (bug #1). A rate-limit error looks like real data.

### Production `dashboard-state` (from `dashboard-state-before.json`)

- `state`: `uploaded-insufficient`, `insufficientReason`: `unconfirmed`
- `spanDays` 446, `openDays` 335, `closedDays` 0, `unconfirmedDays` 111, `lastSaleDate` 2026-09-28

**Comparison rule for later phases:** ignore only `stats.days_of_history` and `stats.months_uploaded` (both depend on today's date) and `stats.last_sync` (it comes from an unordered query). Every other field, including `progress`, must match exactly. Compare only against production. The local database is not production.

## 4. Static analysis (from reading the code)

State: Uploaded Insufficient.

- About **46 Supabase calls per dashboard check** before a model exists (about 30 once a model exists). Most come from paging every `daily_sales.sale_date` row in `uploadService.getUploadStats()`, and again in `businessDayService.getHistoryCoverage()`.
- Browser polling on that screen, checked in the code:

| Source | Interval | Requests / min |
|---|---|---|
| `Dashboard.jsx` → `/upload/dashboard-state` | 5 s | 12 |
| `UploadedInsufficient.jsx` → upload progress | 5 s | 12 |
| `UploadedInsufficient.jsx` → products | 10 s | 6 |
| **Subtotal (dashboard screen)** | | **~30 / min ≈ 450 per 15 min** |
| `NotificationDropdown.jsx` → unread count (bell, if mounted) | 30 s | 2 |

450 per 15 min is **4.5×** the production limit of 100. None of these pause in a hidden tab.

`TrainingInProgress.jsx` polls even harder: 5 s, 3 s and 10 s (~38 / min).

## 5. To fill by owner

- Railway deployed commit hash, api service: `TO FILL BY OWNER`
- Railway deployed commit hash, ml service: `TO FILL BY OWNER`

Filled above: Supabase request rate, memory, trial dates, ML state, and `dashboard-state-before.json` (production, HTTP 200).
