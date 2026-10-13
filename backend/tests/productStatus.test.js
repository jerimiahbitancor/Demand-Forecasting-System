// tests/productStatus.test.js — run: node --test tests/productStatus.test.js
//
// Product status (owner's v3 flowchart, page 2), in this order:
//   1. Archived  2. Discontinued (> 28 OPEN days since the last sale)
//   3. New (< 42 sales days)  4. Active
// The pure rule, the loader (paged reads, closed days not counted, 0-quantity
// rows not sales days), and the all-products recompute after an upload.
// In-memory fake database; no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const fake = createFakeSupabase();
installFake(fake);

const {
  deriveProductStatus, loadStatusInputs, statusInputsFor, countOpenDaysAfter,
  DISCONTINUED_AFTER_OPEN_DAYS, NEW_UNTIL_SALES_DAYS,
} = require('../services/productStatusService');
const { PRODUCT_STATUS_NOTES } = require('../services/productStatusConstants');

const quiet = () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
};
const restoreLoad = quiet();
const mappingService = require('../services/mappingService');
restoreLoad();

const status = (inputs) => deriveProductStatus(inputs).status;

// ---------------------------------------------------------------- pure rule

test('the thresholds are 28 open days and 42 sales days', () => {
  assert.equal(DISCONTINUED_AFTER_OPEN_DAYS, 28);
  assert.equal(NEW_UNTIL_SALES_DAYS, 42);
});

test('1. Archived wins over everything, and shows the owner\'s reason', () => {
  const r = deriveProductStatus({ archived: true, salesDays: 300, openDaysSinceLastSale: 0, inactiveReason: 'Archived: Seasonal item' });
  assert.equal(r.status, 'archived');
  assert.equal(r.label, 'ARCHIVED');
  assert.equal(r.note, 'Seasonal item');
  assert.equal(r.isArchived, true);
  assert.equal(status({ archived: true, salesDays: 0, openDaysSinceLastSale: 99 }), 'archived');
});

test('2. Discontinued: more than 28 open days since the last sale (28 is not enough)', () => {
  assert.equal(status({ salesDays: 200, openDaysSinceLastSale: 29 }), 'inactive');
  assert.equal(status({ salesDays: 200, openDaysSinceLastSale: 28 }), 'active');
  const r = deriveProductStatus({ salesDays: 200, openDaysSinceLastSale: 40 });
  assert.equal(r.label, 'INACTIVE (DISCONTINUED)');
  assert.equal(r.note, PRODUCT_STATUS_NOTES.STALE);
});

test('Discontinued is checked BEFORE New: 30 sales days, stopped 40 open days ago -> Discontinued', () => {
  assert.equal(status({ salesDays: 30, openDaysSinceLastSale: 40 }), 'inactive');
});

test('3. New: fewer than 42 sales days (41 New, 42 not); never sold -> New', () => {
  assert.equal(status({ salesDays: 41, openDaysSinceLastSale: 0 }), 'new');
  assert.equal(status({ salesDays: 42, openDaysSinceLastSale: 0 }), 'active');
  const never = deriveProductStatus({ salesDays: 0, openDaysSinceLastSale: null });
  assert.equal(never.status, 'new');
  assert.equal(never.note, PRODUCT_STATUS_NOTES.NEVER_SOLD);
  assert.equal(deriveProductStatus({ salesDays: 10, openDaysSinceLastSale: 3 }).note, PRODUCT_STATUS_NOTES.NEW_PRODUCT);
});

test('4. Active: 42+ sales days and sold within 28 open days', () => {
  const r = deriveProductStatus({ salesDays: 300, openDaysSinceLastSale: 1 });
  assert.equal(r.status, 'active');
  assert.equal(r.isActive, true);
});

test('countOpenDaysAfter counts strictly after the last sale', () => {
  const open = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06'];
  assert.equal(countOpenDaysAfter(open, '2026-10-02'), 2, 'the sale day itself is not counted');
  assert.equal(countOpenDaysAfter(open, '2026-09-30'), 4);
  assert.equal(countOpenDaysAfter(open, '2026-10-06'), 0);
  assert.equal(countOpenDaysAfter(open, null), null, 'never sold');
});

// ---------------------------------------------------------------- loader

const day = (offset) => new Date(Date.UTC(2026, 8, 1 + offset)).toISOString().slice(0, 10); // from 2026-09-01

function seedLoader() {
  const businessDays = [];
  // 40 days after 2026-09-01: every 3rd one closed, one left unconfirmed.
  for (let i = 1; i <= 40; i += 1) {
    if (i === 20) continue; // unconfirmed: no row at all
    businessDays.push({ business_date: day(i), status: i % 3 === 0 ? 'confirmed_closed' : 'confirmed_open' });
  }
  fake.reset({
    products: [],
    business_days: businessDays,
    daily_sales: [
      // product 1 sold 3 days, then a 0-quantity row (refunds cancelled it).
      { product_id: 1, sale_date: day(0), quantity_sold: 2 },
      { product_id: 1, sale_date: day(1), quantity_sold: 1 },
      { product_id: 1, sale_date: day(2), quantity_sold: 4 },
      { product_id: 1, sale_date: day(5), quantity_sold: 0 },
      // product 2 sold once, on day 0.
      { product_id: 2, sale_date: day(0), quantity_sold: 3 },
    ],
  });
}

test('loader: closed and unconfirmed days are NOT open days; 0-quantity rows are not sales days', async () => {
  seedLoader();
  const loaded = await loadStatusInputs(fake, { today: day(40) });
  // Open days = 1..40 minus every 3rd (closed) minus day 20 (unconfirmed).
  const expectedOpen = [];
  for (let i = 1; i <= 40; i += 1) if (i !== 20 && i % 3 !== 0) expectedOpen.push(day(i));
  assert.deepEqual(loaded.openDates, expectedOpen);

  const p1 = statusInputsFor({ id: 1, status: 'active' }, loaded);
  assert.equal(p1.salesDays, 3, 'the 0-quantity row is not a sales day');
  assert.equal(p1.lastSaleDate, day(2), 'last REAL sale, not the 0-quantity row');
  assert.equal(p1.openDaysSinceLastSale, expectedOpen.filter((d) => d > day(2)).length);

  const p2 = statusInputsFor({ id: 2, status: 'active' }, loaded);
  assert.equal(p2.openDaysSinceLastSale, expectedOpen.length, 'all 26 open days are after day 0');
  // 40 calendar days without a sale, but only 26 OPEN days: not Discontinued yet.
  assert.equal(expectedOpen.length, 26);
  assert.equal(deriveProductStatus(p2).status, 'new');
});

test('loader: open days after today are ignored', async () => {
  seedLoader();
  const loaded = await loadStatusInputs(fake, { today: day(10) });
  assert.ok(loaded.openDates.every((d) => d <= day(10)));
});

test('loader: a fixed number of reads, whatever the number of products (no per-product queries)', async () => {
  const sales = [];
  for (let p = 1; p <= 150; p += 1) for (let d = 0; d < 10; d += 1) sales.push({ product_id: p, sale_date: day(d), quantity_sold: 1 });
  fake.reset({ business_days: [{ business_date: day(1), status: 'confirmed_open' }], daily_sales: sales });
  let reads = 0;
  const counting = { from: (t) => { reads += 1; return fake.from(t); } };
  const loaded = await loadStatusInputs(counting, { today: day(30) });
  assert.equal(loaded.byProduct.size, 150);
  assert.ok(reads <= 6, `expected a handful of paged reads, got ${reads}`);
});

test('loader: without the product_sales_summary view it falls back to reading the sales rows', async () => {
  seedLoader();
  const missingView = {
    from(table) {
      if (table !== 'product_sales_summary') return fake.from(table);
      const err = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.product_sales_summary'" } };
      const b = { select: () => b, in: () => b, order: () => b, range: () => b, then: (res, rej) => Promise.resolve(err).then(res, rej) };
      return b;
    },
  };
  const restore = quiet();
  const loaded = await loadStatusInputs(missingView, { today: day(40) });
  restore();
  const p1 = statusInputsFor({ id: 1 }, loaded);
  assert.equal(p1.salesDays, 3);
  assert.equal(p1.lastSaleDate, day(2));
});

// ---------------------------------------------------------------- recompute after upload

test('reconcileProductActivation recomputes ALL products with the new rules; archived untouched', async () => {
  const open = [];
  for (let i = 1; i <= 60; i += 1) open.push({ business_date: day(i), status: 'confirmed_open' });
  const salesFor = (productId, days, startOffset = 0) => Array.from({ length: days }, (_, i) => ({
    product_id: productId, sale_date: day(startOffset + i), quantity_sold: 2,
  }));
  fake.reset({
    products: [
      { id: 1, name: 'Steady', status: 'inactive_new', inactive_reason: null },        // 50 days, sells to day 49 -> active
      { id: 2, name: 'Stopped', status: 'active', inactive_reason: null },             // 30 days, last day 29, 31 open days since -> discontinued
      { id: 3, name: 'Young', status: 'active', inactive_reason: null },               // 10 days -> new
      { id: 4, name: 'Archived', status: 'archived', inactive_reason: 'Archived by user' }, // stays
      { id: 5, name: 'Never sold', status: 'active', inactive_reason: null },          // -> new
    ],
    business_days: open,
    daily_sales: [...salesFor(1, 50), ...salesFor(2, 30), ...salesFor(3, 10, 50), ...salesFor(4, 60)],
  });
  const restore = quiet();
  const realNow = process.env.DEV_NOW_OVERRIDE;
  process.env.DEV_NOW_OVERRIDE = '2026-10-31T12:00:00+08:00'; // today = day(60)
  try {
    const out = await mappingService.reconcileProductActivation();
    assert.equal(out.checked, 5);
  } finally {
    if (realNow === undefined) delete process.env.DEV_NOW_OVERRIDE; else process.env.DEV_NOW_OVERRIDE = realNow;
    restore();
  }
  const statusOf = (id) => fake.tables.products.find((p) => p.id === id).status;
  assert.equal(statusOf(1), 'active');
  assert.equal(statusOf(2), 'inactive_discontinued');
  assert.equal(statusOf(3), 'inactive_new');
  assert.equal(statusOf(4), 'archived');
  assert.equal(statusOf(5), 'inactive_new');
});
