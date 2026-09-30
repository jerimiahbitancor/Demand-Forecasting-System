-- 2026-09-30_delete_generated_data_from_2026-07-10.sql
--
-- WHAT: removes the GENERATED (synthetic) test data dated July 10, 2026 and
-- later, so the client's real files for that period can be uploaded.
--
-- READ FIRST
-- * As of Sep 30 2026 the project in backend/.env and ml-service/.env
--   (bvsivqengdoslryiazyr) has 0 rows in daily_sales, uploads,
--   business_days, forecasts, forecast_runs, product_classifications,
--   forecast_cogs and inventory_transactions. If you run STEP 1 there, every
--   count will be 0 and there is nothing to delete. If you expected data,
--   check which project you are connected to.
-- * Real data runs Jul 10, 2025 -> Sep 29, 2026. Only rows dated on/after
--   the cutoff below are touched. Everything before it is kept.
-- * Nothing in this file is automatic. STEP 2 ends in ROLLBACK.
--
-- FOREIGN KEYS / SIDE EFFECTS (from backend/database_schema.csv)
--   daily_sales.upload_id  -> uploads(id)   ON DELETE CASCADE
--   daily_sales.product_id -> products(id)  ON DELETE RESTRICT (products kept)
--   forecast_cogs.forecast_id               NO foreign key -> delete it
--                                           BEFORE forecasts, or it's orphaned
--   forecasts.product_id   -> products(id)  (no cascade needed, products kept)
--   product_classifications.product_id -> products ON DELETE CASCADE (kept)
--   forecast_runs, business_days            no FKs
--   inventory_transactions                  NO link to sales or uploads at
--                                           all — see STEP 3
--
-- ORDER (STEP 2): forecast_cogs -> forecasts -> product_classifications ->
--   forecast_runs -> daily_sales -> uploads -> business_days.
--   Forecast outputs go first because they were computed FROM the generated
--   sales; the sales and their uploads next; business_days last.
--
-- HOW TO RUN (Supabase SQL editor):
--   1. Run STEP 1 alone. Read every count.
--   2. Run STEP 2 alone. It ends in ROLLBACK; check the "after" counts.
--   3. If right, change ROLLBACK to COMMIT and run STEP 2 again.
--   4. Read STEP 3 (stock) and STEP 4 (models) and decide on each.

-- ===========================================================================
-- STEP 1 — DRY RUN (read-only)
-- ===========================================================================
with cutoff as (select date '2026-07-10' as d),
up as (
  select u.id,
         bool_or(s.sale_date >= (select d from cutoff)) as has_generated,
         bool_or(s.sale_date <  (select d from cutoff)) as has_real
  from uploads u
  left join daily_sales s on s.upload_id = u.id
  group by u.id
)
select
  (select count(*) from daily_sales where sale_date >= (select d from cutoff))            as daily_sales_rows,
  (select count(distinct sale_date) from daily_sales where sale_date >= (select d from cutoff)) as daily_sales_dates,
  (select count(*) from up where has_generated and not coalesce(has_real, false))          as uploads_fully_generated,
  (select count(*) from up where has_generated and has_real)                              as uploads_mixed_keep,
  (select count(*) from up where has_generated is null)                                   as uploads_with_no_rows,
  (select count(*) from business_days where business_date >= (select d from cutoff))     as business_days_rows,
  (select count(*) from business_days where business_date >= (select d from cutoff)
                                        and status = 'confirmed_open'
                                        and extract(dow from business_date) = 0)          as business_days_open_sundays,
  (select count(*) from forecasts where forecast_date >= (select d from cutoff))          as forecasts_rows,
  (select count(*) from forecast_cogs where forecast_id in
      (select id from forecasts where forecast_date >= (select d from cutoff)))           as forecast_cogs_rows,
  (select count(*) from forecast_cogs where forecast_id is not null and forecast_id not in
      (select id from forecasts))                                                         as forecast_cogs_already_orphaned,
  (select count(*) from product_classifications where classification_date >= (select d from cutoff)) as classifications_rows,
  (select count(*) from forecast_runs where last_confirmed_date >= (select d from cutoff)) as forecast_runs_rows,
  (select count(*) from model_metrics where evaluation_date >= (select d from cutoff))    as model_metrics_trained_on_generated;

-- Uploads that have NO daily_sales rows (failed/empty) — not deleted by this
-- script. Look at the filenames and decide by hand:
select id, filename, status, upload_date
from uploads u
where not exists (select 1 from daily_sales s where s.upload_id = u.id)
order by upload_date;

-- ===========================================================================
-- STEP 2 — DELETE (ends in ROLLBACK; change to COMMIT once checked)
-- ===========================================================================
begin;

-- Uploads whose rows are ALL generated. Captured before any delete, because
-- after daily_sales is cleared every such upload would look empty.
-- An upload with rows on BOTH sides of the cutoff is kept: only its
-- generated rows are removed.
create temporary table generated_uploads on commit drop as
select u.id
from uploads u
where exists     (select 1 from daily_sales s where s.upload_id = u.id and s.sale_date >= date '2026-07-10')
  and not exists (select 1 from daily_sales s where s.upload_id = u.id and s.sale_date <  date '2026-07-10');

-- 1. forecast_cogs first — it has no FK to forecasts.
delete from forecast_cogs
where forecast_id in (select id from forecasts where forecast_date >= date '2026-07-10');

-- 2. forecasts computed from the generated sales.
delete from forecasts where forecast_date >= date '2026-07-10';

-- 3. demand tiers assigned during generated-data forecast runs.
delete from product_classifications where classification_date >= date '2026-07-10';

-- 4. forecast run records whose freshest data was generated.
delete from forecast_runs where last_confirmed_date >= date '2026-07-10';

-- 5. the generated sales themselves.
delete from daily_sales where sale_date >= date '2026-07-10';

-- 6. uploads that held only generated rows (now empty).
delete from uploads where id in (select id from generated_uploads);

-- 7. open/closed marks for the generated period, including the old Sundays
--    marked open. The real uploads will re-create the right ones.
delete from business_days where business_date >= date '2026-07-10';

-- "after" checks: all should be 0.
select
  (select count(*) from daily_sales   where sale_date     >= date '2026-07-10') as daily_sales_left,
  (select count(*) from business_days where business_date >= date '2026-07-10') as business_days_left,
  (select count(*) from forecasts     where forecast_date >= date '2026-07-10') as forecasts_left,
  (select count(*) from forecast_cogs where forecast_id is not null
                                        and forecast_id not in (select id from forecasts)) as orphaned_cogs,
  (select count(*) from uploads u where not exists
      (select 1 from daily_sales s where s.upload_id = u.id))                    as empty_uploads_left;

rollback;  -- change to: commit;

-- ===========================================================================
-- STEP 3 — INGREDIENT STOCK (decide by hand; NOT part of STEP 2)
-- ===========================================================================
-- Every sales upload also deducts ingredient stock and writes an
-- inventory_transactions row (transaction_type = 'sale'). Those rows store
-- NO sale date and NO upload id — only created_at (the moment of upload) —
-- so they cannot be matched to generated uploads reliably. Deleting them
-- also would NOT put the stock back.
--
-- Recommended: after the cleanup and the real re-upload, do a physical
-- stock count and set each ingredient's quantity in Inventory Management.
-- That is the only number you can trust.
--
-- To see what the uploads deducted in a time window you choose:
-- select ingredient_id,
--        sum(previous_quantity - new_quantity) as total_deducted,
--        count(*)                               as transactions,
--        min(created_at), max(created_at)
-- from inventory_transactions
-- where transaction_type = 'sale'
--   and created_at between timestamptz '2026-09-17 00:00+08' and timestamptz '2026-09-18 23:59+08'
-- group by ingredient_id
-- order by ingredient_id;

-- ===========================================================================
-- STEP 4 — MODELS TRAINED ON GENERATED DATA (decide by hand)
-- ===========================================================================
-- Any model trained after Jul 10, 2026 saw generated sales. Its
-- model_metrics row and its file in Supabase Storage (bucket ml-models)
-- describe accuracy on fake data.
--
-- Note: the first-use history rule applies only while model_metrics is
-- EMPTY. Deleting these rows makes the dashboard and /train check the
-- 12-month rule again on the real data — which is what you want after
-- replacing the data.
--
-- delete from model_metrics where evaluation_date >= date '2026-07-10';
--
-- Storage files cannot be removed with SQL. Delete them in the Supabase
-- dashboard (Storage -> ml-models), or leave them: /forecast always loads
-- the newest file, so retrain once after the real upload.
