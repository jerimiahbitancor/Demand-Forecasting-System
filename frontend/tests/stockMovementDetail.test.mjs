import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockMovementDetail } from '../src/utils/stockMovementDetail.js';

test('sale without a shortfall shows nothing extra', () => {
  const detail = stockMovementDetail({
    transaction_type: 'sale',
    quantity: -2.8,
    unit: 'Kilograms (kg)',
    shortfall_quantity: 0,
    notes: 'Exact requested: 2.8; rounded request: 2.8; applied: 2.8; shortfall: 0 Kilograms (kg)'
  }, 'Kilograms (kg)');

  assert.equal(detail, '');
});

test('sale with a shortfall shows the short amount and how it is closed', () => {
  const detail = stockMovementDetail({
    transaction_type: 'sale',
    quantity: -2,
    unit: 'Kilograms (kg)',
    shortfall_quantity: 0.5,
    notes: 'Exact requested: 2.5; rounded request: 2.5; applied: 2; shortfall: 0.5 Kilograms (kg)'
  }, 'Kilograms (kg)');

  assert.equal(detail, 'Short 0.5 Kilograms (kg) · a stock count clears it');
});

test('plain restock shows nothing extra', () => {
  const detail = stockMovementDetail({
    transaction_type: 'restock',
    quantity: 30,
    unit: 'Grams (g)',
    received_quantity: 30,
    notes: 'Received 30 Grams (g); stock is now 50 Grams (g).'
  }, 'Grams (g)');

  assert.equal(detail, '');
});

test('restock by pack keeps the note of the owner and the number of packs', () => {
  const detail = stockMovementDetail({
    transaction_type: 'restock',
    quantity: 50,
    unit: 'Grams (g)',
    received_quantity: 50,
    notes: 'pack live check · Received 1 pack (50 Grams (g)) · Stock is now 50 Grams (g).'
  }, 'Grams (g)');

  assert.equal(detail, 'pack live check · Received 1 pack (50 Grams (g))');
});

test('a count keeps the note of the owner', () => {
  const detail = stockMovementDetail({
    transaction_type: 'adjustment',
    quantity: 15,
    unit: 'Grams (g)',
    notes: 'Updated via edit'
  }, 'Grams (g)');

  assert.equal(detail, 'Updated via edit');
});

test('a restock with a received amount that differs from the change shows it', () => {
  const detail = stockMovementDetail({
    transaction_type: 'restock',
    quantity: 30,
    unit: 'Grams (g)',
    received_quantity: 30.5,
    notes: ''
  }, 'Grams (g)');

  assert.equal(detail, 'Received 30.5 Grams (g)');
});
