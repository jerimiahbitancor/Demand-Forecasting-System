ALTER TABLE public.ingredients
  DROP COLUMN IF EXISTS pack_qty,
  DROP COLUMN IF EXISTS pack_unit,
  DROP COLUMN IF EXISTS pack_price,
  DROP COLUMN IF EXISTS pack_size,
  DROP COLUMN IF EXISTS grams_per_cup,
  DROP COLUMN IF EXISTS density_g_per_ml;
