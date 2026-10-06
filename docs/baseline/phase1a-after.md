# Phase 1A results (backend deployed to Railway)

Measured by the owner from Railway logs, 2026-10-05 21:01–21:10 UTC, on the new backend.

## What the logs show

- Every request has a JSON access line with a `requestId`.
- CORS preflight: **204**, under 1 ms.
- **No 429s.** No errors from the new code.

## `GET /api/upload/dashboard-state` server time

83 samples, from the access log's `duration_ms`.

| | Before (Phase 0) | After 1A |
|---|---|---|
| Typical | — | **~260 ms** (median) |
| 95% of checks under | — | **~650 ms** |
| Fastest | 0.3 s | — |
| Slowest | **4.93 s** | **1.315 s** (first check after deploy, empty cache) |

## Same answer as before

`dashboard-state-after-1A.json` was captured from the new backend before the 2026-09-29 upload. It was compared with `dashboard-state-before.json` using the Phase 0 rule: ignore only `stats.days_of_history`, `stats.months_uploaded` and `stats.last_sync`.

Result: **MATCH.**

After the comparison, the owner uploaded `item-sales-summary-2026-09-29` (uploads 335 → 336). That change is expected and happened after the check.

## Supabase calls per dashboard check

From the old-vs-new test on a fake database of production size (~17.8k sales rows). The test is kept as `backend/tests/dashboardStateEquivalence.test.js`.

| State | Before | After, first check after data changes | After, all other checks |
|---|---|---|---|
| Uploaded Insufficient | 43 | 48 | **9** (in parallel) |
| Fully Operational | 28 | 33 | **14** |

## Still to fill by owner

- Railway deployed commit hashes (api, ml): `TO FILL BY OWNER`
