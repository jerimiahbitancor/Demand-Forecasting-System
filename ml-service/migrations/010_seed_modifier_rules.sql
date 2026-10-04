-- 010_seed_modifier_rules.sql  -- run AFTER 010_add_modifier_rules_and_daily_sales_modifiers.sql
--
-- Seeds the modifier keywords by INGREDIENT NAME, not by id. Ingredient ids
-- change whenever the ingredients are deleted and re-added, so the id is
-- looked up at run time. Safe to run again any time (e.g. after a reset):
-- an existing keyword is re-pointed at the current id for that name.
--
-- Fails loudly (and saves nothing) if a name matches no ingredient or more
-- than one, so a modifier can never be linked to the wrong ingredient.
--
-- The name must be the ingredient your RECIPES use: a modifier only removes
-- its ingredient when that exact ingredient is in the dish's recipe. If the
-- recipes use "Jasmine Rice", change 'Rice' below to 'Jasmine Rice'.
--
-- Keywords must be UPPER CASE with single spaces (the table enforces it).
-- "NO FRIES" also appears in the POS data. It is NOT seeded -- owner decision.
--
-- Ends in ROLLBACK: check the rows it prints, then change to COMMIT.

BEGIN;

CREATE TEMP TABLE wanted_rules (keyword text, ingredient_name text) ON COMMIT DROP;
INSERT INTO wanted_rules VALUES
  ('NO RICE', 'Rice'),
  ('NO EGG',  'Egg');

-- Stop if any name matches zero or several (non-archived) ingredients.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(w.keyword || ' -> "' || w.ingredient_name || '" matched ' || coalesce(c.n, 0), '; ')
    INTO bad
  FROM wanted_rules w
  LEFT JOIN (
    SELECT lower(btrim(name)) AS lname, count(*) AS n
    FROM public.ingredients
    WHERE NOT coalesce(is_archived, false)
    GROUP BY lower(btrim(name))
  ) c ON c.lname = lower(btrim(w.ingredient_name))
  WHERE coalesce(c.n, 0) <> 1;

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Each ingredient name must match exactly one ingredient: %', bad;
  END IF;
END $$;

INSERT INTO public.modifier_rules (keyword, ingredient_id)
SELECT w.keyword, i.id
FROM wanted_rules w
JOIN public.ingredients i
  ON lower(btrim(i.name)) = lower(btrim(w.ingredient_name))
 AND NOT coalesce(i.is_archived, false)
ON CONFLICT (keyword) DO UPDATE SET ingredient_id = EXCLUDED.ingredient_id;

SELECT r.keyword, r.ingredient_id, i.name AS ingredient
FROM public.modifier_rules r
JOIN public.ingredients i ON i.id = r.ingredient_id
ORDER BY r.keyword;

ROLLBACK;  -- change to COMMIT when the rows above are right
