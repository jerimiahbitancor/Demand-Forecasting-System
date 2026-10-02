-- 009_add_product_sales_summary_view.sql
--
-- WHAT: a view that answers "when did each product first and last sell?"
-- inside the database, returning ONE row per product (~130 rows) instead of
-- making the backend download every daily_sales row (~15,000+) to work it out.
--
-- WHY: after every single sales upload the backend recomputes product status
-- (Active / New / Discontinued), which needs each product's last sale date.
-- It used to read the whole table to find them. Once that read was paged
-- correctly (the old unpaged read silently saw only the newest 1,000 rows),
-- it cost ~16 requests per upload, ~4,600 across a 288-file backfill, with
-- up to 5 uploads running at once. That exhausted the connection pool and
-- showed up as "TypeError: fetch failed" / HTTP 500 during bulk upload.
-- This view makes it 1 query.
--
-- WHO READS IT: backend/utils/productSalesSummary.js, used by
--   mappingService (3 places), analyticsService (1), uploadService (1).
-- Until this migration is run the backend falls back to the slow paged scan
-- and logs a warning once, so deploying the code first is safe -- uploads
-- just stay slow.
--
-- SECURITY -- read this: a new view in the public schema is, by default,
-- readable by the anon role through the REST API, and a normal view runs
-- with its OWNER's rights, which bypasses the row-level security on
-- daily_sales. Together that would let anyone holding the (public, shipped
-- in the browser) anon key read sales aggregates -- breaking the project's
-- "Express is the only way in" rule. So this script does two things:
--   1. security_invoker = true  -> the view runs with the CALLER's rights,
--      so RLS applies exactly as it does on the table itself.
--   2. REVOKE from anon and authenticated; GRANT only to service_role.
-- security_invoker needs Postgres 15+ (every current Supabase project). If
-- it errors with "unrecognized parameter", delete that one WITH line and
-- keep the REVOKE -- the revoke alone already blocks anon.
--
-- SAFE TO RE-RUN: CREATE OR REPLACE VIEW; grants are idempotent.
-- NO DATA IS CHANGED. A view stores nothing.
--
-- HOW TO RUN (Supabase SQL editor), in this order:
--   1. Run STEP 1. It creates the view inside a transaction, prints the
--      checks, and ends in ROLLBACK, so nothing is saved. Every check
--      should read as noted next to it.
--   2. Run STEP 2 (the real thing). Then run STEP 3 once, to confirm.

-- ===========================================================================
-- STEP 1 -- DRY RUN (nothing is kept; ends in ROLLBACK)
-- ===========================================================================
begin;

create or replace view public.product_sales_summary
with (security_invoker = true) as
select
  product_id,
  min(sale_date)  as first_sale_date,
  max(sale_date)  as last_sale_date,
  count(*)::int   as sale_rows
from public.daily_sales
group by product_id;

revoke all on public.product_sales_summary from anon, authenticated;
grant select on public.product_sales_summary to service_role;

-- CHECK A: the view must agree with a direct aggregate. EXPECT: 0 rows.
-- (On an empty daily_sales this is trivially 0 -- repeat STEP 3 after you
-- have re-uploaded real data, which is the meaningful run.)
select s.product_id, s.first_sale_date, d.first_d, s.last_sale_date, d.last_d
from public.product_sales_summary s
join (
  select product_id, min(sale_date) as first_d, max(sale_date) as last_d
  from public.daily_sales group by product_id
) d using (product_id)
where s.first_sale_date <> d.first_d or s.last_sale_date <> d.last_d;

-- CHECK B: anon must NOT be able to read it. EXPECT: false, false.
select
  has_table_privilege('anon', 'public.product_sales_summary', 'select')          as anon_can_read,
  has_table_privilege('authenticated', 'public.product_sales_summary', 'select') as authenticated_can_read;

-- CHECK C: the backend can. EXPECT: true.
select has_table_privilege('service_role', 'public.product_sales_summary', 'select') as service_role_can_read;

rollback;

-- ===========================================================================
-- STEP 2 -- CREATE IT FOR REAL
-- ===========================================================================
create or replace view public.product_sales_summary
with (security_invoker = true) as
select
  product_id,
  min(sale_date)  as first_sale_date,
  max(sale_date)  as last_sale_date,
  count(*)::int   as sale_rows
from public.daily_sales
group by product_id;

revoke all on public.product_sales_summary from anon, authenticated;
grant select on public.product_sales_summary to service_role;

-- ===========================================================================
-- STEP 3 -- CONFIRM (read-only; run after STEP 2, and again after re-upload)
-- ===========================================================================
-- EXPECT: anon_can_read = false, authenticated_can_read = false,
--         service_role_can_read = true, mismatches = 0.
select
  has_table_privilege('anon', 'public.product_sales_summary', 'select')          as anon_can_read,
  has_table_privilege('authenticated', 'public.product_sales_summary', 'select') as authenticated_can_read,
  has_table_privilege('service_role', 'public.product_sales_summary', 'select')  as service_role_can_read,
  (select count(*) from public.product_sales_summary s
     join (select product_id, min(sale_date) f, max(sale_date) l
           from public.daily_sales group by product_id) d using (product_id)
    where s.first_sale_date <> d.f or s.last_sale_date <> d.l)                    as mismatches,
  (select count(*) from public.product_sales_summary)                              as products_in_view;
