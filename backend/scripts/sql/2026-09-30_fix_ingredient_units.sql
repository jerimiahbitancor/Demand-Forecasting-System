-- 2026-09-30_fix_ingredient_units.sql
--
-- WHAT: cleans up ingredient_units so every unit the owner can pick is
-- understood by the recipe math (backend/utils/recipeUnits.js).
--
-- WHY: three old rows were created by hand before the conversion columns
-- existed. The 2026-09-17 migration gave them family = 'count' with no
-- base_factor and no aliases, so the system treats them as plain counts and
-- never converts them:
--     "KG"               (count)  duplicate of "Kilograms (kg)"  (mass, 1000 g)
--     "Cups"             (count)  duplicate of "Cups (cup)"      (volume, 240 mL)
--     "Teaspoons (tps)"  (count)  duplicate of "Teaspoons (tsp)" (volume, 5 mL)
-- If one of them is chosen for an ingredient or a recipe line, "1 KG" is not
-- converted to 1000 g, so cost / demand / stock deduction are off by 1000x
-- (or 240x, 5x). They show up in the unit dropdowns next to the good rows.
--
-- Also: 2 ingredients (Pork, Egg) have unit_id = NULL. Conversion reads the
-- text `unit` column so the math is unaffected today, but the link should be
-- filled in (ingredients.unit_id -> ingredient_units.id).
--
-- STATE CHECKED (read-only, Sep 30 2026): no ingredient uses the three bad
-- names, and product_ingredients is empty, so the remaps below touch 0 rows
-- today. They are still in the script so it stays safe if that changes
-- before it is run.
--
-- WHAT THIS DOES NOT FIX:
--   * grams_per_cup is empty for all 103 ingredients (see notes in chat).
--   * createUnit in unitsController.js inserts only { name }, but `family` is
--     NOT NULL with no default — adding a unit from Settings will fail.
--
-- SAFE TO RE-RUN.
--
-- HOW TO RUN (Supabase SQL editor):
--   1. Run STEP 1 alone. Read the output.
--   2. Run STEP 2 alone. It ends in ROLLBACK, so nothing is saved — check
--      the "after" query results it prints.
--   3. If the numbers look right, change the last line of STEP 2 from
--      ROLLBACK to COMMIT and run STEP 2 again.
--   4. Restart the backend (or open Settings > Units once): unit metadata is
--      cached in memory and only reloaded at boot or on a unit edit.

-- ===========================================================================
-- STEP 1 — DRY RUN (read-only)
-- ===========================================================================

-- 1a. Units the recipe math cannot convert: count units that are not one of
--     the known count units (pieces, slices, cloves, sticks, packs, ...).
--     Expect exactly: Cups, KG, Teaspoons (tps).
select id, name, family, base_factor, aliases
from ingredient_units
where family = 'count'
  and name not in ('Pieces (pcs)', 'Slices', 'Cloves', 'Sticks',
                   'Packs', 'Sachets', 'Bottles', 'Cans', 'Bunches')
order by name;

-- 1b. Who uses the bad names right now? Expect 0 everywhere.
select 'ingredients' as source, unit, count(*) as rows_using_it
from ingredients
where unit in ('KG', 'Cups', 'Teaspoons (tps)')
group by unit
union all
select 'product_ingredients', unit, count(*)
from product_ingredients
where unit in ('KG', 'Cups', 'Teaspoons (tps)')
group by unit;

-- 1c. Ingredients whose unit_id is missing or disagrees with their text unit.
--     Expect 2 rows: Pork and Egg, both with unit_id NULL.
select i.id, i.name, i.unit, i.unit_id, u.name as linked_unit_name
from ingredients i
left join ingredient_units u on u.id = i.unit_id
where i.unit_id is null or u.name is distinct from i.unit
order by i.id;

-- ===========================================================================
-- STEP 2 — APPLY (ends in ROLLBACK; change to COMMIT once checked)
-- ===========================================================================
-- Every statement below carries its own copy of the old -> new mapping (no
-- temp table, no DO block), so it still works if the SQL editor runs each
-- statement separately.
begin;

-- Move anything that still uses an old name onto the correct row.
update ingredients i
set unit = m.new_name
from (values ('KG', 'Kilograms (kg)'),
             ('Cups', 'Cups (cup)'),
             ('Teaspoons (tps)', 'Teaspoons (tsp)')) as m(old_name, new_name)
where i.unit = m.old_name
  and exists (select 1 from ingredient_units t where t.name = m.new_name);

update product_ingredients p
set unit = m.new_name
from (values ('KG', 'Kilograms (kg)'),
             ('Cups', 'Cups (cup)'),
             ('Teaspoons (tps)', 'Teaspoons (tsp)')) as m(old_name, new_name)
where p.unit = m.old_name
  and exists (select 1 from ingredient_units t where t.name = m.new_name);

-- Fill / repair the unit_id link for every ingredient (text unit is the truth).
update ingredients i
set unit_id = u.id
from ingredient_units u
where u.name = i.unit
  and i.unit_id is distinct from u.id;

-- Remove the three broken rows. Only if the correct replacement row exists and
-- nothing still uses the old one (ingredients.unit_id is ON DELETE SET NULL).
delete from ingredient_units u
using (values ('KG', 'Kilograms (kg)'),
              ('Cups', 'Cups (cup)'),
              ('Teaspoons (tps)', 'Teaspoons (tsp)')) as m(old_name, new_name)
where u.name = m.old_name
  and u.family = 'count'
  and exists (select 1 from ingredient_units t where t.name = m.new_name)
  and not exists (select 1 from ingredients i where i.unit = u.name)
  and not exists (select 1 from product_ingredients p where p.unit = u.name);

-- ---- "after" checks ----
-- NOTE: the editor only shows the result of the LAST select in a script.

-- Should be 23 units: 5 mass + 9 volume + 9 count.
select family, count(*) as units
from ingredient_units
group by family
order by family;

rollback;  -- change to: commit;

-- ---- After you COMMIT, run these separately. Both should return 0 rows. ----
-- select id, name, family from ingredient_units where name in ('KG', 'Cups', 'Teaspoons (tps)');
-- select i.id, i.name, i.unit, i.unit_id from ingredients i
--   left join ingredient_units u on u.id = i.unit_id
--   where i.unit_id is null or u.name is distinct from i.unit;
