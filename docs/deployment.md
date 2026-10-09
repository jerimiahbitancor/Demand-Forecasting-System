# Deployment

How the Demand Forecasting System is deployed, what each service needs, and how to roll back.
Last updated: Oct 6, 2026.

## The three services

| Part | Where | What it is |
|---|---|---|
| Frontend | **Vercel** | React + Vite. Production plus a preview for each branch or PR. |
| API | **Railway** service `api` | Node.js + Express (`backend/`). 1 replica, 0.5 GB RAM. |
| ML service | **Railway** service `ml` | Python Flask (`ml-service/`), training and forecasting only. 1 replica, 0.5 GB RAM. |
| Database + auth + model files | **Supabase** | Postgres, Supabase Auth, and the private Storage bucket `ml-models`. |

**Important:** Vercel previews and production use **the same API and the same database.** There is no staging database. Anything done on a preview site (uploads, closing days, training) changes production data.

The Railway trial started 2026-09-18. It ends on 2026-10-18, or sooner if the $5 credit runs out. After that the Free plan limits apply.

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

## Railway: `api` (backend)

Start command: `npm start` (that is, `node server.js`).

### Variables (names only)

| Name | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production`. Also sets the default log level (`info`) and rate limits. |
| `PORT` | set by Railway | |
| `SUPABASE_URL` | yes | |
| `SUPABASE_ANON_KEY` | yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role. Server-side only. |
| `ALLOWED_ORIGINS` | yes | Comma-separated exact origins, e.g. the production Vercel domain. |
| `ML_SERVICE_URL` | yes | Prefer the **private** address (`http://<ml-service>.railway.internal:<port>`). See below. |
| `ML_SERVICE_SHARED_SECRET` | yes | Same value as in the `ml` service. |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | yes | OTP and password-reset email. |
| `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT` | no | Upload virus-scan settings. |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error`. Default `info` in production. |
| `RATE_LIMIT_AUTH_MAX` | no | Strict limit for OTP and password endpoints. Default 20 per 15 min per IP. |
| `RATE_LIMIT_API_MAX` | no | Limit for all other `/api` requests. Default 600 per 15 min per IP. |
| `MEMORY_LIMIT_MB` | no | Used by `/api/status` for the memory warning. Default 512. |
| `NETWORK_ATTEMPT_TIMEOUT_MS` | no | Per-address connect timeout. Default 5000. |
| `DEV_NOW_OVERRIDE` | **never in production** | Development only: fakes "today". |
| `RAILWAY_GIT_COMMIT_SHA` | set by Railway | Shown on `/admin/health`. |

## Railway: `ml` (ML service)

### Start command: set this in Railway

Set it in the `ml` service: **Settings → Deploy → Custom Start Command**. This overrides `ml-service/Procfile`, which still says `--timeout 120`.

```
gunicorn app:app --bind 0.0.0.0:$PORT --timeout 900 --workers 1 --threads 2
```

Why:
- **`--timeout 900`:** on 2026-10-06 the first real training run took **88 s**, against gunicorn's 120 s timeout. Training gets slower as sales data grows. Once a request passes the timeout, gunicorn kills the worker and the run is lost.
- **`--workers 1`:** each worker loads pandas and XGBoost into memory, and the service only has 0.5 GB. Two workers could run out of memory during training.
- **`--threads 2`:** one thread can answer `/health` while another runs a long `/train` or `/forecast`.

**There are other limits on top of gunicorn's:**
- **Express's call to the ML service has no timeout of its own**, so Node's built-in `fetch` default applies: it stops waiting for response headers after **300 s**. A training run longer than about 5 minutes fails on the API side even with gunicorn at 900 s.
- **A public ML URL** goes through Railway's edge proxy, which can cut long requests (the status page warns: "public URL: long ML calls can be cut by the edge after ~60 s"). Use the private `*.railway.internal` address for `ML_SERVICE_URL`.

### Variables (names only)

| Name | Required | Notes |
|---|---|---|
| `PORT` | set by Railway | |
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

### Railway (api or ml)
1. Open the service → **Deployments**.
2. Find the last good deployment (the commit hash is shown).
3. Its menu (⋯) → **Redeploy**. Railway builds that exact commit again.
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
