-- Migration 023: purchase-pack price on ingredients.
--
-- Why: ingredients bought by the pack (a tray of eggs, a box of sachets) have
-- a price for the whole pack, while stock and recipes use pieces. Recording
-- the pack price lets the app compute the per-piece cost:
--
--   price per piece = pack_price / pieces_per_pack
--
--   pack_price  what one purchase pack costs, in the same currency as price
--               NULL = no pack price recorded
--
-- This is only the purchase price. It does not change the stock unit or how a
-- recipe deducts stock. Safe to re-run.
-- ---------------------------------------------------------------------------

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS pack_price numeric(18,6);

COMMENT ON COLUMN public.ingredients.pack_price IS
  'What one purchase pack costs. NULL = no pack price recorded. Per-piece price = pack_price / pieces_per_pack.';

ALTER TABLE public.ingredients
  DROP CONSTRAINT IF EXISTS ingredients_pack_price_positive;

ALTER TABLE public.ingredients
  ADD CONSTRAINT ingredients_pack_price_positive
    CHECK (pack_price IS NULL OR pack_price > 0);
