const assert = require('node:assert/strict');
const test = require('node:test');
const {
  Decimal,
  UnitConversionError,
  convertRecipeQuantity,
  inventoryUnitMetadata,
  setIngredientUnitConversions,
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
  assert.ok(unitService.resolve('1', 'cup', liquid).baseAmount.eq('0.24'));
});

test('per-ingredient house measures override generic volume conversion', () => {
  setIngredientUnitConversions([{
    ingredient_id: 3,
    from_unit: 'tbsp',
    to_unit: 'g',
    factor: '12',
  }]);
  const sugar = {
    id: 3,
    name: 'Sugar',
    unit: 'Kilograms (kg)',
    base_unit: 'kg',
    unit_family: 'mass',
    density_g_per_ml: '0.83',
  };
  assert.ok(unitService.resolve('1', 'tbsp', sugar).baseAmount.eq('0.012'));
  setIngredientUnitConversions([]);
});

test('mass and volume cannot cross without explicit ingredient density', () => {
  const flour = {
    id: 4,
    name: 'Flour',
    unit: 'Kilograms (kg)',
    base_unit: 'kg',
    unit_family: 'mass',
  };
  assert.throws(() => unitService.resolve('1', 'cup', flour), UnitConversionError);
  assert.ok(unitService.resolve('100', 'mL', {
    ...flour,
    density_g_per_ml: '0.85',
    base_unit: 'g',
  }).baseAmount.eq('85'));
  assert.ok(convertRecipeQuantity('1', 'cup', 'g', { gramsPerCup: '120' }).eq('120'));
});

test('pack-to-piece conversion requires positive pack_size', () => {
  const egg = {
    id: 5,
    name: 'Egg',
    unit: 'Pieces (pcs)',
    base_unit: 'pcs',
    unit_family: 'count',
    pack_size: '12',
  };
  assert.ok(unitService.resolve('1', 'pack', egg).baseAmount.eq('12'));
  assert.throws(() => unitService.resolve('1', 'pack', { ...egg, pack_size: null }), UnitConversionError);
});

test('inventory unit metadata captures pack contents for mass, volume and discrete stock', () => {
  const strawberryPowder = inventoryUnitMetadata({
    unit: 'Grams (g)',
    name: 'Strawberry Powder',
    packQty: '50',
    packUnit: 'Grams (g)',
  });
  assert.equal(strawberryPowder.base_unit, 'g');
  assert.equal(strawberryPowder.unit_family, 'mass');
  assert.equal(strawberryPowder.pack_size, '50');
  assert.equal(strawberryPowder.allow_fractional, true);

  const chicken = inventoryUnitMetadata({
    unit: 'Kilograms (kg)',
    name: 'Chicken Breast',
    packQty: '500',
    packUnit: 'Grams (g)',
  });
  assert.equal(chicken.base_unit, 'kg');
  assert.equal(chicken.pack_size, '0.5');

  const syrup = inventoryUnitMetadata({
    unit: 'Milliliters (mL)',
    name: 'Syrup',
    packQty: '1',
    packUnit: 'Liters (L)',
  });
  assert.equal(syrup.pack_size, '1000');

  const eggs = inventoryUnitMetadata({
    unit: 'Pieces (pcs)',
    name: 'Egg',
    packQty: '12',
    packUnit: 'Pieces (pcs)',
  });
  assert.equal(eggs.pack_size, '12');
  assert.equal(eggs.allow_fractional, false);
});

test('inventory pack metadata rejects incompatible or guessed conversions', () => {
  assert.throws(() => inventoryUnitMetadata({
    unit: 'Grams (g)',
    name: 'Unknown ingredient',
    packQty: '1',
    packUnit: 'Cup',
  }), UnitConversionError);
});

test('unrecognized units and decimal arithmetic never fall back to floats', () => {
  const rice = { id: 6, name: 'Rice', unit: 'kg', base_unit: 'kg', unit_family: 'mass' };
  assert.throws(() => unitService.resolve('1', 'handful', rice), UnitConversionError);
  assert.ok(new Decimal('0.1').plus('0.2').eq('0.3'));
});
