-- Migration 022: pieces per pack on ingredients.
--
-- Why: ingredients such as a tray of eggs or a box of sachets are bought in
-- packs, but stock is counted in pieces. The owner needs to record how many
-- pieces one pack holds so staff can tell "2 packs" from "24 pcs".
--
--   pieces_per_pack  how many pieces one purchase pack holds (e.g. 30)
--                    NULL = no pack size recorded
--
-- This is only the pack size. It does not change the stock unit, the unit
-- cost, or how a recipe deducts stock.
--
-- Run in the Supabase SQL editor (same as the other migrations in this
-- folder). Safe to re-run.
-- ---------------------------------------------------------------------------

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS pieces_per_pack numeric(18,6);

COMMENT ON COLUMN public.ingredients.pieces_per_pack IS
  'How many pieces one purchase pack holds (e.g. 30 for a 30-piece pack). NULL = no pack size recorded.';

ALTER TABLE public.ingredients
  DROP CONSTRAINT IF EXISTS ingredients_pieces_per_pack_positive;

ALTER TABLE public.ingredients
  ADD CONSTRAINT ingredients_pieces_per_pack_positive
    CHECK (pieces_per_pack IS NULL OR pieces_per_pack > 0);
