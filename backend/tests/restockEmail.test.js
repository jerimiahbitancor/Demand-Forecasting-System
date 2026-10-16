// tests/restockEmail.test.js — run: node --test tests/restockEmail.test.js
//
// Stock alerts + the daily restock email (Oct 17 2026):
//   - one status rule (services/stockAlertService.js) = the Ingredient
//     Management page's rule (parity with the old inventoryController code)
//   - the restock list: groups, sorting, bar width, No Forecast rows, prices
//   - the email (services/restockEmail.js): 15-row cap, escaping, plain text
//   - the refresh (notificationService.runStockRefresh) against an in-memory
//     database through the REAL code path: one email per Manila day (DB
//     based, survives a restart), a second only for a NEW out/critical item
// fetch is mocked: Brevo is NEVER called.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeSupabase, installFake } = require('./helpers/fakeSupabase');

process.env.LOG_LEVEL = 'error';

const fake = createFakeSupabase({}, { defaults: { notifications: { read: false } } });
installFake(fake);

const brevoCalls = [];
let brevoOk = true;
global.fetch = async (url, options = {}) => {
  brevoCalls.push({ url, body: options.body ? JSON.parse(options.body) : null });
  return brevoOk
    ? { ok: true, status: 201, statusText: 'Created', json: async () => ({ messageId: 'm-1' }) }
    : { ok: false, status: 500, statusText: 'Server Error', json: async () => ({ message: 'boom' }) };
};

const quiet = () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  return () => Object.assign(console, saved);
};

const restoreLoad = quiet();
const analyticsService = require('../services/analyticsService');
const stock = require('../services/stockAlertService');
const { buildRestockEmail, restockListFromMetadata } = require('../services/restockEmail');
const notificationService = require('../services/notificationService');
restoreLoad();
const { runStockRefresh, _waitForEmails, _resetEmailState } = notificationService;

// ---------------------------------------------------------------- status rule

// The Ingredient Management page's rule as it was before Oct 17 (copied
// from controllers/inventoryController.js). The shared helper must answer
// exactly the same label for every case.
function oldPageStatus(item, need) {
  if (item.is_archived) return 'Archived';
  if ((Number(item.quantity) || 0) === 0) return 'Critical Stock';
  const status = analyticsService.computeStockStatus(Number(item.quantity) || 0, need || 0);
  return status === 'No Forecast' ? 'No Forecast' : `${status} Stock`;
}

test('parity: classifyStock().pageLabel === the old Ingredient Management status, every case', () => {
  const quantities = [0, '0', null, undefined, 0.001, 0.4, 0.5, 1, 1.999, 2, 2.0001, 5, 100, '3.5', -1];
  const needs = [0, null, undefined, 0.001, 1, 2, 4, 1000];
  let cases = 0;
  for (const is_archived of [false, true]) {
    for (const quantity of quantities) {
      for (const need of needs) {
        const item = { quantity, is_archived };
        assert.equal(
          stock.classifyStock({ quantity, isArchived: is_archived, need }).pageLabel,
          oldPageStatus(item, need),
          JSON.stringify({ quantity, is_archived, need }),
        );
        cases += 1;
      }
    }
  }
  assert.ok(cases > 200);
});

test('alert groups: out, Critical, Low alert; Normal/Excess do not; No Forecast keeps min_stock', () => {
  const group = (quantity, need, minStock = 0) => stock.alertGroupOf(
    stock.classifyStock({ quantity, need }), { quantity, minStock },
  );
  assert.equal(group(0, 10), 'out');
  assert.equal(group(0, 0), 'out', 'out of stock with no forecast still alerts');
  assert.equal(group(4, 10), 'critical');
  assert.equal(group(9, 10), 'low');
  assert.equal(group(10, 10), null, 'Normal');
  assert.equal(group(25, 10), null, 'Excess');
  assert.equal(group(3, 0, 5), 'low', 'No Forecast + quantity <= min_stock');
  assert.equal(group(6, 0, 5), null, 'No Forecast above min_stock');
  assert.equal(group(3, 0, 0), null, 'No Forecast, min_stock 0');
  assert.equal(group(0.4, 1, 0), 'critical', 'Critical with min_stock 0 now alerts (the old rule missed it)');
});

test('bar width: stock / need, capped at 100; no bar without a need', () => {
  assert.equal(stock.coveragePct(8, 32), 25);
  assert.equal(stock.coveragePct(50, 10), 100, 'stock > need caps at 100');
  assert.equal(stock.coveragePct(0, 10), 0);
  assert.equal(stock.coveragePct(5, 0), null, 'need 0 -> no bar');
  assert.equal(stock.coveragePct(5, null), null);
});

// ---------------------------------------------------------------- restock list

const ing = (id, name, quantity, extra = {}) => ({ id, name, quantity, min_stock: 0, unit: 'kg', is_archived: false, ...extra });
const needOf = (need, parts = []) => ({ need, byProduct: new Map(parts) });

test('list: groups in order Out of stock, Critical, Low; est. cost desc inside a group; no-price last', () => {
  const items = stock.buildRestockItems({
    ingredients: [
      ing(1, 'Low cheap', 9), ing(2, 'Critical pricey', 1), ing(3, 'Out', 0), ing(4, 'Critical cheap', 1),
      ing(5, 'Low pricey', 9), ing(6, 'Critical no price', 1), ing(7, 'Normal', 10),
    ],
    needs: new Map([[1, needOf(10)], [2, needOf(10)], [3, needOf(2)], [4, needOf(10)], [5, needOf(10)], [6, needOf(10)], [7, needOf(10)]]),
    prices: new Map([[1, { price: 1 }], [2, { price: 100 }], [3, { price: 95 }], [4, { price: 2 }], [5, { price: 50 }]]),
  });
  assert.deepEqual(items.map((i) => i.name), [
    'Out', 'Critical pricey', 'Critical cheap', 'Critical no price', 'Low pricey', 'Low cheap',
  ]);
  const out = items[0];
  assert.equal(out.group, 'out');
  assert.equal(out.toBuy, 2, 'to buy = need - stock (Grocery List rule)');
  assert.equal(out.estCost, 190, 'to buy x latest market price');
  const noPrice = items.find((i) => i.name === 'Critical no price');
  assert.equal(noPrice.price, null);
  assert.equal(noPrice.estCost, null);
  const sum = stock.summarizeRestock(items);
  assert.deepEqual(sum.counts, { out: 1, critical: 3, low: 2, total: 6 });
  assert.equal(sum.unpricedCount, 1);
  assert.equal(sum.totalEstCost, 190 + 900 + 18 + 50 + 1);
});

test('list: "used in" = up to 3 products that use the most; No Forecast rows use the min_stock rule', () => {
  const items = stock.buildRestockItems({
    ingredients: [ing(1, 'Rice', 8), ing(2, 'Salt', 1, { min_stock: 3 })],
    needs: new Map([[1, needOf(32, [[11, 2], [12, 20], [13, 5], [14, 5.5]])]]),
    productNames: new Map([[11, 'Hotsilog'], [12, 'Tapsilog'], [13, 'Porksilog'], [14, 'Longsilog']]),
  });
  assert.deepEqual(items[0].usedIn, ['Tapsilog', 'Longsilog', 'Porksilog']);
  const salt = items.find((i) => i.name === 'Salt');
  assert.equal(salt.group, 'low');
  assert.equal(salt.rule, 'min_stock');
  assert.equal(salt.need, null);
  assert.equal(salt.toBuy, null);
  assert.equal(salt.coveragePct, null);
});

// ---------------------------------------------------------------- email

const FOR_DATE = '2026-10-17'; // a Saturday
const STOCK_AT = '2026-10-16T22:39:00.000Z'; // 6:39 AM Manila, Sat 17 Oct
const item = (over) => ({
  ingredientId: 1, name: 'Rice', unit: 'kg', group: 'critical', status: 'Critical', rule: 'forecast',
  stock: 8, need: 32.4, minStock: 0, toBuy: 24.4, coveragePct: 24.69, price: 48, estCost: 1171.2,
  usedIn: ['Tapsilog', 'Porksilog'], ...over,
});
const listOf = (items) => ({
  forDate: FOR_DATE, safetyBufferPct: 15, stockAt: STOCK_AT, items, ...stock.summarizeRestock(items),
});

test('email: subject, heading, sub-line, summary, row, bar, cost, caveat and button', () => {
  const email = buildRestockEmail(listOf([
    item({ ingredientId: 3, name: 'Cooking oil', unit: 'L', group: 'out', status: 'Out of stock', stock: 0, need: 2, toBuy: 2, coveragePct: 0, price: 95, estCost: 190, usedIn: ['Tapsilog'] }),
    item({}),
  ]), { baseUrl: 'https://chefduo.example.app/' });
  assert.equal(email.subject, 'ChefDuo: 2 ingredients to restock (1 critical)');
  assert.match(email.html, />2 ingredients to restock for Saturday</);
  assert.match(email.html, /Based on Saturday&#39;s forecast plus your 15% safety buffer\. Stock counted as of 6:39 AM, Sat 17 Oct 2026\./);
  assert.match(email.preheader, /^1 out of stock, 1 critical\. About ₱1,361 at current market prices\.$/);
  assert.match(email.html, />Buy 24\.4 kg</);
  assert.match(email.html, /Have 8 kg of 32\.4 kg needed\. For Tapsilog, Porksilog/);
  assert.match(email.html, /<td width="25%" style="height:6px;background:#C62828;/, 'bar width = coverage, critical colour');
  assert.match(email.html, /<td width="0%" style="height:6px;/, 'out of stock: empty bar');
  assert.match(email.html, />₱1,171</);
  assert.match(email.html, /Some amounts may be overstated while recipe units are being corrected\./);
  assert.match(email.html, /href="https:\/\/chefduo\.example\.app\/ingredient-demand"[^>]*>Open grocery list</);
  assert.match(email.html, /max-width:600px/);
  assert.doesNotMatch(email.html, /<img|<link|@import|<style|font-face/i, 'no images, no web fonts, inline styles only');
});

test('email: numbers at most 2 decimals', () => {
  const email = buildRestockEmail(listOf([item({ stock: 1.23456, need: 7.891011, toBuy: 6.656451 })]));
  assert.match(email.html, /Have 1\.23 kg of 7\.89 kg needed/);
  assert.match(email.html, />Buy 6\.66 kg</);
  assert.doesNotMatch(email.text, /\d\.\d{3,}/);
});

test('email: 15 rows at most, then "…and N more in the grocery list."', () => {
  const items = Array.from({ length: 20 }, (_, i) => item({ ingredientId: i + 1, name: `Item ${i + 1}`, group: 'low', status: 'Low' }));
  const email = buildRestockEmail(listOf(items));
  assert.equal((email.html.match(/>Buy 24\.4 kg</g) || []).length, 15);
  assert.match(email.html, /…and 5 more in the grocery list\./);
  assert.match(email.html, />Low \(20\)</, 'the group header counts every item, not only the shown ones');
  assert.match(email.text, /…and 5 more in the grocery list\./);
  assert.equal(email.text.split('\n').filter((l) => l.startsWith('- ')).length, 15);
});

test('email: "No price yet", and a caveat that counts the items without a price', () => {
  const email = buildRestockEmail(listOf([item({ price: null, estCost: null }), item({ ingredientId: 2, name: 'Egg' })]));
  assert.match(email.html, />No price yet</);
  assert.match(email.html, /Costs use the latest market prices; 1 item has no price yet\./);
});

test('email: No Forecast (min_stock) rows say "Have X, minimum Y" and have no bar', () => {
  const email = buildRestockEmail(listOf([
    item({ name: 'Salt', group: 'low', status: 'Low', rule: 'min_stock', stock: 1, need: null, minStock: 3, toBuy: null, coveragePct: null, price: 20, estCost: null, usedIn: [] }),
  ]));
  assert.match(email.html, /Have 1 kg, minimum 3 kg/);
  assert.match(email.html, />Restock</);
  assert.doesNotMatch(email.html, /height:6px/, 'no bar');
  assert.match(email.text, /- Salt: Restock\. Have 1 kg, minimum 3 kg\. —/);
});

test('email: every value is escaped (an ingredient named <b>Salt</b>)', () => {
  const email = buildRestockEmail(listOf([item({ name: '<b>Salt</b>', unit: '<i>kg</i>', usedIn: ['Chick & "Fries"'] })]));
  assert.doesNotMatch(email.html, /<b>Salt<\/b>|<i>kg<\/i>/);
  assert.match(email.html, /&lt;b&gt;Salt&lt;\/b&gt;/);
  assert.match(email.html, /Chick &amp; &quot;Fries&quot;/);
  assert.match(email.text, /- <b>Salt<\/b>: /, 'plain text keeps the raw name (no HTML there)');
});

test('email: plain text has the same rows, one per line, in the same order', () => {
  const items = [
    item({ ingredientId: 3, name: 'Cooking oil', unit: 'L', group: 'out', status: 'Out of stock', stock: 0, need: 2, toBuy: 2, coveragePct: 0, price: 95, estCost: 190, usedIn: ['Tapsilog'] }),
    item({}),
    item({ ingredientId: 5, name: 'Calamansi', group: 'low', status: 'Low', stock: 0.5, need: 0.8, toBuy: 0.3, price: 150, estCost: 45, usedIn: [] }),
  ];
  const { text } = buildRestockEmail(listOf(items), { baseUrl: 'https://x.app' });
  const rows = text.split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(rows, [
    '- Cooking oil: Buy 2 L. Have 0 L of 2 L needed. For Tapsilog. ₱190',
    '- Rice: Buy 24.4 kg. Have 8 kg of 32.4 kg needed. For Tapsilog, Porksilog. ₱1,171',
    '- Calamansi: Buy 0.3 kg. Have 0.5 kg of 0.8 kg needed. ₱45',
  ]);
  assert.match(text, /^3 ingredients to restock for Saturday$/m);
  assert.match(text, /^OUT OF STOCK \(1\)$/m);
  assert.match(text, /Open grocery list: https:\/\/x\.app\/ingredient-demand/);
});

// ---------------------------------------------------------------- refresh (real path, fake DB)

// 2026-10-17 01:00 UTC = Sat 17 Oct 09:00 Manila.
const NOW = new Date('2026-10-17T01:00:00Z');
const LATER = new Date('2026-10-17T07:00:00Z'); // 15:00 Manila, same day
const NEXT_DAY = new Date('2026-10-18T01:00:00Z');
const EMAIL_ENV = ['EMAIL_REMINDERS_ENABLED', 'BREVO_API_KEY', 'BREVO_SENDER_EMAIL', 'FRONTEND_URL'];
function setEmail(on) {
  for (const k of EMAIL_ENV) delete process.env[k];
  if (on) Object.assign(process.env, { EMAIL_REMINDERS_ENABLED: 'true', BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 's@example.com', FRONTEND_URL: 'https://chefduo.example.app' });
}

const ingredientRow = (id, name, quantity, unit = 'kg', min_stock = 0) => ({ id, name, quantity, unit, min_stock, is_archived: false, category: 'x', price: 0, grams_per_cup: null });
function seedWorld({ riceQty = 8, eggQty = 50, users = [{ id: 7 }] } = {}) {
  const ingredients = [
    ingredientRow(1, 'Rice', riceQty),
    ingredientRow(2, 'Egg', eggQty, 'pcs'),
    ingredientRow(3, 'Salt', 1, 'kg', 3), // no recipe -> No Forecast, below min_stock
  ];
  // Product 11 (Tapsilog): 0.2 kg rice + 1 egg per plate; 100 plates forecast,
  // 15% buffer -> rice need 23, egg need 115.
  const recipe = (ingredientId, qty, unit) => ({
    product_id: 11, unit, quantity_per_serving: qty, ingredients: { ...ingredients.find((i) => i.id === ingredientId) },
  });
  fake.reset({
    user: users,
    business_profile: [{ id: 1, business_email: 'owner@example.com' }],
    forecast_config: [{ id: 1, safety_buffer_percentage: 15 }],
    ingredients,
    products: [{ id: 11, name: 'Tapsilog' }],
    product_ingredients: [recipe(1, 0.2, 'kg'), recipe(2, 1, 'pcs')],
    forecasts: [{ id: 1, product_id: 11, forecast_date: '2026-10-17', predicted_quantity: 100 },
      { id: 2, product_id: 11, forecast_date: '2026-10-18', predicted_quantity: 100 }],
    market_price: [{ ingredient_id: 1, price: 50, source: 'da', scraped_at: '2026-10-16T00:00:00Z' }],
    notifications: [],
  });
  brevoCalls.length = 0;
  brevoOk = true;
  _resetEmailState();
}

async function refresh(now, extra = {}) {
  const restore = quiet();
  try {
    const out = await runStockRefresh({ now, trigger: 'test', ...extra });
    await _waitForEmails();
    return out;
  } finally {
    restore();
  }
}

const summaries = () => fake.tables.notifications.filter((n) => n.metadata && n.metadata.kind === 'restock_summary');
const stockAlerts = () => fake.tables.notifications.filter((n) => n.metadata && n.metadata.kind === 'low_stock');

test('refresh: bell alerts per ingredient (not emailed) + one summary with the list; ONE email', async () => {
  seedWorld();
  setEmail(true);
  const out = await refresh(NOW);
  setEmail(false);

  // Rice 8 / 23 = 0.35 -> Critical. Egg 50 / 115 = 0.43 -> Critical. Salt: min_stock rule -> Low.
  assert.deepEqual(stockAlerts().map((n) => n.metadata.key).sort(), ['critical_1', 'critical_2', 'low_3']);
  assert.equal(summaries().length, 1);
  const md = summaries()[0].metadata;
  assert.equal(md.key, 'restock_summary:2026-10-17');
  assert.equal(md.for_date, '2026-10-17');
  assert.deepEqual(md.counts, { out: 0, critical: 2, low: 1, total: 3 });
  assert.equal(md.emailed, true);
  assert.deepEqual(md.urgent_ids, [1, 2]);
  const rice = md.items.find((i) => i.name === 'Rice');
  assert.equal(Number(rice.need.toFixed(6)), 23);
  assert.equal(Number(rice.toBuy.toFixed(6)), 15);
  assert.equal(Number(rice.estCost.toFixed(6)), 750);
  assert.deepEqual(rice.usedIn, ['Tapsilog']);
  assert.match(summaries()[0].title, /^Restock: 3 ingredients \(2 critical\)$/);

  assert.equal(brevoCalls.length, 1, 'one email, not one per ingredient');
  assert.equal(brevoCalls[0].body.subject, 'ChefDuo: 3 ingredients to restock (2 critical)');
  assert.match(brevoCalls[0].body.htmlContent, /Have 8 kg of 23 kg needed\. For Tapsilog/);
  assert.equal(out.email.sent, true);
});

test('refresh: same Manila day -> still one email, even after a restart (DB-based dedupe)', async () => {
  seedWorld();
  setEmail(true);
  await refresh(NOW);
  await refresh(LATER);
  _resetEmailState(); // a restart forgets everything in memory
  const third = await refresh(LATER);
  setEmail(false);
  assert.equal(brevoCalls.length, 1);
  assert.equal(third.email.decision, 'duplicate');
  assert.equal(summaries().filter((n) => !n.read).length, 1, 'exactly one fresh summary in the bell');
});

test('refresh: a NEW ingredient going Critical the same day -> a second email; next day -> a new one', async () => {
  seedWorld({ eggQty: 200 }); // Egg 200 / 115 -> Excess at first
  setEmail(true);
  await refresh(NOW);
  assert.equal(brevoCalls.length, 1);
  assert.deepEqual(summaries()[0].metadata.urgent_ids, [1]);

  fake.tables.ingredients.find((i) => i.id === 2).quantity = 10; // Egg now 10 / 115 -> Critical
  fake.tables.product_ingredients.find((r) => r.ingredients.id === 2).ingredients.quantity = 10;
  const second = await refresh(LATER);
  assert.equal(second.email.decision, 'new_urgent');
  assert.equal(brevoCalls.length, 2);

  await refresh(LATER);
  assert.equal(brevoCalls.length, 2, 'nothing new since -> no third email');

  const nextDay = await refresh(NEXT_DAY);
  setEmail(false);
  assert.equal(nextDay.email.decision, 'first_today');
  assert.equal(brevoCalls.length, 3);
});

test('refresh: a Low-only change does not send a second email the same day', async () => {
  seedWorld({ eggQty: 200 });
  setEmail(true);
  await refresh(NOW);
  fake.tables.ingredients.find((i) => i.id === 2).quantity = 100; // Egg 100 / 115 -> Low (not urgent)
  await refresh(LATER);
  setEmail(false);
  assert.equal(brevoCalls.length, 1);
});

test('refresh: emails off -> no email, row not marked emailed; turned on the same day -> sends then', async () => {
  seedWorld();
  setEmail(false);
  const off = await refresh(NOW);
  assert.equal(off.email.decision, 'disabled');
  assert.equal(brevoCalls.length, 0);
  assert.equal(summaries()[0].metadata.emailed, false);

  setEmail(true);
  const on = await refresh(LATER);
  setEmail(false);
  assert.equal(on.email.decision, 'first_today');
  assert.equal(brevoCalls.length, 1);
});

test('refresh: a failed send is not counted as sent; the next refresh tries again', async () => {
  seedWorld();
  setEmail(true);
  brevoOk = false;
  const first = await refresh(NOW);
  assert.equal(first.email.sent, false);
  assert.equal(summaries()[0].metadata.emailed, false, 'reset after the failure');
  brevoOk = true;
  const second = await refresh(LATER);
  setEmail(false);
  assert.equal(second.email.sent, true);
  assert.equal(brevoCalls.length, 2, 'one failed attempt, one success');
});

test('refresh: recovered ingredients lose their alert; a moved one gets the new group', async () => {
  seedWorld();
  await refresh(NOW);
  fake.tables.ingredients.find((i) => i.id === 1).quantity = 100; // Rice recovers (Excess)
  fake.tables.ingredients.find((i) => i.id === 2).quantity = 0; // Egg runs out
  await refresh(LATER);
  const unread = stockAlerts().filter((n) => !n.read).map((n) => n.metadata.key).sort();
  assert.deepEqual(unread, ['low_3', 'out_2']);
});

test('refresh: two users -> both get the bell rows, the business email gets ONE email', async () => {
  seedWorld({ users: [{ id: 7 }, { id: 8 }] });
  setEmail(true);
  await refresh(NOW);
  setEmail(false);
  assert.equal(summaries().length, 2);
  assert.equal(brevoCalls.length, 1);
});

test('refresh: the restock email is built from the saved notification (bell and email agree)', async () => {
  seedWorld();
  setEmail(true);
  await refresh(NOW);
  setEmail(false);
  const rebuilt = buildRestockEmail(restockListFromMetadata(summaries()[0].metadata), { baseUrl: 'https://chefduo.example.app' });
  assert.equal(brevoCalls[0].body.htmlContent, rebuilt.html);
  assert.equal(brevoCalls[0].body.textContent, rebuilt.text);
});

test('refreshLowStockNotifications: overlapping calls are merged (one extra run, not one per call)', async () => {
  seedWorld();
  let runs = 0;
  const loadList = async () => { runs += 1; await new Promise((r) => setTimeout(r, 10)); return { forDate: '2026-10-17', items: [], counts: { out: 0, critical: 0, low: 0, total: 0 }, totalEstCost: 0, unpricedCount: 0, safetyBufferPct: 15, stockAt: NOW.toISOString() }; };
  const restore = quiet();
  try {
    await Promise.all([1, 2, 3, 4, 5].map(() => notificationService.refreshLowStockNotifications({ now: NOW, loadList })));
    await notificationService._waitForStockRefresh();
  } finally {
    restore();
  }
  assert.equal(runs, 2, 'the first run + one merged re-run');
});

test('queueStockRefresh: does nothing where the timed jobs are off (local dev against the LIVE DB)', () => {
  assert.equal(notificationService.queueStockRefresh('upload', { env: { NODE_ENV: 'development' } }), null);
});
