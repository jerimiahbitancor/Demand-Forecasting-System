// tests/toBuy.crosscheck.test.mjs — run: node --test tests/toBuy.crosscheck.test.mjs
//
// "To buy" rounds UP for count units (utils/recipeUnits.js toBuyQuantity,
// used by the Grocery List and the restock email). The screen decides how
// to SHOW a count unit with the frontend's isCountUnit()
// (frontend/src/utils/formatStockQty.js). Both must agree on which units
// are count units, or the Grocery List would show "48.000" kg-style
// numbers for eggs, or round a kg amount. No network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const back = require('../utils/recipeUnits');
const front = await import(pathToFileURL(path.join(here, '..', '..', 'frontend', 'src', 'utils', 'formatStockQty.js')).href);

const UNITS = [
  'pcs', 'pc', 'piece', 'pieces', 'Pieces (pcs)', 'PCS', ' pcs ', 'sachet', 'sachets', 'pack', 'packs', 'packet',
  'bottle', 'can', 'box', 'bag', 'tray', 'bunch', 'roll', 'slice', 'slices', 'clove', 'cloves', 'stick', 'head', 'dozen',
  'kg', 'g', 'gram', 'grams', 'mg', 'L', 'l', 'mL', 'ml', 'liter', 'tbsp', 'tsp', 'oz', 'lb',
  'Kilogram (kg)', '', null, undefined, 'unknownunit',
];

test('backend isCountUnit === frontend isCountUnit for every unit', () => {
  for (const unit of UNITS) {
    assert.equal(back.isCountUnit(unit), front.isCountUnit(unit), `unit ${JSON.stringify(unit)}`);
  }
});

test('toBuyQuantity: count units round UP, others exact, never negative', () => {
  assert.equal(back.toBuyQuantity(60, 12.7, 'pcs'), 48, '47.3 -> 48');
  assert.equal(back.toBuyQuantity(60, 12, 'pcs'), 48, 'whole stays whole');
  assert.equal(back.toBuyQuantity(48.0000000001, 0, 'pcs'), 48, 'float noise does not add one');
  assert.equal(back.toBuyQuantity(0.2, 0, 'pcs'), 1, 'any part of a piece -> 1');
  assert.equal(back.toBuyQuantity(5, 9, 'pcs'), 0, 'stock covers need');
  assert.equal(Number(back.toBuyQuantity(32.4, 8, 'kg').toFixed(6)), 24.4, 'kg exact');
  assert.equal(Number(back.toBuyQuantity(1.25, 0.5, 'L').toFixed(6)), 0.75, 'L exact');
  assert.equal(back.toBuyQuantity(3, 10, 'kg'), 0);
});
