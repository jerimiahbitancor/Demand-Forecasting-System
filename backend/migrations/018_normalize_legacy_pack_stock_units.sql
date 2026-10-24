UPDATE public.ingredients AS ingredient
SET
  unit = 'Pieces (pcs)',
  unit_id = piece_unit.id,
  base_unit = 'pcs',
  unit_family = 'count',
  allow_fractional = false
FROM public.ingredient_units AS piece_unit
WHERE lower(piece_unit.name) = 'pieces (pcs)'
  AND (
    lower(btrim(coalesce(ingredient.unit, ''))) IN ('pack', 'packs', 'pack (pack)', 'packs (pack)')
    OR lower(btrim(coalesce(ingredient.base_unit, ''))) IN ('pack', 'packs')
    OR ingredient.unit_id IN (
      SELECT id
      FROM public.ingredient_units
      WHERE lower(name) IN ('pack', 'packs', 'pack (pack)', 'packs (pack)')
    )
  );
