-- 011_product_aliases_and_merge.sql
--
-- Merge duplicate products (owner's v3 flowchart, page 4 "Merge Products"):
--   * product_aliases: old / alternative names of a product. Sales uploads
--     match names AND aliases, so a Loyverse file that still says
--     "OG Tapsilog" lands on "Original Tapsilog" after the merge, and a
--     renamed product keeps matching its old name.
--   * merge_products(source, target, modifier_keyword, actor): moves the
--     source product's history into the target in ONE transaction (all or
--     nothing), keeps the source's name as an alias, and archives the source.
--
-- NOT RUN BY CLAUDE CODE. The owner runs it in the Supabase SQL editor:
--   0. Take a manual CSV export of products, daily_sales,
--      daily_sales_modifiers, product_ingredients, forecasts,
--      forecast_cogs and product_classifications.
--   1. Run STEP 0 below (read-only preview) to see the counts.
--   2. Run STEP 1 as-is. It ends in ROLLBACK, so nothing is saved; check
--      that it ran without errors.
--   3. Change the last line of STEP 1 from ROLLBACK to COMMIT, run again.
--   4. Run STEP 2 (confirm) — every row should say true.
-- Merges themselves are done from Product Management ("Merge into..."),
-- or with: select public.merge_products(434, 316, null, 'owner');
--
-- Security: product_aliases has RLS on and no anon/authenticated access;
-- merge_products can only be executed by service_role (Express). The
-- browser's anon key can never call it.


-- ===========================================================================
-- STEP 0 — READ-ONLY PREVIEW (uncomment and run; changes nothing)
-- Pairs: 434 -> 316 (Cheesy Spicy Hungarian), 436 -> 368 (OG Tapsilog),
--        450 -> 325 (Chick & Fries NO FRIES, as the NO FRIES modifier).
-- ===========================================================================
-- with pairs(source_id, target_id) as (
--   values (434, 316), (436, 368), (450, 325)
-- )
-- select
--   p.source_id,
--   s.name                                                        as source_name,
--   p.target_id,
--   t.name                                                        as target_name,
--   (select count(*) from public.daily_sales d where d.product_id = p.source_id)
--                                                                 as source_sales_days,
--   (select coalesce(sum(d.quantity_sold), 0) from public.daily_sales d where d.product_id = p.source_id)
--                                                                 as source_plates,
--   (select count(*) from public.daily_sales d
--      join public.daily_sales x on x.product_id = p.target_id and x.sale_date = d.sale_date
--     where d.product_id = p.source_id)                           as days_added_together,
--   (select count(*) from public.daily_sales_modifiers m where m.product_id = p.source_id)
--                                                                 as source_modifier_rows,
--   (select count(*) from public.product_ingredients r where r.product_id = p.source_id)
--                                                                 as source_recipe_rows,
--   (select count(*) from public.product_ingredients r where r.product_id = p.target_id)
--                                                                 as target_recipe_rows,
--   (select count(*) from public.forecasts f where f.product_id = p.source_id)
--                                                                 as source_forecasts_to_delete,
--   (select count(*) from public.product_classifications c where c.product_id = p.source_id)
--                                                                 as source_classifications_to_delete,
--   s.status                                                      as source_status,
--   t.status                                                      as target_status
-- from pairs p
-- join public.products s on s.id = p.source_id
-- join public.products t on t.id = p.target_id
-- order by p.source_id;
--
-- For 450 -> 325 with NO FRIES, the keyword must exist first:
-- select * from public.modifier_rules where upper(keyword) = 'NO FRIES';


-- ===========================================================================
-- STEP 1 — CREATE (dry run first: ends in ROLLBACK)
-- ===========================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.product_aliases (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alias_name  text        NOT NULL,
  -- lower(trim(collapsed spaces)) of alias_name; the same key the upload
  -- uses (backend/utils/productNameKey.js), so matching is exact.
  alias_key   text        NOT NULL UNIQUE,
  product_id  integer     NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_aliases_product_id_idx ON public.product_aliases (product_id);

ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_aliases FROM anon, authenticated;
GRANT  ALL ON public.product_aliases TO service_role;

-- The one name-key rule, in SQL. Must match productNameKey() in JS.
CREATE OR REPLACE FUNCTION public.product_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public.merge_products(
  p_source           integer,
  p_target           integer,
  p_modifier_keyword text DEFAULT NULL,
  p_actor            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source            public.products%ROWTYPE;
  v_target            public.products%ROWTYPE;
  v_keyword           text := NULL;
  v_days_moved        integer := 0;
  v_days_overlap      integer := 0;
  v_plates_moved      bigint  := 0;
  v_modifier_moved    integer := 0;
  v_keyword_rows      integer := 0;
  v_recipe            text;
  v_forecasts         integer := 0;
  v_classifications   integer := 0;
  v_aliases_moved     integer := 0;
BEGIN
  -- 1. Checks. Any failure raises, and the whole merge rolls back.
  IF p_source IS NULL OR p_target IS NULL OR p_source = p_target THEN
    RAISE EXCEPTION 'merge_products: source and target must be two different products';
  END IF;

  -- Lock both rows (lowest id first, so two merges cannot deadlock). A sales
  -- upload writing daily_sales for either product waits until this commits.
  PERFORM 1 FROM public.products WHERE id IN (p_source, p_target) ORDER BY id FOR UPDATE;

  SELECT * INTO v_source FROM public.products WHERE id = p_source;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_products: source product % does not exist', p_source;
  END IF;
  SELECT * INTO v_target FROM public.products WHERE id = p_target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_products: target product % does not exist', p_target;
  END IF;
  IF v_source.inactive_reason ILIKE 'archived: merged into%' THEN
    RAISE EXCEPTION 'merge_products: product % (%) was already merged', p_source, v_source.name;
  END IF;
  IF v_target.status = 'archived' THEN
    RAISE EXCEPTION 'merge_products: target product % (%) is archived', p_target, v_target.name;
  END IF;

  IF p_modifier_keyword IS NOT NULL AND btrim(p_modifier_keyword) <> '' THEN
    v_keyword := upper(btrim(regexp_replace(p_modifier_keyword, '\s+', ' ', 'g')));
    IF NOT EXISTS (
      SELECT 1 FROM public.modifier_rules
       WHERE upper(btrim(regexp_replace(keyword, '\s+', ' ', 'g'))) = v_keyword
    ) THEN
      RAISE EXCEPTION 'merge_products: modifier keyword "%" is not in modifier_rules', v_keyword;
    END IF;
  END IF;

  -- Counts before anything moves.
  SELECT count(*), coalesce(sum(quantity_sold), 0)
    INTO v_days_moved, v_plates_moved
    FROM public.daily_sales WHERE product_id = p_source;
  SELECT count(*) INTO v_days_overlap
    FROM public.daily_sales s
    JOIN public.daily_sales t ON t.product_id = p_target AND t.sale_date = s.sale_date
   WHERE s.product_id = p_source;

  -- 3b. With a modifier keyword: the source's plates become that modifier on
  -- the target ("Chick & Fries NO FRIES" = Chick & Fries with NO FRIES).
  -- Done from the source's own rows, before they are moved.
  IF v_keyword IS NOT NULL THEN
    INSERT INTO public.daily_sales_modifiers (product_id, sale_date, keyword, quantity, upload_id, created_at)
    SELECT p_target, s.sale_date, v_keyword, s.quantity_sold, s.upload_id, now()
      FROM public.daily_sales s
     WHERE s.product_id = p_source AND s.quantity_sold > 0
    ON CONFLICT (product_id, sale_date, keyword)
      DO UPDATE SET quantity = public.daily_sales_modifiers.quantity + EXCLUDED.quantity;
    GET DIAGNOSTICS v_keyword_rows = ROW_COUNT;
  END IF;

  -- 2. daily_sales: add each source day into the target's day (insert if the
  -- target has no row that day), then delete the source rows.
  INSERT INTO public.daily_sales (product_id, sale_date, quantity_sold, upload_id)
  SELECT p_target, s.sale_date, s.quantity_sold, s.upload_id
    FROM public.daily_sales s
   WHERE s.product_id = p_source
  ON CONFLICT (product_id, sale_date)
    DO UPDATE SET quantity_sold = public.daily_sales.quantity_sold + EXCLUDED.quantity_sold;
  DELETE FROM public.daily_sales WHERE product_id = p_source;

  -- 3a. daily_sales_modifiers: the same, per keyword.
  INSERT INTO public.daily_sales_modifiers (product_id, sale_date, keyword, quantity, upload_id, created_at)
  SELECT p_target, m.sale_date, m.keyword, m.quantity, m.upload_id, now()
    FROM public.daily_sales_modifiers m
   WHERE m.product_id = p_source
  ON CONFLICT (product_id, sale_date, keyword)
    DO UPDATE SET quantity = public.daily_sales_modifiers.quantity + EXCLUDED.quantity;
  GET DIAGNOSTICS v_modifier_moved = ROW_COUNT;
  DELETE FROM public.daily_sales_modifiers WHERE product_id = p_source;

  -- 4. Recipe: moved only if the target has none; otherwise the target's
  -- recipe is kept and the source's is deleted.
  IF EXISTS (SELECT 1 FROM public.product_ingredients WHERE product_id = p_target) THEN
    DELETE FROM public.product_ingredients WHERE product_id = p_source;
    v_recipe := 'kept_target';
  ELSIF EXISTS (SELECT 1 FROM public.product_ingredients WHERE product_id = p_source) THEN
    UPDATE public.product_ingredients SET product_id = p_target WHERE product_id = p_source;
    v_recipe := 'moved_source';
  ELSE
    v_recipe := 'none';
  END IF;

  -- 5. Forecast outputs for the source: rebuilt at the next forecast run.
  DELETE FROM public.forecast_cogs
   WHERE forecast_id IN (SELECT id FROM public.forecasts WHERE product_id = p_source);
  DELETE FROM public.forecasts WHERE product_id = p_source;
  GET DIAGNOSTICS v_forecasts = ROW_COUNT;
  DELETE FROM public.product_classifications WHERE product_id = p_source;
  GET DIAGNOSTICS v_classifications = ROW_COUNT;

  -- 6. Names: the source's name, and any aliases it already had, now point
  -- at the target.
  UPDATE public.product_aliases SET product_id = p_target WHERE product_id = p_source;
  GET DIAGNOSTICS v_aliases_moved = ROW_COUNT;
  INSERT INTO public.product_aliases (alias_name, alias_key, product_id)
  VALUES (v_source.name, public.product_name_key(v_source.name), p_target)
  ON CONFLICT (alias_key) DO UPDATE SET product_id = EXCLUDED.product_id, alias_name = EXCLUDED.alias_name;

  -- 7. Archive the source under a new name, so its old name is free.
  UPDATE public.products
     SET name            = v_source.name || ' (merged)',
         status          = 'archived',
         inactive_reason = 'Archived: merged into ' || v_target.name,
         inactive_since  = now()
   WHERE id = p_source;

  -- 8. Audit trail.
  INSERT INTO public.audit_logs (action_type, details, performed_by, performed_at)
  VALUES (
    'product_merged',
    format('Merged "%s" (%s) into "%s" (%s): %s sales day(s) moved, %s added to existing days, %s modifier row(s) moved%s; recipe %s.',
           v_source.name, p_source, v_target.name, p_target,
           v_days_moved, v_days_overlap, v_modifier_moved,
           CASE WHEN v_keyword IS NULL THEN '' ELSE format(', plates stored as %s', v_keyword) END,
           v_recipe),
    left(p_actor, 255),
    now()
  );

  -- 9. Counts.
  RETURN jsonb_build_object(
    'source_id',              p_source,
    'source_name',            v_source.name,
    'target_id',              p_target,
    'target_name',            v_target.name,
    'days_moved',             v_days_moved,
    'plates_moved',           v_plates_moved,
    'days_added_together',    v_days_overlap,
    'modifier_rows_moved',    v_modifier_moved,
    'modifier_keyword',       v_keyword,
    'modifier_keyword_rows',  v_keyword_rows,
    'recipe',                 v_recipe,
    'forecasts_deleted',      v_forecasts,
    'classifications_deleted', v_classifications,
    'aliases_moved',          v_aliases_moved
  );
END;
$$;

-- Only Express (service_role) may run these.
REVOKE ALL ON FUNCTION public.merge_products(integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_products(integer, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.product_name_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_name_key(text) TO service_role;

ROLLBACK;  -- dry run. Change to COMMIT after it runs without errors.


-- ===========================================================================
-- STEP 2 — CONFIRM (read-only, after COMMIT)
-- ===========================================================================
-- select
--   to_regclass('public.product_aliases') is not null                          as aliases_table_exists,
--   (select relrowsecurity from pg_class where oid = 'public.product_aliases'::regclass) as aliases_rls_on,
--   not has_table_privilege('anon', 'public.product_aliases', 'SELECT')         as anon_cannot_read_aliases,
--   not has_function_privilege('anon', 'public.merge_products(integer, integer, text, text)', 'EXECUTE')
--                                                                               as anon_cannot_merge,
--   not has_function_privilege('authenticated', 'public.merge_products(integer, integer, text, text)', 'EXECUTE')
--                                                                               as authenticated_cannot_merge,
--   public.product_name_key('  Cheesy   Spicy Hungarian ') = 'cheesy spicy hungarian' as key_rule_ok;
