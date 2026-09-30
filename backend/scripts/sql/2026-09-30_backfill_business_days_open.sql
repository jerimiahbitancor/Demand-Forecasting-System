-- 2026-09-30_backfill_business_days_open.sql
--
-- WHAT: makes sure every date that has daily_sales rows is marked
-- confirmed_open in business_days.
--
-- WHY: routes/upload.js calls businessDayService.confirmOpenDatesForUpload()
-- after each sales upload, but if that call fails the error is only logged
-- (console.error) and the upload still succeeds. Those dates then stay
-- UNCONFIRMED even though they have sales — and the first-use history rule
-- counts a date as open only if it has sales, so this doesn't block
-- training, but the business_days table would be wrong for everything else
-- that reads it (forecast staleness, the planned operating calendar).
--
-- Also fixes any date that has sales but is marked confirmed_closed: an
-- upload always wins over a closed mark (same rule as the live code).
--
-- SAFE TO RE-RUN: dates already confirmed_open are left untouched.
--
-- HOW TO RUN (Supabase SQL editor):
--   1. Run STEP 1 alone. Read the counts.
--   2. Run STEP 2 alone. It ends in ROLLBACK, so nothing is saved — check
--      the "after" counts it prints.
--   3. If the numbers look right, change the last line of STEP 2 from
--      ROLLBACK to COMMIT and run STEP 2 again.

-- ===========================================================================
-- STEP 1 — DRY RUN (read-only)
-- ===========================================================================
with sale_dates as (
  select distinct sale_date as d from daily_sales
)
select
  (select count(*) from sale_dates)                                        as dates_with_sales,
  count(*) filter (where b.business_date is null)                          as missing_row,
  count(*) filter (where b.status = 'unconfirmed')                         as marked_unconfirmed,
  count(*) filter (where b.status = 'confirmed_closed')                    as marked_closed_but_has_sales,
  count(*) filter (where b.business_date is null or b.status <> 'confirmed_open') as will_be_fixed
from sale_dates s
left join business_days b on b.business_date = s.d;

-- The closed-but-has-sales dates, if any (worth a look: the owner may have
-- marked a day closed by mistake):
select b.business_date, b.source, b.confirmed_at
from business_days b
where b.status = 'confirmed_closed'
  and exists (select 1 from daily_sales s where s.sale_date = b.business_date)
order by b.business_date;

-- ===========================================================================
-- STEP 2 — APPLY (ends in ROLLBACK; change to COMMIT once checked)
-- ===========================================================================
begin;

insert into business_days (business_date, is_open, status, source, confirmed_at)
select distinct s.sale_date, true, 'confirmed_open', 'sales_upload', now()
from daily_sales s
on conflict (business_date) do update
  set is_open      = true,
      status       = 'confirmed_open',
      source       = 'sales_upload',
      confirmed_at = now()
  where business_days.status is distinct from 'confirmed_open';

-- "after" check: should be 0.
select count(*) as dates_with_sales_not_confirmed_open
from (select distinct sale_date as d from daily_sales) s
left join business_days b on b.business_date = s.d
where b.business_date is null or b.status <> 'confirmed_open';

rollback;  -- change to: commit;
