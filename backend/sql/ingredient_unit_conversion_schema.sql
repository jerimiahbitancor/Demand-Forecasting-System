-- ingredient_units: schema + seed for database-driven recipe unit conversion.
--
-- Currently recipe unit conversion (grams per kg, mL per cup, piece -> weight,
-- ...) is hardcoded in three mirrored copies of recipeUnits (frontend,
-- backend and ml-service). This migration moves that metadata into the
-- ingredient_units table so it can be edited without a code deploy.
--
-- New columns:
--   family            'mass' | 'volume' | 'count'
--   base_unit         reference unit every member of the family normalises to
--                     ('g' for mass, 'mL' for volume, NULL for count)
--   base_factor       units of base_unit per 1 of this unit
--                     (kg -> 1000, cup -> 240, oz -> 28.35, NULL for count)
--   is_piece          count units that convert to weight via a per-piece
--                     weight (pcs, slices, cloves, sticks)
--   piece_weight_grams optional default grams per piece for is_piece units
--   aliases           text[] of shorthand names (tps, gm, cups, ...) the
--                     lookup keys off, besides the display name
--   is_active         soft-disable a unit from the dropdowns
--
-- Run this whole file in the Supabase SQL editor. It is idempotent.

ALTER TABLE ingredient_units
  ADD COLUMN IF NOT EXISTS family text,
  ADD COLUMN IF NOT EXISTS base_unit text,
  ADD COLUMN IF NOT EXISTS base_factor numeric,
  ADD COLUMN IF NOT EXISTS is_piece boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS piece_weight_grams numeric,
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Backfill + harden constraints.
UPDATE ingredient_units SET family = 'count' WHERE family IS NULL OR family NOT IN ('mass', 'volume', 'count');
UPDATE ingredient_units SET base_factor = NULL WHERE family = 'count';

ALTER TABLE ingredient_units
  ALTER COLUMN family SET NOT NULL,
  ALTER COLUMN is_piece SET NOT NULL,
  ALTER COLUMN aliases SET NOT NULL,
  ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE ingredient_units
  DROP CONSTRAINT IF EXISTS ingredient_units_family_check,
  ADD CONSTRAINT ingredient_units_family_check CHECK (family IN ('mass', 'volume', 'count'));

ALTER TABLE ingredient_units
  DROP CONSTRAINT IF EXISTS ingredient_units_base_factor_check,
  ADD CONSTRAINT ingredient_units_base_factor_check
    CHECK (family = 'count' OR (base_factor IS NOT NULL AND base_factor > 0));

-- Ensure name stays unique (UNIQUE already exists on the table; keep it).
CREATE UNIQUE INDEX IF NOT EXISTS ingredient_units_name_key ON ingredient_units (name);

-- ---------------------------------------------------------------------------
-- Seed. Expects the current display names already in the table (e.g. the
-- "Kilograms (kg)" rows). ON CONFLICT (name) DO UPDATE keeps them on the spec
-- values instead of duplicating rows.
-- ---------------------------------------------------------------------------

-- ===== MASS (base_unit 'g') =====
INSERT INTO ingredient_units (name, family, base_unit, base_factor, aliases, is_active) VALUES
  ('Milligrams (mg)', 'mass', 'g', 0.001, ARRAY['mg', 'milligram', 'milligrams'], true),
  ('Grams (g)',       'mass', 'g', 1,     ARRAY['g', 'gram', 'grams', 'gm', 'g (g)', 'gram (g)', 'grams (g)'], true),
  ('Kilograms (kg)',  'mass', 'g', 1000,  ARRAY['kg', 'kilogram', 'kilograms', 'kilo', 'kilos', 'kg (kg)', 'kilogram (kg)', 'kilograms (kg)'], true),
  ('Ounces (oz)',     'mass', 'g', 28.35, ARRAY['oz', 'ounce', 'ounces', 'oz (oz)'], true),
  ('Pounds (lbs)',    'mass', 'g', 454,   ARRAY['lb', 'lbs', 'pound', 'pounds', 'lb (lb)', 'pounds (lb)'], true)
ON CONFLICT (name) DO UPDATE SET
  family = EXCLUDED.family,
  base_unit = EXCLUDED.base_unit,
  base_factor = EXCLUDED.base_factor,
  aliases = EXCLUDED.aliases,
  is_active = EXCLUDED.is_active;

-- ===== VOLUME (base_unit 'mL') =====
INSERT INTO ingredient_units (name, family, base_unit, base_factor, aliases, is_active) VALUES
  ('Milliliters (mL)', 'volume', 'mL', 1,        ARRAY['ml', 'milliliter', 'milliliters', 'ml (ml)', 'milliliter (ml)', 'milliliters (ml)'], true),
  ('Liters (L)',       'volume', 'mL', 1000,     ARRAY['L', 'l', 'liter', 'liters', 'litre', 'litres', 'l (l)', 'liter (l)', 'liters (l)'], true),
  ('Teaspoons (tsp)',  'volume', 'mL', 5,        ARRAY['tsp', 'tps', 'teaspoon', 'teaspoons', 'tsp (tsp)'], true),
  ('Tablespoons (tbsp)', 'volume', 'mL', 15,     ARRAY['tbsp', 'tablespoon', 'tablespoons', 'tbsp (tbsp)'], true),
  ('Cups (cup)',       'volume', 'mL', 240,      ARRAY['cup', 'cups', 'cup (cup)', 'cups (cup)'], true),
  ('Fluid Ounces (fl oz)', 'volume', 'mL', 30,   ARRAY['fl oz', 'floz', 'fluid ounce', 'fluid ounces', 'fl oz (fl oz)'], true),
  ('Pints (pt)',       'volume', 'mL', 473,      ARRAY['pt', 'pint', 'pints', 'pt (pt)'], true),
  ('Quarts (qt)',      'volume', 'mL', 946,      ARRAY['qt', 'quart', 'quarts', 'qt (qt)'], true),
  ('Gallons (gal)',    'volume', 'mL', 3785,     ARRAY['gal', 'gallon', 'gallons', 'gal (gal)'], true)
ON CONFLICT (name) DO UPDATE SET
  family = EXCLUDED.family,
  base_unit = EXCLUDED.base_unit,
  base_factor = EXCLUDED.base_factor,
  aliases = EXCLUDED.aliases,
  is_active = EXCLUDED.is_active;

-- ===== COUNT =====
-- is_piece = true units convert to weight via a per-piece estimate (the
-- estimate itself is matched against the ingredient name, e.g. potato 150 g).
INSERT INTO ingredient_units (name, family, base_unit, base_factor, is_piece, piece_weight_grams, aliases, is_active) VALUES
  ('Pieces (pcs)', 'count', NULL, NULL, true, NULL,  ARRAY['pcs', 'pc', 'piece', 'pieces', 'pcs (pcs)', 'piece (pcs)', 'pieces (pcs)'], true),
  ('Slices',       'count', NULL, NULL, true, NULL,  ARRAY['slice', 'slices'], true),
  ('Cloves',       'count', NULL, NULL, true, NULL,  ARRAY['clove', 'cloves'], true),
  ('Sticks',       'count', NULL, NULL, true, NULL,  ARRAY['stick', 'sticks'], true),
  ('Packs',        'count', NULL, NULL, false, NULL, ARRAY['pack', 'packs'], true),
  ('Sachets',      'count', NULL, NULL, false, NULL, ARRAY['sachet', 'sachets'], true),
  ('Bottles',      'count', NULL, NULL, false, NULL, ARRAY['bottle', 'bottles'], true),
  ('Cans',         'count', NULL, NULL, false, NULL, ARRAY['can', 'cans'], true),
  ('Bunches',      'count', NULL, NULL, false, NULL, ARRAY['bunch', 'bunches'], true)
ON CONFLICT (name) DO UPDATE SET
  family = EXCLUDED.family,
  base_factor = NULL,
  is_piece = EXCLUDED.is_piece,
  piece_weight_grams = EXCLUDED.piece_weight_grams,
  aliases = EXCLUDED.aliases,
  is_active = EXCLUDED.is_active;