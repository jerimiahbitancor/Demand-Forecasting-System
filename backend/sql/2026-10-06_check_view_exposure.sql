-- 2026-10-06_check_view_exposure.sql
--
-- READ-ONLY. Changes nothing. Run in the Supabase SQL editor.
--
-- WHY: a view in the public schema is reachable through the REST API with
-- the anon key (which ships in the browser) unless:
--   - it has security_invoker = true (runs with the caller's rights, so
--     row-level security on the underlying table applies), and
--   - anon / authenticated have no SELECT grant on it.
-- This project's rule is that only Express (service_role) reads data.
-- This script shows where each view stands.


-- 1) Every view in the public schema, and whether security_invoker is on.
--    security_invoker = false means the view runs with its OWNER's rights.
select
  c.relname                                                      as view_name,
  coalesce('security_invoker=true' = any(c.reloptions), false)   as security_invoker,
  c.reloptions                                                   as options
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
order by c.relname;


-- 2) Explicit grants to anon / authenticated on the two summary views.
--    No rows = no grants (good).
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('product_sales_summary', 'daily_sales_date_summary')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;


-- 3) Effective read access (includes grants via PUBLIC or role membership).
--    NULL means the view does not exist yet. Every column should be false.
select
  v.view_name,
  case when to_regclass('public.' || v.view_name) is null then null
       else has_table_privilege('anon', 'public.' || v.view_name, 'select') end          as anon_can_read,
  case when to_regclass('public.' || v.view_name) is null then null
       else has_table_privilege('authenticated', 'public.' || v.view_name, 'select') end as authenticated_can_read
from (values ('product_sales_summary'), ('daily_sales_date_summary')) as v(view_name);


-- ======================= OPTIONAL FIX (NOT RUN) ===========================
-- If the checks above show product_sales_summary with security_invoker =
-- false, or anon/authenticated able to read it, these statements close it.
-- The owner decides. They change permissions only, not data. Remove the
-- leading "-- " and run them as one block.
--
-- begin;
-- alter view public.product_sales_summary set (security_invoker = true);
-- revoke all on public.product_sales_summary from anon, authenticated;
-- grant select on public.product_sales_summary to service_role;
-- commit;
