-- Migration 012: purchase pack ("how much is in one sachet/pack, and what
-- does that pack cost") on ingredients.
--
-- Why: an ingredient's unit cost used to be a single flat number the owner
-- typed per stock unit, so there was nowhere to record "blue lemonade powder
-- comes in 150 g sachets and each sachet costs ₱200". Without the pack the
-- system could not answer "what does one tablespoon cost?" either — the
-- recipe amount has to be weighed against the sachet, and the sachet has to
-- be spread over its 150 g.
--
-- What the columns mean:
--   pack_qty   amount in ONE purchase pack            (150)
--   pack_unit  unit that amount is measured in        (Grams (g))
--   pack_price what ONE purchase pack costs in pesos  (200)
--
-- ingredients.price stays the price per ingredients.unit (the stock unit) —
-- the API recomputes it from the pack on every save, so every existing cost
-- path (COGS, ingredient demand, grocery list, forecast est_cost) keeps
-- working unchanged. 150 g for ₱200 stored on a "Kilograms (kg)" ingredient
-- becomes price = 200 / 0.15 = 1333.33 per kg.
--
-- Run in the Supabase SQL editor (same as the other migrations in this
-- folder). Safe to re-run.
-- ---------------------------------------------------------------------------

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS pack_qty   numeric,
  ADD COLUMN IF NOT EXISTS pack_unit  character varying(80),
  ADD COLUMN IF NOT EXISTS pack_price numeric;

COMMENT ON COLUMN public.ingredients.pack_qty   IS 'Quantity contained in one purchase pack (e.g. 150 for a 150 g sachet). NULL = no pack recorded.';
COMMENT ON COLUMN public.ingredients.pack_unit  IS 'Unit of pack_qty (e.g. Grams (g)).';
COMMENT ON COLUMN public.ingredients.pack_price IS 'Cost in pesos of one purchase pack (e.g. 200).';

-- Backfill: an ingredient with no pack is treated as "you buy exactly one of
-- its stock unit at a time", which derives the same unit price it already
-- had (price = pack_price / 1 when pack_unit = unit). Every row therefore
-- shows something sensible in the Pack column instead of a blank.
UPDATE public.ingredients
SET pack_qty   = 1,
    pack_unit  = unit,
    pack_price = price
WHERE pack_qty IS NULL
  AND unit IS NOT NULL
  AND price IS NOT NULL;
