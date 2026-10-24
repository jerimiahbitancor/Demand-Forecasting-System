-- ingredient_units: schema + seed for database-driven recipe unit conversion.
--
-- Recipe unit conversion is defined by the supported units in
-- shared/ingredientUnits.json and mirrored by recipeUnits (frontend,
-- backend and ml-service). This migration moves that metadata into the
-- ingredient_units table so it can be edited without a code deploy.
--
-- New columns:
--   family            'mass' | 'volume' | 'count'
--   base_unit         reference unit every member of the family normalises to
--                     ('g' for mass, 'mL' for volume, NULL for count)
--   base_factor       units of base_unit per 1 of this unit
--                     (kg -> 1000, tbsp -> 15, NULL for count)
--   is_piece          false for supported count units
--   piece_weight_grams unused for supported count units
--   aliases           text[] of shorthand names (tsp, gm, etc.) the
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
  ('Grams (g)',       'mass', 'g', 1,     ARRAY['g', 'gram', 'grams', 'gm', 'gram (g)', 'grams (g)'], true),
  ('Kilograms (kg)',  'mass', 'g', 1000,  ARRAY['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'], true)
ON CONFLICT (name) DO UPDATE SET
  family = EXCLUDED.family,
  base_unit = EXCLUDED.base_unit,
  base_factor = EXCLUDED.base_factor,
  aliases = EXCLUDED.aliases,
  is_active = EXCLUDED.is_active;

-- ===== VOLUME (base_unit 'mL') =====
INSERT INTO ingredient_units (name, family, base_unit, base_factor, aliases, is_active) VALUES
  ('Milliliters (mL)', 'volume', 'mL', 1,    ARRAY['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'], true),
  ('Liters (L)',       'volume', 'mL', 1000, ARRAY['l', 'liter', 'liters', 'litre', 'litres'], true),
  ('Tablespoons (tbsp)', 'volume', 'mL', 15, ARRAY['tbsp', 'tablespoon', 'tablespoons'], true),
  ('Teaspoons (tsp)',  'volume', 'mL', 5,    ARRAY['tsp', 'teaspoon', 'teaspoons'], true)
ON CONFLICT (name) DO UPDATE SET
  family = EXCLUDED.family,
  base_unit = EXCLUDED.base_unit,
  base_factor = EXCLUDED.base_factor,
  aliases = EXCLUDED.aliases,
  is_active = EXCLUDED.is_active;

-- ===== COUNT =====
INSERT INTO ingredient_units (name, family, base_unit, base_factor, is_piece, piece_weight_grams, aliases, is_active) VALUES
  ('Pieces (pcs)', 'count', NULL, NULL, false, NULL, ARRAY['pcs', 'pc', 'piece', 'pieces'], true)
ON CONFLICT (name) DO UPDATE SET
  family = EXCLUDED.family,
  base_factor = NULL,
  is_piece = EXCLUDED.is_piece,
  piece_weight_grams = EXCLUDED.piece_weight_grams,
  aliases = EXCLUDED.aliases,
  is_active = EXCLUDED.is_active;