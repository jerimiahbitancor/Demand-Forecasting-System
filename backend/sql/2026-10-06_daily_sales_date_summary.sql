-- 2026-10-06_daily_sales_date_summary.sql
--
-- WHAT: one index and one view.
--   - daily_sales_sale_date_idx: an index on daily_sales(sale_date).
--   - daily_sales_date_summary: one row per sale date with how many sales
--     rows it has. About 450 rows instead of about 17,800.
--
-- WHY: the dashboard needs "which dates have sales?" twice per check (to
-- count sale days, and for the 12-month history rule). The backend used to
-- download every daily_sales.sale_date row to work it out: 19 pages, one
-- after another, twice. After a redeploy or after closing days, that check
-- took about 10 s (production HAR, Oct 6 2026). With this view it reads
-- about 450 rows in 1 page.
--
-- WHO READS IT: backend/services/dataCoverageService.js (getSaleDateSummary).
-- Until this script is run, the backend falls back to the old paged scan
-- and logs a warning once. Deploying the code first is safe; the dashboard
-- just stays slow after a cache refill.
--
-- SECURITY: a new view in the public schema is readable by the anon role
-- by default, and a normal view runs with its owner's rights, which skips
-- row-level security on daily_sales. Together that would let the anon key
-- (it ships in the browser) read sales data. So:
--   1. security_invoker = true: the view runs with the CALLER's rights.
--   2. REVOKE from anon and authenticated; GRANT only to service_role.
--
-- NO DATA IS CHANGED. A view stores nothing; an index only speeds reads.
-- Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE; grants are idempotent.
--
-- HOW TO RUN (owner, Supabase SQL editor):
--   0. Export daily_sales to CSV first (Table editor -> daily_sales -> Export).
--   1. Run the BEGIN ... COMMIT block below.
--   2. Run the CHECK query at the bottom. Both numbers must be equal, and
--      anon_can_read / authenticated_can_read must both be false.
--   3. Redeploy the api on Railway (not strictly needed; the next dashboard
--      check after the cache expires will use the view).
-- To undo, run the ROLLBACK SECTION (commented out at the end).

begin;

-- Building an index locks writes to daily_sales for a moment (about 17,800
-- rows: well under a second). Do not run during a bulk upload.
create index if not exists daily_sales_sale_date_idx
  on public.daily_sales (sale_date);

create or replace view public.daily_sales_date_summary
  with (security_invoker = true)
as
  select sale_date, count(*)::int as sale_rows
  from public.daily_sales
  group by sale_date;

comment on view public.daily_sales_date_summary is
  'One row per sale date (sale_rows = daily_sales rows on that date). Read by backend/services/dataCoverageService.js. Created by backend/sql/2026-10-06_daily_sales_date_summary.sql.';

revoke all on public.daily_sales_date_summary from anon, authenticated;
grant select on public.daily_sales_date_summary to service_role;

commit;


-- ============================ CHECK (read-only) ============================
-- Run after the block above. Expect:
--   view_dates = distinct_sale_dates
--   anon_can_read = false, authenticated_can_read = false
--   security_invoker = true

select
  (select count(*) from public.daily_sales_date_summary)          as view_dates,
  (select count(distinct sale_date) from public.daily_sales)      as distinct_sale_dates,
  (select sum(sale_rows) from public.daily_sales_date_summary)    as view_rows_total,
  (select count(*) from public.daily_sales)                       as daily_sales_rows,
  has_table_privilege('anon', 'public.daily_sales_date_summary', 'select')          as anon_can_read,
  has_table_privilege('authenticated', 'public.daily_sales_date_summary', 'select') as authenticated_can_read,
  (select coalesce('security_invoker=true' = any(c.reloptions), false)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'daily_sales_date_summary')        as security_invoker;


-- ============================ ROLLBACK SECTION ============================
-- Only if you need to undo this script. Nothing else depends on the view in
-- the database; the backend falls back to its old (slow) scan by itself.
--
-- begin;
-- drop view if exists public.daily_sales_date_summary;
-- drop index if exists public.daily_sales_sale_date_idx;
-- commit;
