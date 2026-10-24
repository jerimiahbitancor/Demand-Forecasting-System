BEGIN;

WITH legacy_cup_ingredients AS (
  SELECT
    ingredient.id,
    240::numeric AS conversion_factor
  FROM public.ingredients AS ingredient
  WHERE lower(btrim(coalesce(ingredient.unit, ''))) IN ('cup', 'cups', 'cup (cup)', 'cups (cup)')
     OR ingredient.unit_id IN (
       SELECT id
       FROM public.ingredient_units
       WHERE lower(btrim(name)) IN ('cups (cup)', 'cup', 'cups')
          OR EXISTS (
            SELECT 1
            FROM unnest(coalesce(aliases, ARRAY[]::text[])) AS unit_alias(alias)
            WHERE lower(btrim(unit_alias.alias)) IN ('cup', 'cups', 'cup (cup)', 'cups (cup)')
          )
     )
)
UPDATE public.ingredients AS ingredient
SET
  quantity = ingredient.quantity * legacy.conversion_factor,
  min_stock = ingredient.min_stock * legacy.conversion_factor,
  price = ingredient.price / legacy.conversion_factor,
  unit = 'Milliliters (mL)',
  unit_id = (
    SELECT id FROM public.ingredient_units WHERE lower(name) = 'milliliters (ml)' LIMIT 1
  ),
  base_unit = 'ml',
  unit_family = 'volume',
  allow_fractional = true
FROM legacy_cup_ingredients AS legacy
WHERE ingredient.id = legacy.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.product_ingredients AS recipe
    JOIN public.ingredients AS ingredient ON ingredient.id = recipe.ingredient_id
    LEFT JOIN public.ingredient_units AS stock_unit ON stock_unit.id = ingredient.unit_id
    WHERE lower(btrim(coalesce(recipe.unit, ''))) IN ('cup', 'cups', 'cup (cup)', 'cups (cup)')
      AND coalesce(ingredient.unit_family, stock_unit.family) NOT IN ('mass', 'volume')
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate legacy cup recipe lines attached to count/unknown stock units; convert those recipe lines to supported units first.';
  END IF;
END $$;

WITH legacy_recipe_quantities AS (
  SELECT
    recipe.id,
    (
      COALESCE(
      recipe.quantity_per_serving,
      public._parse_recipe_quantity_2(recipe.quantity_per_serving_text)
      ) * CASE
        WHEN coalesce(ingredient.unit_family, stock_unit.family) = 'volume' THEN 240
        WHEN ingredient.material_type = 'wet' THEN 240
        ELSE 120
      END
    ) AS normalized_quantity,
    CASE
      WHEN coalesce(ingredient.unit_family, stock_unit.family) = 'volume' THEN 'mL'
      ELSE 'g'
    END AS normalized_unit
  FROM public.product_ingredients AS recipe
  JOIN public.ingredients AS ingredient ON ingredient.id = recipe.ingredient_id
  LEFT JOIN public.ingredient_units AS stock_unit ON stock_unit.id = ingredient.unit_id
  WHERE lower(btrim(coalesce(recipe.unit, ''))) IN ('cup', 'cups', 'cup (cup)', 'cups (cup)')
)
UPDATE public.product_ingredients AS recipe
SET
  quantity_per_serving = legacy.normalized_quantity,
  quantity_per_serving_text = CASE
    WHEN recipe.quantity_per_serving_text IS NOT NULL AND legacy.normalized_quantity IS NOT NULL
      THEN legacy.normalized_quantity::text
    ELSE recipe.quantity_per_serving_text
  END,
  unit = legacy.normalized_unit
FROM legacy_recipe_quantities AS legacy
WHERE recipe.id = legacy.id;

UPDATE public.ingredient_units
SET
  is_active = false,
  aliases = ARRAY(
    SELECT alias
    FROM unnest(coalesce(ingredient_units.aliases, ARRAY[]::text[])) AS aliases(alias)
    WHERE lower(btrim(aliases.alias)) NOT IN ('cup', 'cups', 'cup (cup)', 'cups (cup)')
  )
WHERE lower(btrim(name)) IN ('cups (cup)', 'cup', 'cups')
   OR EXISTS (
     SELECT 1
     FROM unnest(coalesce(ingredient_units.aliases, ARRAY[]::text[])) AS aliases(alias)
     WHERE lower(btrim(aliases.alias)) IN ('cup', 'cups', 'cup (cup)', 'cups (cup)')
   );

COMMIT;
