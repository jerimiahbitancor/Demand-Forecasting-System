ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS material_type text NOT NULL DEFAULT 'dry';

UPDATE public.ingredients
SET material_type = 'wet'
WHERE material_type = 'dry'
  AND (
    lower(coalesce(category, '')) ~ '(wet|liquid|meat|poultry|seafood|fish|dairy|vegetable|fruit|egg)'
    OR lower(coalesce(unit, '')) IN ('milliliters (ml)', 'liters (l)')
  );

ALTER TABLE public.ingredients
  DROP CONSTRAINT IF EXISTS ingredients_material_type_check,
  ADD CONSTRAINT ingredients_material_type_check
    CHECK (material_type IN ('wet', 'dry'));

UPDATE public.ingredient_units
SET is_active = false
WHERE lower(name) NOT IN (
  'grams (g)',
  'kilograms (kg)',
  'milliliters (ml)',
  'liters (l)',
  'tablespoons (tbsp)',
  'teaspoons (tsp)',
  'pieces (pcs)'
);

INSERT INTO public.ingredient_units
  (name, family, base_unit, base_factor, is_piece, piece_weight_grams, aliases, is_active)
VALUES
  ('Grams (g)', 'mass', 'g', 1, false, NULL, ARRAY['g', 'gram', 'grams', 'gm', 'gram (g)', 'grams (g)'], true),
  ('Kilograms (kg)', 'mass', 'g', 1000, false, NULL, ARRAY['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'], true),
  ('Milliliters (mL)', 'volume', 'mL', 1, false, NULL, ARRAY['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'], true),
  ('Liters (L)', 'volume', 'mL', 1000, false, NULL, ARRAY['l', 'liter', 'liters', 'litre', 'litres'], true),
  ('Tablespoons (tbsp)', 'volume', 'mL', 15, false, NULL, ARRAY['tbsp', 'tablespoon', 'tablespoons'], true),
  ('Teaspoons (tsp)', 'volume', 'mL', 5, false, NULL, ARRAY['tsp', 'teaspoon', 'teaspoons'], true),
  ('Pieces (pcs)', 'count', NULL, NULL, false, NULL, ARRAY['pcs', 'pc', 'piece', 'pieces'], true)
ON CONFLICT (name) DO UPDATE SET
  family = EXCLUDED.family,
  base_unit = EXCLUDED.base_unit,
  base_factor = EXCLUDED.base_factor,
  is_piece = EXCLUDED.is_piece,
  piece_weight_grams = EXCLUDED.piece_weight_grams,
  aliases = EXCLUDED.aliases,
  is_active = EXCLUDED.is_active;
