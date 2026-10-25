-- Migration 024: optional grams per purchase pack.
--
-- Why: mass ingredients bought by the pack (a 500 g bag of powder, a 1 kg
-- pouch) can record the pack weight and price, so the app computes the cost
-- per stock unit:
--
--   price per gram  = pack_price / grams_per_pack
--   price per kg    = pack_price / (grams_per_pack / 1000)
--
--   grams_per_pack  how many grams one purchase pack contains
--                   NULL = no pack weight recorded
--
-- Optional: an ingredient can still use the manually entered cost per unit.
-- This does not change the stock unit or recipe deductions. Safe to re-run.
-- ---------------------------------------------------------------------------

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS grams_per_pack numeric(18,6);

COMMENT ON COLUMN public.ingredients.grams_per_pack IS
  'How many grams one purchase pack contains. NULL = no pack weight recorded. Per-unit price = pack_price / grams_per_pack (converted to the stock unit).';

ALTER TABLE public.ingredients
  DROP CONSTRAINT IF EXISTS ingredients_grams_per_pack_positive;

ALTER TABLE public.ingredients
  ADD CONSTRAINT ingredients_grams_per_pack_positive
    CHECK (grams_per_pack IS NULL OR grams_per_pack > 0);
