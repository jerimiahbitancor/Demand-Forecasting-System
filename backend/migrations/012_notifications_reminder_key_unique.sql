-- 012_notifications_reminder_key_unique.sql
--
-- One upload reminder per user per key, enforced by the database.
--
-- The reminder jobs check "already sent?" (metadata.key) and then insert.
-- Inside one server a run lock stops two runs racing, but two servers (an
-- old Railway service next to Render) could both pass the check and both
-- insert. This partial unique index makes the second insert fail instead.
-- The code already treats a failed insert as "not created" (no email is
-- sent for it), and logs a unique violation as a duplicate, not an error.
--
-- Only these kinds are covered:
--   upload_reminder    key upload_reminder:<business_date>:<0400|0700>
--   unconfirmed_days   key unconfirmed_days:<today>
-- Stock alerts (low_stock, restock_summary) are NOT covered: they are
-- retired and re-created on purpose, so their keys repeat.
--
-- Existing data, checked read-only on 2026-10-17: 2 rows of these kinds,
-- 2 distinct (user_id, key), 0 duplicates, 0 rows without a key. STEP 0
-- repeats that check; it must return no rows before STEP 1.
--
-- NOT RUN BY CLAUDE CODE. The owner runs it in the Supabase SQL editor:
--   1. Run STEP 0 (read-only). Expect no rows.
--   2. Run STEP 1 as-is. It ends in ROLLBACK, so nothing is saved; check
--      that it ran without errors and the test insert failed as expected.
--   3. Change the last line of STEP 1 from ROLLBACK to COMMIT, run again.
--   4. Run STEP 2 (confirm). Expect one row.
-- Rollback: STEP 3.


-- ===========================================================================
-- STEP 0 — READ-ONLY: duplicates that would block the index (expect none)
-- ===========================================================================
select user_id,
       metadata->>'kind' as kind,
       metadata->>'key'  as key,
       count(*)          as copies,
       array_agg(id order by id) as ids
from public.notifications
where metadata->>'kind' in ('upload_reminder', 'unconfirmed_days')
  and metadata->>'key' is not null
group by user_id, metadata->>'kind', metadata->>'key'
having count(*) > 1
order by user_id, key;


-- ===========================================================================
-- STEP 1 — CREATE THE INDEX (dry run: ends in ROLLBACK)
-- ===========================================================================
begin;

create unique index if not exists notifications_reminder_key_uniq
  on public.notifications (user_id, (metadata->>'key'))
  where metadata->>'kind' in ('upload_reminder', 'unconfirmed_days')
    and metadata->>'key' is not null;

-- Self-test inside the transaction: the second insert must fail with
-- 23505 (unique_violation). Uses the first user; rolled back either way.
do $$
declare
  uid integer;
begin
  select id into uid from public."user" order by id limit 1;
  if uid is null then
    raise notice 'no user row: self-test skipped';
    return;
  end if;
  insert into public.notifications (user_id, type, title, message, metadata)
  values (uid, 'warning', 'index self-test', 'index self-test',
          '{"kind":"upload_reminder","key":"upload_reminder:1900-01-01:0400"}');
  begin
    insert into public.notifications (user_id, type, title, message, metadata)
    values (uid, 'warning', 'index self-test', 'index self-test',
            '{"kind":"upload_reminder","key":"upload_reminder:1900-01-01:0400"}');
    raise exception 'self-test FAILED: the duplicate insert was accepted';
  exception when unique_violation then
    raise notice 'self-test ok: duplicate insert refused (23505)';
  end;
  delete from public.notifications where title = 'index self-test' and user_id = uid;
end $$;

rollback;   -- change to COMMIT after a clean dry run


-- ===========================================================================
-- STEP 2 — CONFIRM (read-only; expect one row)
-- ===========================================================================
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and indexname = 'notifications_reminder_key_uniq';


-- ===========================================================================
-- STEP 3 — ROLLBACK (only if the index must be removed)
-- ===========================================================================
-- drop index if exists public.notifications_reminder_key_uniq;
