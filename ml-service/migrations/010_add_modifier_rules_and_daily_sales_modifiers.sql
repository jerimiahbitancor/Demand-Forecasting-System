-- 010_add_modifier_rules_and_daily_sales_modifiers.sql
--
-- WHAT: two tables for POS modifiers ("Marinated Porksilog NO EGG").
--
--   modifier_rules         keyword -> the ONE ingredient that keyword leaves
--                          out of the plate ("NO EGG" -> Egg). The upload
--                          code reads its keyword list from here; nothing is
--                          hardcoded.
--   daily_sales_modifiers  per product / date / keyword: how many of that
--                          day's plates carried the modifier. daily_sales
--                          still holds ALL plates of the base dish (modifier
--                          rows included) -- that is the training input.
--
-- WHY: owner decision (Oct 2 2026) -- "NO RICE" / "NO EGG" are modifiers,
-- not dishes. Marinated Porksilog, Marinated Porksilog NO EGG and
-- Marinated Porksilog NO RICE are one product. Stock deduction and
-- ingredient demand use the modifier counts to leave out the egg / rice.
--
-- READERS / WRITERS:
--   backend/services/uploadService.js   (reads rules, writes modifiers)
--   backend/utils/salesModifiers.js     (the parsing / counting rules)
--   ml-service/services/data_loader.py  (reads both for ingredient demand)
-- The code runs safely BEFORE this migration: with the tables missing, the
-- backend uses item names as-is (old behaviour) and logs one warning, and
-- ml-service uses full recipes. Run this, then the seed file, then
-- re-upload sales.
--
-- DELETE BEHAVIOUR (matches daily_sales exactly):
--   daily_sales_modifiers.upload_id  -> uploads(id)   ON DELETE CASCADE
--   daily_sales_modifiers.product_id -> products(id)  ON DELETE RESTRICT
--   modifier_rules.ingredient_id     -> ingredients(id) ON DELETE RESTRICT
--     (an ingredient used by a rule can't be hard-deleted; archive it, or
--      delete the rule first)
--   daily_sales_modifiers.keyword has NO foreign key to modifier_rules on
--   purpose: deleting a rule must not delete or block sales history.
--
-- SECURITY: RLS on, no policies (project default-deny), and no access for
-- the browser-shipped anon key or authenticated role -- Express
-- (service_role) is the only way in.
--
-- HOW TO RUN (Supabase SQL editor):
--   1. Run as-is. It ends in ROLLBACK, so nothing is saved. Check the
--      "check" rows at the end all say true.
--   2. Change the last line from ROLLBACK to COMMIT and run again.
-- SAFE TO RE-RUN: IF NOT EXISTS everywhere.

BEGIN;

CREATE TABLE IF NOT EXISTS public.modifier_rules (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  keyword       text NOT NULL UNIQUE,
  ingredient_id integer NOT NULL
                REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Stored in one canonical form (upper case, single spaces) so UNIQUE
  -- also catches "no egg" vs "NO EGG" vs "NO  EGG".
  CONSTRAINT modifier_rules_keyword_canonical
    CHECK (keyword = upper(regexp_replace(btrim(keyword), '\s+', ' ', 'g'))
           AND keyword <> '')
);

COMMENT ON TABLE public.modifier_rules IS
  'POS modifier keyword (e.g. NO EGG) -> the one ingredient it leaves out. Read by uploadService and ml-service.';

CREATE TABLE IF NOT EXISTS public.daily_sales_modifiers (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  integer NOT NULL
              REFERENCES public.products(id) ON DELETE RESTRICT,
  sale_date   date NOT NULL,
  keyword     text NOT NULL,
  quantity    integer NOT NULL CHECK (quantity >= 0),
  upload_id   integer
              REFERENCES public.uploads(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_sales_modifiers_product_date_keyword_key
    UNIQUE (product_id, sale_date, keyword)
);

COMMENT ON TABLE public.daily_sales_modifiers IS
  'Net plates per product/date that carried a POS modifier. daily_sales.quantity_sold already includes them.';

-- Deleting an upload cascades here; without an index on upload_id that
-- cascade scans the whole table.
CREATE INDEX IF NOT EXISTS daily_sales_modifiers_upload_id_idx
  ON public.daily_sales_modifiers (upload_id);
-- Ingredient demand reads by date window.
CREATE INDEX IF NOT EXISTS daily_sales_modifiers_sale_date_idx
  ON public.daily_sales_modifiers (sale_date);

ALTER TABLE public.modifier_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_sales_modifiers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.modifier_rules        FROM anon, authenticated;
REVOKE ALL ON public.daily_sales_modifiers FROM anon, authenticated;
GRANT  ALL ON public.modifier_rules        TO service_role;
GRANT  ALL ON public.daily_sales_modifiers TO service_role;

-- Checks (all should be true)
SELECT 'modifier_rules exists'        AS check, to_regclass('public.modifier_rules') IS NOT NULL AS ok
UNION ALL
SELECT 'daily_sales_modifiers exists', to_regclass('public.daily_sales_modifiers') IS NOT NULL
UNION ALL
SELECT 'anon cannot read modifier_rules',
       NOT has_table_privilege('anon', 'public.modifier_rules', 'SELECT')
UNION ALL
SELECT 'anon cannot read daily_sales_modifiers',
       NOT has_table_privilege('anon', 'public.daily_sales_modifiers', 'SELECT')
UNION ALL
SELECT 'upload delete cascades',
       EXISTS (SELECT 1 FROM pg_constraint
               WHERE conrelid = 'public.daily_sales_modifiers'::regclass
                 AND contype = 'f' AND confdeltype = 'c'
                 AND confrelid = 'public.uploads'::regclass);

ROLLBACK;  -- change to COMMIT after the dry run looks right
