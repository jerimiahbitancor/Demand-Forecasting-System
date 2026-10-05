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

- Supabase API requests per minute with only the dashboard open: `TO FILL BY OWNER`
- Railway deployed commit hash, api service: `TO FILL BY OWNER`
- Railway deployed commit hash, ml service: `TO FILL BY OWNER`
- Memory per service (api / ml): `TO FILL BY OWNER`
- Railway trial end date: `TO FILL BY OWNER`
- Latest `model_metrics` row (version, date, wmape, baseline_wmape): `TO FILL BY OWNER`
- Last 5 `forecast_runs` (run_at, run_type, stale_days): `TO FILL BY OWNER`
- Forecast rows for today: `TO FILL BY OWNER`
- **`docs/baseline/dashboard-state-before.json`**: paste the full JSON response of `/api/upload/dashboard-state`, copied from DevTools. It is used to prove that Task 1.12 returns the same answer. `TO FILL BY OWNER`
