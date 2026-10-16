# Deployment

How the Demand Forecasting System is deployed, what each service needs, and how to roll back.
Last updated: Oct 17, 2026. (Hosting moved from Railway to Render in Oct 2026.)

## The three services

| Part | Where | What it is |
|---|---|---|
| Frontend | **Vercel** | React + Vite. Production plus a preview for each branch or PR. |
| API | **Render** web service (`demand-forecasting-system-wami.onrender.com`) | Node.js + Express (`backend/`). |
| ML service | **Render** web service (`demand-forecasting-system-1-6ozx.onrender.com`) | Python Flask (`ml-service/`), training and forecasting only. |
| Database + auth + model files | **Supabase** | Postgres, Supabase Auth, and the private Storage bucket `ml-models`. |

**Important:** Vercel previews and production use **the same API and the same database.** There is no staging database. Anything done on a preview site (uploads, closing days, training) changes production data.

Railway is **no longer used**. If an old Railway `api` service still exists, stop it or set `SCHEDULERS_ENABLED=false` there: two servers with the timed jobs on would both run every 4:00 / 7:00 / 9:00 job against the same database. The boot log line `boot_flags` and every reminder run log row (`host.service`) say which server ran a job.

### Render free plan: the server sleeps

A Render **free** web service stops after about 15 minutes with no incoming request and starts again on the next one (a "cold start", often 30-60 s). While it sleeps, **nothing inside it runs**: the in-process cron (node-cron) never fires at 4:00 / 7:00 AM, and node-cron never makes up a missed run. So on the free plan the upload reminders need an outside clock. See **Upload reminders at 4:00 / 7:00 AM** below. The other choice is a paid instance, which never sleeps.

The free plan also limits running hours per month across all free services, so do **not** keep the API awake around the clock with a ping every few minutes. Wake it only when a job is due.

## Vercel (frontend)

### Environment variables

| Name | Notes |
|---|---|
| `VITE_API_URL` | The API base URL, ending in `/api`. **Set for Production AND Preview** (done by the owner on 2026-10-06). |
| `VITE_SUPABASE_URL` | Supabase project URL. Used only for login (`supabase.auth.*`). |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key. It ships in the browser, so it must never be granted access to tables. |
| `VITE_ENABLE_TEMP_ACCESS_BYPASS` | **Must never be `true` in production.** It skips the login check. |

**Vite bakes `VITE_*` variables into the build.** Changing one in Vercel does nothing until you **redeploy**.

If `VITE_API_URL` is missing from a deployed build, the shared API client (`frontend/src/config/apiBase.js`) logs one console error:

> VITE_API_URL is not set for this build — set it in Vercel for this environment and redeploy

It then refuses every request. It does not call `localhost`. About 30 older files still have their own `localhost` fallback (see `docs/known-gaps.md`).

### SPA routing

`frontend/vercel.json` rewrites every path to `index.html`, so links like `/admin/health` work on refresh.

## Render: API (backend)

Start command: `npm start` (that is, `node server.js`).

### Variables (names only)

| Name | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production`. Also sets the default log level (`info`) and rate limits. |
| `PORT` | set by Render | |
| `SUPABASE_URL` | yes | |
| `SUPABASE_ANON_KEY` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role. Server-side only. |
| `ALLOWED_ORIGINS` | yes | Comma-separated exact origins, e.g. the production Vercel domain. |
| `ML_SERVICE_URL` | yes | The ML service URL, e.g. `https://demand-forecasting-system-1-6ozx.onrender.com`. |
| `ML_SERVICE_SHARED_SECRET` | yes | Same value as in the `ml` service. |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | yes | All email: OTP, password reset and reminder emails (`services/emailService.js`, 10 s timeout). `BREVO_SENDER_NAME` defaults to `ChefDuo`. **A Gmail sender address sent through Brevo can land in Spam** (Gmail's own DMARC rules); verifying a sender domain in Brevo fixes that. |
| `EMAIL_REMINDERS_ENABLED` | **set to `true` on the production host** | Also emails reminder notifications (upload reminders, unanswered days, stock shortfalls, and ONE daily restock email with the ingredient list) to `business_profile.business_email`. Per-ingredient stock alerts stay in the bell and are never emailed. Default `false`. One email per reminder, never one per user; an email failure never blocks the notification. Status messages (upload done, training, forecasts, prices) are never emailed. |
| `FRONTEND_URL` | recommended | The deployed frontend, e.g. `https://<your-app>.vercel.app`. The "Open ChefDuo" button in reminder emails links here. If unset, the first non-localhost entry of `ALLOWED_ORIGINS` is used. |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT` | no | Upload virus-scan settings. |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error`. Default `info` in production. |
| `RATE_LIMIT_AUTH_MAX` | no | Strict limit for OTP and password endpoints. Default 20 per 15 min per IP. |
| `RATE_LIMIT_API_MAX` | no | Limit for all other `/api` requests. Default 600 per 15 min per IP. |
| `MEMORY_LIMIT_MB` | no | Used by `/api/status` for the memory warning. Default 512. |
| `NETWORK_ATTEMPT_TIMEOUT_MS` | no | Per-address connect timeout. Default 5000. |
| `DEV_NOW_OVERRIDE` | **never in production** | Development only: fakes "today". |
| `RENDER_SERVICE_NAME` | set by Render | Recorded in the boot log and in each reminder run log row, so a second server running jobs is visible. (`/admin/health` still reads the Railway-only `RAILWAY_GIT_COMMIT_SHA` for the commit, so it shows no commit on Render.) |
| `SCHEDULERS_ENABLED` | **set to `true` on Render (this one server only)** | Turns the timed jobs on: forecasts (9:00 AM), upload reminders (4:00 / 7:00 AM), the DA price import and the low-stock refresh. Default: `true` only when `NODE_ENV=production`, otherwise `false`. Set it explicitly to `true` here so the jobs never depend on `NODE_ENV` alone. When off, the server logs one line saying so and System Health shows a warning. |
| `JOB_TRIGGER_SECRET` | **yes on the free plan** | A long random value (e.g. `openssl rand -hex 32`). Lets cron-job.org start the 4:00 / 7:00 AM reminder runs through `POST /api/jobs/upload-reminders`. Unset: that endpoint answers 404 and System Health warns. Keep it secret; it is never logged. |
| `PRODUCT_MERGE_ENABLED` | no | `true` allows `POST /api/products/:id/merge` (runs `merge_products()`). Default `false`: the request answers 403 `MERGE_DISABLED` and the database is never touched; preview and "Possible duplicates" still work, and the Merge into... button is shown disabled. Keep `false` until the merges are scheduled (after the defense). |

### What the server says about these at boot

Right after start the API logs one `boot_flags` line, for example:

```
SCHEDULERS_ENABLED=on EMAIL_REMINDERS_ENABLED=on brevo=configured JOB_TRIGGER_SECRET=set service=<render service name>
```

It is a **warning** whenever the timed jobs are on (only one server may run them) and lists problems such as "timed jobs are on but EMAIL_REMINDERS_ENABLED is off". About 5 s later a `boot_business_email` line says whether a valid business email is saved (masked, e.g. `n***@gmail.com`). Keys and secrets are never logged, only whether they are set. The same flags and warnings appear on `/admin/health` (Scheduler card).

### Upload reminders at 4:00 / 7:00 AM

A reminder run can start three ways. All three are safe together: the database dedupe (`notifications.metadata.key`) means one notification and one email per reminder, however many times a slot runs.

1. **cron**: node-cron inside the API. Works only while the server is awake.
2. **external**: `POST /api/jobs/upload-reminders?slot=0400` (or `0700`) with the header `X-Job-Secret: <JOB_TRIGGER_SECRET>`. No login. Answers `202` at once and runs in the background. `401` = wrong or missing secret, `404` = `JOB_TRIGGER_SECRET` unset, `409` = `SCHEDULERS_ENABLED` off, `400` = bad slot. At most 10 calls per 15 min per IP.
3. **boot**: about 20 s after the server starts, the **latest slot that applies** runs once if it has no run record today (Manila): 04:00-07:00 → 4:00; 07:00-09:00 → 7:00 only; after 09:00 → 4:00 only. The 7:00 reminder never goes out after 9:00 (its text says "before the forecast at 9:00 AM").

Every run writes one `audit_logs` row, `action_type = 'upload_reminder_run'`, with `details` as JSON: slot, Manila date, trigger, host, status, planned keys, sent, duplicates, and the email outcome per reminder (`sent`, `disabled`, `duplicate`, `not_configured`, `no_business_email`, `failed`). Filter by it in Settings > Audit Trail. `/admin/health` shows the newest row per slot.

#### cron-job.org setup (free)

Create an account at cron-job.org. In account settings set the time zone to **Asia/Manila**. Then create these seven jobs:

| Job | URL | When (Asia/Manila) | Method | Header |
|---|---|---|---|---|
| Wake-up before 4:00 (**recommended**) | `https://demand-forecasting-system-wami.onrender.com/health` | every day 03:55 | GET | none |
| Upload reminder 4:00 | `https://demand-forecasting-system-wami.onrender.com/api/jobs/upload-reminders?slot=0400` | every day 04:00 | **POST** | `X-Job-Secret` = the `JOB_TRIGGER_SECRET` value |
| Wake-up before 7:00 (**recommended**) | `https://demand-forecasting-system-wami.onrender.com/health` | every day 06:55 | GET | none |
| Upload reminder 7:00 | `https://demand-forecasting-system-wami.onrender.com/api/jobs/upload-reminders?slot=0700` | every day 07:00 | **POST** | `X-Job-Secret` = the `JOB_TRIGGER_SECRET` value |
| Wake-up API before 9:00 (**recommended**) | `https://demand-forecasting-system-wami.onrender.com/health` | every day 08:55 | GET | none |
| Wake-up ML before 9:00 (**recommended**) | `https://demand-forecasting-system-1-6ozx.onrender.com/health` | every day 08:55 | GET | none |
| Forecast 9:00 | `https://demand-forecasting-system-wami.onrender.com/api/jobs/forecast` | every day 09:00 | **POST** | `X-Job-Secret` = the `JOB_TRIGGER_SECRET` value |

For each POST job: open the **Advanced** tab, set Request method to `POST`, add the header under *Headers*, leave the request body empty, and turn on *Notify me when the job fails*. Schedule: *Custom*, every day, hour and minute as above.

Why the wake-ups: a cold start can take longer than cron-job.org waits for an answer. With the wake-up at 03:55 / 06:55 the POST reaches a warm server and gets its `202` in under a second. If a POST still times out, the server it woke runs the slot anyway through the boot catch-up.

### The 9:00 AM forecast

Same idea as the reminders. A forecast run starts from the in-process cron, from `POST /api/jobs/forecast` (same secret and answers as above; Monday runs the weekly 7-day forecast, other days the daily one), or from a boot catch-up after 9:00 AM. **`forecast_runs` is the record:** the external and boot runs skip when it already has a run at or after 9:00 AM today (Manila); an earlier manual run does not count. They also skip when no model is trained. Before the call they wake the ML service (`/health`). A cold-start failure (HTTP 429/502/503/504 from Render, or the network giving up) is retried **once** after 30 s; any other failure is not retried. Each external/boot attempt writes an `audit_logs` row `forecast_trigger_run`; once one has **failed** today, the boot catch-up stops trying that day (so a broken ML service does not mean one failure notification per wake-up). The cron-job.org call and a manual Generate Forecast still work.

After every successful forecast (scheduled, external, boot or manual) and after every sales upload, the stock alerts are refreshed.

### Stock alerts and the restock email

The bell's stock alerts use the **same status as Ingredient Management** (`services/stockAlertService.js`): out of stock (quantity 0), Critical (stock < 50% of today's forecast need incl. safety buffer), Low (< 100%), and, for ingredients with no forecast need, quantity <= `min_stock`. One bell alert per ingredient, plus one restock summary with the whole list.

The restock email goes out **at most once per Manila day** (database key `restock_summary:<YYYY-MM-DD>`, so restarts do not resend it), plus a second one only if a **new** ingredient becomes out of stock or Critical that day. It lists up to 15 ingredients (Out of stock, Critical, Low; then highest est. cost first), with "…and N more in the grocery list." after that. The button opens the Ingredient Demand page (`FRONTEND_URL` + `/ingredient-demand`). A failed send is not counted, so the next refresh tries again. The refresh runs after each forecast and upload, and every 6 hours as a fallback; only where `SCHEDULERS_ENABLED` is on.

Checking it works: after 4:00 AM, the bell has "Upload yesterday's sales" (if yesterday is not uploaded or marked closed), the Render log has `[uploadReminder] 0400 run done (external)`, and Audit Trail has an `upload_reminder_run` row. No reminder is planned when yesterday is already answered, is not an operating day, or no model has been trained yet; the run row then shows `planned: []`.

### Running the backend locally

`backend/.env` points at the **live** database. A local `npm run dev` has `NODE_ENV` unset, so `SCHEDULERS_ENABLED` defaults to `false`: it never sends reminders, runs forecasts or imports prices by itself. Do not set `SCHEDULERS_ENABLED=true` locally, and do not set `PRODUCT_MERGE_ENABLED=true` locally unless you mean to merge real products. Leave `EMAIL_REMINDERS_ENABLED` and `JOB_TRIGGER_SECRET` unset locally too (with `SCHEDULERS_ENABLED` off, the trigger endpoint answers 409 anyway). To check that email works, use Settings > Business Profile > **Send test reminder email**: it sends one sample to the saved business email even when reminders are off, at most 3 per 10 minutes.

## Render: ML service

### Start command

Set it in the ML service: **Settings → Start Command**. This overrides `ml-service/Procfile`, which still says `--timeout 120`.

```
gunicorn app:app --bind 0.0.0.0:$PORT --timeout 900 --workers 1 --threads 2
```

Why:
- **`--timeout 900`:** on 2026-10-06 the first real training run took **88 s**, against gunicorn's 120 s timeout. Training gets slower as sales data grows. Once a request passes the timeout, gunicorn kills the worker and the run is lost.
- **`--workers 1`:** each worker loads pandas and XGBoost into memory, and the service only has 0.5 GB. Two workers could run out of memory during training.
- **`--threads 2`:** one thread can answer `/health` while another runs a long `/train` or `/forecast`.

**There are other limits on top of gunicorn's:**
- **Express's call to the ML service has no timeout of its own**, so Node's built-in `fetch` default applies: it stops waiting for response headers after **300 s**. A training run longer than about 5 minutes fails on the API side even with gunicorn at 900 s.
- **Render's edge** sometimes answers the ML service with **HTTP 429** in about 0.5 s (Render, not Flask). `/forecast` retries once and logs Render's headers.
- **[CHECK]** On Render the ML service is called through its public `onrender.com` URL. Long requests through the public edge may be cut; this has not been measured on Render yet.

### Variables (names only)

| Name | Required | Notes |
|---|---|---|
| `PORT` | set by Render | |
| `SUPABASE_URL` | yes | |
| `SUPABASE_SERVICE_KEY` | yes | Service role key. **Different name from the api's `SUPABASE_SERVICE_ROLE_KEY`; same key.** |
| `ML_SERVICE_SHARED_SECRET` | yes | Same value as in `api`. |
| `SUPABASE_MODEL_BUCKET` | no | Default `ml-models`. |
| `MIN_TRAINING_OBSERVATIONS` | no | Default 28. Don't change without a reason. |
| `OFF_MENU_GAP_OPEN_DAYS` | no | Default 28. |
| `MODEL_DIR`, `ML_DEBUG` | no | Local and debug use. |

## CORS and preview URLs

The API allows:
1. The exact origins in `ALLOWED_ORIGINS`.
2. Vercel **preview hash URLs** for this project, matched by
   `^https://demand-forecasting-system-[a-z0-9]+-[a-z0-9]+\.vercel\.app$`.

So:
- ✅ `https://demand-forecasting-system-abc123xyz-teamname.vercel.app` (hash URL)
- ❌ **Git-branch URLs** such as `https://demand-forecasting-system-git-feature-x-teamname.vercel.app`: the branch part has dashes, so it doesn't match.
- ❌ **Team names with a dash** (e.g. `my-team`): the last part must be letters and digits only.

A refused origin gets `403 {"success":false,"error":"Origin not allowed"}`, and the API logs `cors_rejected` with the origin. To allow a branch URL, add it to `ALLOWED_ORIGINS`.

Browsers cache the preflight (OPTIONS) answer for 10 minutes (`Access-Control-Max-Age: 600`).

## Rolling back

### Render (API or ML service)
1. Open the service → **Events** (deploy history).
2. Find the last good deploy (the commit is shown).
3. Choose **Rollback** on it. Render redeploys that build.
4. Check `/health` (public) and `/admin/health` (logged in).

Variables are not part of a deployment. Rolling back the code does not undo a variable change; change it back by hand.

### Vercel (frontend)
1. Project → **Deployments**.
2. Find the last good production deployment.
3. Its menu (⋯) → **Promote to Production** (or **Instant Rollback**).

That reuses the old build, including the env variables baked into it.

### Code
The tag `baseline-pre-hardening` marks the code before the Oct 2026 hardening work. To bring back one file: `git checkout baseline-pre-hardening -- <path>`.

### Database
Rolling back code never rolls back data. Before any SQL script, export the affected table to CSV. Each script in `backend/sql/` and `ml-service/migrations/` has its own rollback section.

## After every deploy: quick check

1. `GET /health` → `{"status":"OK", ...}`.
2. Log in and open `/admin/health`. All six cards should be green, or yellow with a reason you already know.
3. Open the dashboard. In DevTools → Network, each request has an `X-Request-ID` header.
