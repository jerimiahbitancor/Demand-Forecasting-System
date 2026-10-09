# Observability field guide

How to tell whether the system is healthy, and what to do when it isn't.
Written from the thresholds in `backend/services/statusService.js` (`THRESHOLDS`). If you change a number there, change it here too.
Last updated: Oct 6, 2026.

## Where to look

| Tool | What it shows | Who can see it |
|---|---|---|
| **`/admin/health`** (Settings → System Health) | Six checks, each green / yellow / red with a reason. Refreshes every 30 s. | Logged-in owner |
| `GET /api/status` | The same data as JSON. | Logged in (401 otherwise) |
| `GET /health` | `{"status":"OK","timestamp":...}`. Only says the API process is up. | Public (for Railway's health check) |
| **Railway logs** (`api` service) | One JSON line per request, plus warnings and errors. | Railway project members |
| Supabase API logs | Every database call. | Supabase project members |

The status report is **cached for 15 s**: refreshing faster shows the same "checked at" time. Each check gets **3 s**. A slower check fails on its own and doesn't hold up the others.

**Overall:** `ok` = all green. `degraded` = at least one yellow or red. `down` = the database check failed (nothing works without it).

## Each check: normal → warning → critical → what to do

### Database
| | Normal | Warning | Critical |
|---|---|---|---|
| Response time of a 1-row read | ≤ 500 ms | > 500 ms | > 1500 ms, an error, or no answer in 3 s |

**What to do:**
- **Warning:** usually short-lived. Watch for a few minutes.
- **Critical:** check the Supabase status page, then the Supabase project (paused? out of quota?). The whole app is effectively down until this is green.

### ML service
| | Normal | Warning | Critical |
|---|---|---|---|
| `GET <ml>/health` | HTTP 200 within 3 s, **private** network | HTTP 200 but `ML_SERVICE_URL` is a **public** URL | Not reachable, not HTTP 200, or no answer in 3 s |

The card shows only the network type (`private`, `public` or `local`), never the address.

**What to do:**
- **Public URL warning:** switch `ML_SERVICE_URL` on the `api` service to the private `http://<ml>.railway.internal:<port>` address. Long calls through the public edge can be cut after about 60 s.
- **Critical:** open the `ml` service on Railway. Is it crashed, out of memory (0.5 GB), or redeploying? Training and forecasting can't run until it's back. The rest of the app still works.

### Model and forecasts (`mlPipeline`)
Shows the model version, its training date, model WMAPE vs the 7-day average's WMAPE, whether it beats it, the last forecast run, missing operating days, and today's forecast rows.

| | Normal | Warning |
|---|---|---|
| Model | a model exists | no model trained yet |
| Beats the 7-day average | yes (or unknown: older model with no baseline) | **no**: "model does not beat the 7-day average (X% vs Y% WMAPE)" |
| Missing operating days | 0 | > 0: operating days since the last confirmed sales day with no upload and no closed mark |
| Forecast rows for today | > 0 | 0 while a model exists |

There is no "critical" here: the app still works, the forecasts are just less trustworthy.

**What to do:**
- **Does not beat the 7-day average:** known as of 2026-10-06 (32.3% vs 31.3%). It's a model-quality issue, not an outage. Don't retrain repeatedly hoping it changes; see the ML notes.
- **Missing operating days:** upload the missing day(s). If the store was closed, mark the day closed. If it's a regular day off, fix the operating days in Settings → Business Profile. (The raw `stale_days` from the forecast run is shown too, but it counts closed days, so a normal Sunday made it look stale.)
- **No forecasts for today:** check the Forecast schedule card. If the 9:00 AM run failed or hasn't run yet, use Analytics → Forecasting → Generate Forecast.

### Sales uploads
| | Normal | Warning |
|---|---|---|
| Failed uploads today (Manila date) | 0 | ≥ 1 |
| Oldest upload still `pending` | none, or ≤ 60 min | > 60 min |

**What to do:**
- **Failed:** Data Management → history shows the error per file. Fix the file and upload it again.
- **Pending > 60 min:** the request was probably cut off (e.g. by a redeploy). Its sales were usually not saved. Upload that file again. An old stuck row (e.g. one from 2026-10-01) keeps this warning on until it is deleted; that's a data operation for the owner.

### Forecast schedule
| | Normal | Warning |
|---|---|---|
| Last daily (9:00 AM) and weekly (Monday 9:00 AM) run, Asia/Manila | succeeded, or not run since the last restart | the last run **failed** (the reason is shown) |

**What to do:** read the error. If the ML service was down, check that card. Then run a forecast by hand (Analytics → Forecasting → Generate Forecast).

### API server
| | Normal | Warning |
|---|---|---|
| Memory (RSS) vs `MEMORY_LIMIT_MB` (default 512) | ≤ 80% | > 80% |
| Response time p95, last 5 min | ≤ 2000 ms | > 2000 ms |
| Server errors (5xx), last 5 min | 0 | ≥ 1 |

Also shown: uptime, request count, p50/p95/max, rate-limited (429) count, Node version, `NODE_ENV`, and the deployed commit (first 7 characters of `RAILWAY_GIT_COMMIT_SHA`, or `unknown`).

**What to do:**
- **Memory:** a slow climb over days suggests a leak. Redeploying resets it. Report it if it comes back.
- **p95:** find the slow paths in the logs (next section).
- **5xx:** search the logs for `"level":"error"` and read the `requestId`.

## Known risk: training time

On 2026-10-06 the first real training run took **88 s** (from the owner's browser HAR). gunicorn's limit is **120 s**. Training gets slower as data grows, so a future run could be killed halfway.

**Fix:** set the ML start command to
`gunicorn app:app --bind 0.0.0.0:$PORT --timeout 900 --workers 1 --threads 2`
(see `docs/deployment.md`). Even then, the API stops waiting after about **300 s** (Node `fetch` default; see `docs/known-gaps.md` #3).

## Finding one request in the logs

Every API response carries an **`X-Request-ID`** header. Error screens and banners show its first 8 characters as **"Ref: xxxxxxxx"**, and API error bodies include it as `requestId`.

1. Get the ID:
   - Owner sees "Ref: 1b53a296" on screen, or
   - DevTools → Network → the request → Response Headers → `X-Request-ID`.
2. Railway → `api` service → **Logs**. Search for the ID as **plain text** (the first 8 characters are enough). This always works, because every log line is one JSON line that includes `"requestId":"…"`.
3. You'll see the access line, for example:
   ```json
   {"ts":"2026-10-06T21:03:11.402Z","level":"warn","service":"api","msg":"request","requestId":"1b53a296-c2e3-463e-baf1-dc9a877b8472","method":"GET","path":"/api/upload/dashboard-state","status":429,"duration_ms":3.1,"aborted":false}
   ```
   Plus any warnings or errors logged while handling that request: they carry the same `requestId`.

Useful searches: `"level":"error"`, `"status":5` (5xx), `cors_rejected`, `auth_no_custom_user` (a valid login with no linked account — a security signal), `unhandled_error`.

The access log never includes query strings, emails or tokens. Values under keys like `password`, `token`, `otp`, `authorization` or `cookie` are replaced with `[hidden]`.

## Known limits

- **In-memory counters reset on restart.** Request stats (last 5 minutes), the scheduler's last runs, the dashboard cache and the "training in progress" flag live in the API process. A redeploy or crash clears them. The health page says "counters since last restart at HH:MM".
- **Logs are kept for 3 days** on Railway's Free plan. Copy anything you need for evidence before then.
- **One replica.** The caches and counters assume Railway runs exactly one `api` instance. With two, each would have its own numbers, and the dashboard cache would be filled twice.
- **The 15 s status cache** means a just-fixed problem can stay red for up to 15 s.
- **`/health` only proves the API process is up.** It does not touch the database or the ML service. Use `/admin/health` for the real picture.
