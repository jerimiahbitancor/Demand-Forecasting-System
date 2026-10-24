const assert = require('node:assert/strict');
const test = require('node:test');
const {
  Decimal,
  UnitConversionError,
  convertRecipeQuantity,
  inventoryUnitMetadata,
  unitService,
} = require('../utils/recipeUnits');

test('mass and volume conversions are exact Decimal values', () => {
  const rice = {
    id: 1,
    name: 'Rice',
    unit: 'Kilograms (kg)',
    base_unit: 'kg',
    unit_family: 'mass',
  };
  const liquid = {
    id: 2,
    name: 'Water',
    unit: 'Liters (L)',
    base_unit: 'l',
    unit_family: 'volume',
  };

  assert.ok(unitService.resolve('1', 'kg', rice).baseAmount.eq('1'));
  assert.ok(unitService.resolve('500', 'g', rice).baseAmount.eq('0.5'));
  assert.ok(unitService.resolve('1', 'L', liquid).baseAmount.eq('1'));
  assert.ok(unitService.resolve('500', 'mL', liquid).baseAmount.eq('0.5'));
  assert.ok(unitService.resolve('1', 'tsp', liquid).baseAmount.eq('0.005'));
});

test('unsupported Cups and cross-family conversions are rejected', () => {
  const flour = {
    id: 4,
    name: 'Flour',
    unit: 'Kilograms (kg)',
    base_unit: 'kg',
    unit_family: 'mass',
  };
  assert.throws(() => unitService.resolve('1', 'cup', flour), UnitConversionError);
  assert.throws(() => convertRecipeQuantity('240', 'mL', 'g'), UnitConversionError);
});

test('unsupported units are rejected and count conversion is identity-only', () => {
  const egg = {
    id: 5,
    name: 'Egg',
    unit: 'Pieces (pcs)',
    base_unit: 'pcs',
    unit_family: 'count',
  };
  assert.ok(unitService.resolve('2', 'Pieces (pcs)', egg).baseAmount.eq('2'));
  assert.throws(() => unitService.resolve('1', 'pack', egg), UnitConversionError);
  assert.throws(() => unitService.resolve('0', 'pack', egg), UnitConversionError);
  assert.throws(() => convertRecipeQuantity('0', 'pcs', 'g'), UnitConversionError);
});

test('inventory unit metadata is limited to the supported stock units', () => {
  const grams = inventoryUnitMetadata({
    unit: 'Grams (g)',
  });
  assert.equal(grams.base_unit, 'g');
  assert.equal(grams.unit_family, 'mass');
  assert.equal(grams.allow_fractional, true);
  const eggs = inventoryUnitMetadata({
    unit: 'Pieces (pcs)',
  });
  assert.equal(eggs.allow_fractional, false);
  assert.throws(() => inventoryUnitMetadata({
    unit: 'Packs',
  }), UnitConversionError);
});

test('unrecognized units and decimal arithmetic never fall back to floats', () => {
  const rice = { id: 6, name: 'Rice', unit: 'kg', base_unit: 'kg', unit_family: 'mass' };
  assert.throws(() => unitService.resolve('1', 'handful', rice), UnitConversionError);
  assert.ok(new Decimal('0.1').plus('0.2').eq('0.3'));
});
