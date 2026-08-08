# Project Snapshot — Demand-Forecasting-System

**Generated:** factual snapshot of the repository state (backend + frontend)

**TECH STACK**
- **Backend:** Node.js + Express (express ^4.18.2), @supabase/supabase-js, dotenv, helmet, cors, express-rate-limit, multer, clamdjs, nodemailer, csv-parser, xlsx, dayjs, jsonwebtoken.
- **Frontend:** React (react ^19.2.6) with Vite (vite ^8.0.16), react-router-dom (v7), @supabase/supabase-js, axios, sweetalert2, recharts, react-hot-toast.
- **Database:** Supabase (Postgres). DB accessed via Supabase client (anon + service-role admin).

**FOLDER STRUCTURE (important files)**
- **backend/**: server and API logic, Supabase config, controllers, services, middleware, routes. See [backend/server.js](backend/server.js), [backend/config/supabase.js](backend/config/supabase.js).
- **frontend/**: Vite + React app, `src` holds pages, components, services and auth context. See [frontend/src/context/AuthContext.jsx](frontend/src/context/AuthContext.jsx) and [frontend/src/config/supabase.js](frontend/src/config/supabase.js).

**DATABASE SCHEMA (source: backend/schema.txt)**
- **Primary tables**: `users`, `business_profile`, `forecast_config`, `system_actions_log`, `products`, `ingredients`, `product_ingredients`, `fixed_holidays`, `special_holidays`, `uploads`, `daily_sales`, `forecasts`, `model_metrics`, `product_classifications`, `notifications`, `password_resets`, `email_verifications`.
- **Notes:** full SQL listing is in [backend/schema.txt](backend/schema.txt). Key relations: `products.user_id -> users.id`, `product_ingredients` links `products.id` and `ingredients.id`, `daily_sales.product_id -> products.id`, `uploads.user_id -> users.id`, `email_verifications.user_id -> users.id`, `password_resets.user_id -> users.id`.

**API ENDPOINTS / ROUTES (high-level)**
- Auth routes ([backend/routes/auth.js](backend/routes/auth.js)):
  - POST `/api/auth/register` — register (creates custom `users` row, sends OTP).
  - POST `/api/auth/verify-otp` — verify OTP stored in `email_verifications`.
  - POST `/api/auth/create-password` — create Supabase Auth user via service-role, link `auth_id`, attempt auto-login.
  - POST `/api/auth/resend-otp` — resend/update OTP.
  - POST `/api/auth/sync-user` — create or sync custom `users` from Supabase Auth (protected via `authenticate`).
  - GET `/api/auth/setup` — check if any verified custom user exists.
  - Password-reset endpoints: `POST /api/auth/forgot-password/send-code`, `/verify-code`, `/reset-password` (implemented via controller).
- Mapping / Product routes ([backend/routes/mapping.js](backend/routes/mapping.js)):
  - GET `/api/mapping/products`, GET `/api/mapping/products/:id`, POST/PUT/DELETE `/api/mapping/products` — product CRUD, ingredient mappings.
  - POST `/api/mapping/products/:id/archive` and `/reactivate` — archive/reactivate flows.
  - GET `/api/mapping/categories`, `/stats`, `/search`, `/refresh`, `/archive-reasons`.
- Upload / Uploads routes ([backend/routes/upload.js](backend/routes/upload.js), [backend/routes/uploads.js](backend/routes/uploads.js)):
  - POST `/api/upload` — file upload pipeline (multer -> validate -> virus scan -> process), used for menu/sales ingestion.
  - GET/PUT/DELETE and status endpoints under `/api/uploads` (list, detail, summary stats, check duplicate).
- Users & admin ([backend/routes/users.js](backend/routes/users.js)):
  - GET `/api/users`, GET/PUT/DELETE `/api/users/:id` (protected).

Authentication & Authorization (server-side)
- `authenticate` middleware ([backend/middleware/auth.js](backend/middleware/auth.js)):
  - Validates `Authorization: Bearer <token>` by calling `supabase.auth.getUser(token)`.
  - Ensures/creates a custom `users` row (queries `users` table by `auth_id` or creates one via `supabase.from('users')`).
  - Attaches `req.user` (custom user), `req.authUser` (supabase auth user) and `req.accessToken` to requests.
- Registration flow (summary):
  1. Frontend calls `POST /api/auth/register` -> backend creates `users` row and writes `email_verifications` with OTP.
  2. User verifies OTP via `POST /api/auth/verify-otp` (marks verification row `is_used = true`).
  3. Frontend calls `POST /api/auth/create-password` -> backend uses `supabaseAdmin.auth.admin.createUser` to create the Auth user, updates `users.auth_id`, sets `is_verified`.
  4. `sync-user` endpoint creates a custom user record if an Auth-only user exists.

**Frontend structure & logic**
- Auth: `frontend/src/context/AuthContext.jsx` orchestrates register → verify → create-password flows, keeps `registrationData` and subscribes to Supabase auth changes.
- Pages and routing: `frontend/src/App.jsx` defines routes for landing, register/login, data-management, dashboard, analytics, forecasting and settings.
- API client: `frontend/src/services/authService.js` uses client-side `supabase` for auth operations plus fetch to backend at `API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'`.
- Setup & guards: `useSetupGuard` uses `/auth/setup` plus supabase session to decide entry flow. A temporary bypass is available via `VITE_ENABLE_TEMP_ACCESS_BYPASS` controlled in [frontend/src/config/accessControl.js](frontend/src/config/accessControl.js).

**ENV & CONFIG**
- Backend env vars used in code: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL` (CORS). See [backend/config/supabase.js](backend/config/supabase.js) and [backend/server.js](backend/server.js).
- Frontend env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_ENABLE_TEMP_ACCESS_BYPASS`. See [frontend/src/config/supabase.js](frontend/src/config/supabase.js) and [frontend/src/config/accessControl.js](frontend/src/config/accessControl.js).

**CURRENT GAPS / INCONSISTENCIES / NOTES**
- Notifications table FK: `notifications.user_id` references `auth.users(id)` while app custom users are in `public.users` — possible type/namespace mismatch to review in DB model.
- `products.inactive_reason` in schema is `USER-DEFINED` (non-standard type) — check actual DB DDL for correctness.
- Many multi-step DB operations are not wrapped in transactions (Supabase JS lacks cross-table transactions), code uses manual rollbacks (e.g., product create/delete flow) — be cautious of partial failures.
- OTP & verification: flow marks `email_verifications.is_used = true` on verify and `create-password` checks the `used_at` timestamp for recency; timing edge cases may require tightening.
- Auto-login after `create-password` can fail; controller returns `requiresLogin` when sign-in fails. Frontend handles both flows but contains fallback delays and checks for session existence.
- Some error objects (from Supabase) are logged but not always guarded for null/undefined properties — review error handling for robust production behavior.

**WHERE TO LOOK (key files)**
- Backend: [backend/server.js](backend/server.js), [backend/config/supabase.js](backend/config/supabase.js), [backend/middleware/auth.js](backend/middleware/auth.js), [backend/routes/auth.js](backend/routes/auth.js), [backend/routes/mapping.js](backend/routes/mapping.js), [backend/controllers/product_controller.js](backend/controllers/product_controller.js), [backend/services/otpService.js](backend/services/otpService.js), [backend/schema.txt](backend/schema.txt).
- Frontend: [frontend/src/context/AuthContext.jsx](frontend/src/context/AuthContext.jsx), [frontend/src/services/authService.js](frontend/src/services/authService.js), [frontend/src/config/supabase.js](frontend/src/config/supabase.js), [frontend/src/hooks/useSetupGuard.js](frontend/src/hooks/useSetupGuard.js), [frontend/src/config/accessControl.js](frontend/src/config/accessControl.js), [frontend/src/App.jsx](frontend/src/App.jsx).

If you want, I can now:
- Run a repo-wide search for any remaining direct DB queries, or
- Commit this file and/or open a PR with the snapshot, or
- Expand any section with more code excerpts or exact request/response JSON examples.
