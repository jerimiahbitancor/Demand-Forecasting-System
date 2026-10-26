#!/usr/bin/env node
// scripts/forecast-report.js — FORECAST REPORT (Oct 26 2026). Local, read-only.
//
// The training report explains how the model was built. This one explains
// one forecast window: which run wrote it, what the model was given, what
// it predicted, and every business number built on it (whole items, revenue,
// COGS, demand level, ingredient need, stock status, To Buy, Est. Cost,
// weekly grocery), with the formulas and worked examples, and the accuracy
// against actual sales once those are uploaded.
//
// The business numbers come from the SAME functions the app's pages call
// (services/analyticsService.js), so they match the screens exactly.
// The model part (inputs + re-prediction) comes from
// ml-service/reports/forecast_inputs.py, which uses the ML service's own code.
//
// Reads only: no insert, update, delete, training or forecast.
//
//   cd backend
//   node scripts/forecast-report.js                         # the newest forecast run
//   node scripts/forecast-report.js --from 2026-09-29 --to 2026-10-04
//   node scripts/forecast-report.js --no-model              # skip the Python part
//
// Needs backend/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) and, for the
// model part, ml-service/.env plus Python with ml-service/requirements.txt.
// Output: ml-service/reports/output/forecast_report_<from>_to_<to>.html
// (next to the training report). Do not commit it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

// ---------------------------------------------------------------------
// Small pure helpers (exported for tests)
// ---------------------------------------------------------------------

// Display rule: drop only a trailing ".00" (9.00 -> 9, 9.50 stays 9.50).
function num(value, decimals = 2) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  const text = Number(value).toFixed(decimals);
  return text.endsWith(`.${'0'.repeat(decimals)}`) ? text.slice(0, -(decimals + 1)) : text;
}
// Money: ₱ + the same rule; a price under ₱1 keeps up to 4 decimals.
function peso(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const v = Number(value);
  if (Math.abs(v) > 0 && Math.abs(v) < 1) return `₱${String(Number(v.toFixed(4)))}`;
  const [whole, dec] = num(v, 2).split('.');
  return `₱${Number(whole).toLocaleString('en-US')}${dec ? `.${dec}` : ''}`;
}
// Stock and recipe amounts: up to 3 decimals, no trailing zeros (4.1 kg).
const qty = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : String(Number(Number(v).toFixed(3))));
const pct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${num(v, 2)}%`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same rounding as analyticsService.wholeItems: half up, never below 0.
const wholeOf = (v) => Math.max(0, Math.floor(Number(v) + 0.5));

const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const weekdayOf = (ymd) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const longDate = (ymd) => {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}, ${y}`;
};
// A timestamp (forecasts.created_at has no zone and is UTC) -> Manila text.
function manilaTime(ts) {
  if (!ts) return '—';
  const s = String(ts);
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return s;
  const m = new Date(t + PH_OFFSET_MS);
  const hh = m.getUTCHours();
  const h12 = hh % 12 || 12;
  return `${longDate(m.toISOString().slice(0, 10))}, ${h12}:${String(m.getUTCMinutes()).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}
const toMs = (ts) => {
  if (!ts) return NaN;
  const s = String(ts);
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
};

// How a forecast run was started, from what the app wrote around it.
function describeTrigger({ notifications = [], triggerLogs = [] }) {
  const titles = notifications.map((n) => `${n.title || ''} ${n.message || ''}`);
  if (triggerLogs.some((l) => /system:boot/.test(l.performed_by || ''))) return 'Automatic: backend woke up after 9:00 AM (boot catch-up)';
  if (triggerLogs.some((l) => /system:external/.test(l.performed_by || ''))) return 'Automatic: outside 9:00 AM call (cron-job.org)';
  if (titles.some((t) => /first forecast after training/i.test(t))) return 'Automatic: right after training (removed Oct 26, 2026)';
  if (titles.some((t) => /scheduled (daily|weekly) forecast run/i.test(t))) return 'Automatic: 9:00 AM schedule';
  if (titles.some((t) => /starting after your latest sales data/i.test(t))) return 'Manual: Generate Forecast, test start date';
  if (titles.some((t) => /Forecast report is ready|Forecast ready, with some products missing/i.test(t))) return 'Manual: Generate Forecast';
  return 'Unknown (no notification or trigger log found near this run)';
}

// Accuracy of whole-number forecasts vs actual sales, with the same
// definitions as forecast_accuracy_check.sql. rows: { a, f, fRaw, b7, bdow, date }.
function accuracyOf(rows) {
  if (!rows.length) return null;
  const sum = (fn) => rows.reduce((s, r) => s + fn(r), 0);
  const A = sum((r) => r.a);
  const F = sum((r) => r.f);
  const byDay = new Map();
  for (const r of rows) {
    const e = byDay.get(r.date) || { a: 0, f: 0 };
    e.a += r.a; e.f += r.f;
    byDay.set(r.date, e);
  }
  const w = (fn) => (A > 0 ? (100 * sum((r) => Math.abs(r.a - fn(r)))) / A : null);
  const wmape = w((r) => r.f);
  const avg7 = rows.every((r) => r.b7 !== null && r.b7 !== undefined) ? w((r) => r.b7) : null;
  return {
    productDays: rows.length,
    openDays: byDay.size,
    actual: A,
    forecast: F,
    wmape,
    accuracy: wmape === null ? null : 100 - wmape,
    wmapeDecimal: w((r) => r.fRaw),
    mae: sum((r) => Math.abs(r.a - r.f)) / rows.length,
    rmse: Math.sqrt(sum((r) => (r.a - r.f) ** 2) / rows.length),
    bias: A > 0 ? (100 * (F - A)) / A : null,
    storeWmape: A > 0 ? (100 * [...byDay.values()].reduce((s, e) => s + Math.abs(e.a - e.f), 0)) / A : null,
    avg7Wmape: avg7,
    sameWeekdayWmape: rows.every((r) => r.bdow !== null && r.bdow !== undefined) ? w((r) => r.bdow) : null,
    skillVsAvg7: wmape !== null && avg7 ? 100 * (1 - wmape / avg7) : null,
    byDay: [...byDay.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([date, e]) => ({ date, ...e })),
  };
}

// ---------------------------------------------------------------------
// Reading (all SELECTs)
// ---------------------------------------------------------------------

async function readAll(build) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await build().range(start, start + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const safe = async (fn, fallback) => {
  try { return await fn(); } catch (e) { return typeof fallback === 'function' ? fallback(e) : fallback; }
};

// The forecast dates written by the newest run (rows created within 15
// minutes before the newest created_at).
async function detectLatestWindow(client) {
  const { data, error } = await client.from('forecasts').select('created_at').order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  if (!data || !data.length) return null;
  const newest = toMs(data[0].created_at);
  const since = new Date(newest - 15 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', '');
  const rows = await readAll(() => client.from('forecasts').select('forecast_date, created_at').gte('created_at', since).order('forecast_date').order('id'));
  const dates = rows.map((r) => String(r.forecast_date).slice(0, 10)).sort();
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
}

async function collect({ client, analytics, from, to, ml = null }) {
  const window = datesBetween(from, to);
  const forecasts = await readAll(() => client.from('forecasts')
    .select('id, product_id, forecast_date, predicted_quantity, model_version, created_at')
    .gte('forecast_date', from).lte('forecast_date', to).order('forecast_date').order('product_id'));
  const products = await readAll(() => client.from('products').select('id, name, price, status').order('id'));
  const productById = new Map(products.map((p) => [p.id, p]));

  const createdTimes = forecasts.map((f) => toMs(f.created_at)).filter(Number.isFinite);
  const writtenFrom = createdTimes.length ? Math.min(...createdTimes) : null;
  const writtenTo = createdTimes.length ? Math.max(...createdTimes) : null;
  const versions = [...new Set(forecasts.map((f) => String(f.model_version || '').replace(/_closed$/, '')).filter(Boolean))].sort();
  const version = versions[versions.length - 1] || null;

  // Runs and how they were started (around the time the rows were written).
  const runs = await safe(() => readAll(() => client.from('forecast_runs')
    .select('id, run_at, run_type, model_version, last_confirmed_date, stale_days').order('run_at', { ascending: false })), []);
  const nearRows = (ts) => writtenFrom !== null && toMs(ts) >= writtenFrom - 10 * 60 * 1000 && toMs(ts) <= writtenTo + 10 * 60 * 1000;
  const notifications = await safe(() => readAll(() => client.from('notifications')
    .select('id, title, message, created_at, metadata').order('created_at', { ascending: false })), []);
  const triggerLogs = await safe(() => readAll(() => client.from('audit_logs')
    .select('id, action_type, details, performed_by, performed_at').eq('action_type', 'forecast_trigger_run').order('id', { ascending: false })), []);
  const runRows = runs.filter((r) => nearRows(r.run_at)).map((r) => {
    const t = toMs(r.run_at);
    const near = (ts) => Math.abs(toMs(ts) - t) <= 15 * 60 * 1000;
    return {
      ...r,
      trigger: describeTrigger({
        notifications: notifications.filter((n) => near(n.created_at) && /forecast/i.test(`${n.title}`)),
        triggerLogs: triggerLogs.filter((l) => near(l.performed_at)),
      }),
    };
  });
  const recentRuns = runs.slice(0, 10).map((r) => {
    const t = toMs(r.run_at);
    const near = (ts) => Math.abs(toMs(ts) - t) <= 15 * 60 * 1000;
    return { ...r, trigger: describeTrigger({ notifications: notifications.filter((n) => near(n.created_at) && /forecast/i.test(`${n.title}`)), triggerLogs: triggerLogs.filter((l) => near(l.performed_at)) }) };
  });

  const metrics = version
    ? await safe(async () => {
      const { data } = await client.from('model_metrics').select('*').eq('model_version', version).limit(1);
      return data && data[0] ? data[0] : null;
    }, null)
    : null;

  // Business calculations: the app's own functions.
  const [recipeMap, modifierShares, bufferPct] = await Promise.all([
    analytics.getRecipeMap(), analytics.loadModifierShares(), analytics.getSafetyBufferPercentage(),
  ]);
  const forecasting = await analytics.getForecastingAnalytics({ from, to });
  const performance = await analytics.getProductPerformanceAnalytics({ from, to, demandFrom: from, demandTo: to });

  const closedRow = (f) => /_closed$/.test(String(f.model_version || ''));
  const openDates = [...new Set(forecasts.filter((f) => !closedRow(f)).map((f) => String(f.forecast_date).slice(0, 10)))].sort();
  const daily = [];
  for (const date of openDates) {
    const res = await analytics.getIngredientDemandAnalytics({ date });
    const dayRows = forecasts.filter((f) => String(f.forecast_date).slice(0, 10) === date);
    const needs = analytics.sumIngredientNeeds(dayRows, recipeMap, 1 + Number(bufferPct) / 100, modifierShares);
    const breakdown = {};
    for (const entry of needs.values()) {
      breakdown[entry.ingredientId] = dayRows
        .filter((f) => (recipeMap.get(f.product_id) || []).some((i) => i.ingredientId === entry.ingredientId))
        .map((f) => {
          const item = recipeMap.get(f.product_id).find((i) => i.ingredientId === entry.ingredientId);
          const share = modifierShares && modifierShares.get ? Number(modifierShares.get(`${f.product_id}:${entry.ingredientId}`) || 0) : 0;
          const items = wholeOf(f.predicted_quantity);
          return { product: productById.get(f.product_id)?.name || `Product ${f.product_id}`, items, qty: Number(item.qtyPerServing), share, part: items * Number(item.qtyPerServing) * (1 - share) };
        })
        .filter((p) => p.items > 0)
        .sort((x, y) => y.part - x.part);
    }
    daily.push({ date, rows: res.daily.rows, breakdown, shiftReason: res.daily.shiftReason });
  }
  const weekStarts = [...new Set(openDates.map((d) => {
    const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
    return addDays(d, -dow);
  }))];
  const weekly = [];
  for (const weekStart of weekStarts) {
    const res = await analytics.getIngredientDemandAnalytics({ date: weekStart, weekStart });
    weekly.push({ weekStart, weekEnd: addDays(weekStart, 6), rows: res.weekly.rows, days: res.weekly.days, grocery: res.groceryListWeekly });
  }

  // Actual sales for the window + benchmarks fixed on the day before it.
  const confirmedOpen = await safe(() => readAll(() => client.from('business_days').select('business_date, status')
    .eq('status', 'confirmed_open').lte('business_date', to).order('business_date')), []);
  const openSet = new Set(confirmedOpen.map((r) => String(r.business_date).slice(0, 10)));
  const before = [...openSet].filter((d) => d < from).sort();
  const last7 = before.slice(-7);
  const salesFrom = before.length ? before[Math.max(0, before.length - 14)] : from;
  const sales = await readAll(() => client.from('daily_sales').select('product_id, sale_date, quantity_sold')
    .gte('sale_date', salesFrom).lte('sale_date', to).order('sale_date').order('product_id'));
  const soldOn = new Map(sales.map((s) => [`${s.product_id}:${String(s.sale_date).slice(0, 10)}`, Number(s.quantity_sold)]));
  const accRows = forecasts
    .filter((f) => !closedRow(f) && openSet.has(String(f.forecast_date).slice(0, 10)) && String(f.model_version).replace(/_closed$/, '') === version)
    .map((f) => {
      const date = String(f.forecast_date).slice(0, 10);
      const pid = f.product_id;
      const b7 = last7.length ? last7.reduce((s, d) => s + (soldOn.get(`${pid}:${d}`) || 0), 0) / last7.length : null;
      const sameDay = [...before].reverse().find((d) => weekdayOf(d) === weekdayOf(date));
      return {
        date, productId: pid, product: productById.get(pid)?.name || `Product ${pid}`,
        a: soldOn.get(`${pid}:${date}`) || 0, f: wholeOf(f.predicted_quantity), fRaw: Number(f.predicted_quantity),
        b7, bdow: sameDay ? (soldOn.get(`${pid}:${sameDay}`) || 0) : null,
      };
    });

  return {
    from, to, window, generatedAt: new Date().toISOString(), version, versions, metrics, ml,
    written: { from: writtenFrom, to: writtenTo, rows: forecasts.length },
    runRows, recentRuns, forecasts, productById, bufferPct, recipeMap,
    forecasting, performance, daily, weekly,
    accuracy: { rows: accRows, summary: accuracyOf(accRows), last7, openDaysWithActuals: [...new Set(accRows.map((r) => r.date))] },
  };
}

// ---------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------

function table(headers, rows, { numeric = [] } = {}) {
  const th = headers.map((h, i) => `<th${numeric.includes(i) ? ' class="n"' : ''}>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${numeric.includes(i) ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" class="empty">Nothing to show.</td></tr>`}</tbody></table></div>`;
}

function storeChart(byDay) {
  if (!byDay || byDay.length < 2) return '';
  const W = 640; const H = 220; const P = 40;
  const max = Math.max(1, ...byDay.flatMap((d) => [d.a, d.f]));
  const x = (i) => P + (i * (W - 2 * P)) / (byDay.length - 1);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  const line = (key) => byDay.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const labels = byDay.map((d, i) => `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">${esc(longDate(d.date).replace(/, \d{4}$/, ''))}</text>`).join('');
  return `<figure><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Actual and forecasted items sold per day, whole store">
${[0, 0.5, 1].map((t) => `<line x1="${P}" y1="${y(max * t)}" x2="${W - P}" y2="${y(max * t)}" class="axis"/><text x="${P - 6}" y="${y(max * t) + 4}" text-anchor="end">${Math.round(max * t)}</text>`).join('')}
<path d="${line('a')}" class="actual"/><path d="${line('f')}" class="forecast"/>
${byDay.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.a)}" r="3" class="actual-dot"/><circle cx="${x(i)}" cy="${y(d.f)}" r="3" class="forecast-dot"/>`).join('')}
${labels}</svg><figcaption><span class="key actual-key"></span> Actual items sold &nbsp; <span class="key forecast-key"></span> Predicted items sold (whole numbers)</figcaption></figure>`;
}

function render(data) {
  const { forecasts, productById, ml } = data;
  const closedRow = (f) => /_closed$/.test(String(f.model_version || ''));
  const s = [];
  const nav = [];
  const section = (id, title, body) => { nav.push(`<a href="#${id}">${esc(title)}</a>`); s.push(`<section id="${id}"><h2>${esc(title)}</h2>${body}</section>`); };

  // 1. Run
  const trainEnd = ml && ml.train_end_date;
  const leakOk = trainEnd ? data.from > trainEnd : null;
  section('run', '1. Which run wrote this forecast', `
<p>Window: <b>${longDate(data.from)} to ${longDate(data.to)}</b> (${data.window.length} days). ${data.written.rows} forecast rows, written between <b>${manilaTime(data.written.from && new Date(data.written.from).toISOString())}</b> and <b>${manilaTime(data.written.to && new Date(data.written.to).toISOString())}</b> (Manila).</p>
${table(['Run time (Manila)', 'Type', 'Model', 'Sales data up to', 'Days behind', 'How it was started'],
    data.runRows.map((r) => [esc(manilaTime(r.run_at)), esc(r.run_type), esc(r.model_version), r.last_confirmed_date ? esc(longDate(r.last_confirmed_date)) : '—', esc(r.stale_days ?? '—'), esc(r.trigger)]))}
<p class="note">"How it was started" is read from the notifications and trigger logs written within 15 minutes of the run. Later runs overwrite a date's forecast (one row per product and date), so the rows above are the last writers of this window.</p>
<details><summary>Last 10 forecast runs (any dates)</summary>${table(['Run time (Manila)', 'Type', 'Model', 'Sales data up to', 'How it was started'],
    data.recentRuns.map((r) => [esc(manilaTime(r.run_at)), esc(r.run_type), esc(r.model_version), r.last_confirmed_date ? esc(longDate(r.last_confirmed_date)) : '—', esc(r.trigger)]))}</details>`);

  // 2. Model
  const m = data.metrics || {};
  const tr = (ml && ml.training) || {};
  const period = (p) => (p && p.start ? `${longDate(p.start)} – ${longDate(p.end)}` : (Array.isArray(p) ? `${longDate(p[0])} – ${longDate(p[1])}` : (p ? esc(JSON.stringify(p)) : '—')));
  section('model', '2. The model used', `
${table(['Item', 'Value'], [
    ['Model version', esc(data.version || '—') + (data.versions.length > 1 ? ` <span class="warn">(window also holds ${esc(data.versions.join(', '))})</span>` : '')],
    ['Trained on (evaluation date)', m.evaluation_date ? esc(longDate(m.evaluation_date)) : '—'],
    ['Last day the model learned from', trainEnd ? esc(longDate(trainEnd)) : '— (model part not run)'],
    ['Fit / validation / test periods', `${period(tr.fit_period)} / ${period(tr.validation_period)} / ${period(tr.test_period)}`],
    ['Number of trees (early stopping)', esc(tr.n_estimators ?? '—')],
    ['Test WMAPE (accuracy)', m.wmape != null ? `${pct(m.wmape)} (accuracy ${pct(100 - m.wmape)})` : '—'],
    ['7-day average WMAPE, same test rows', pct(m.baseline_wmape)],
    ['Test MAE / RMSE (items)', `${num(m.mae)} / ${num(m.rmse)}`],
    ['Forecast window starts after the training data?', leakOk === null ? '—' : (leakOk ? '<b class="ok">Yes</b>: the model never saw these days' : '<b class="bad">No</b>: the model already learned some of these days; do not use them as an accuracy test')],
  ])}`);

  // 3. Inputs
  if (ml && Array.isArray(ml.rows)) {
    const open = ml.rows.filter((r) => !r.closed);
    const checked = open.filter((r) => r.match !== null);
    const matched = checked.filter((r) => r.match).length;
    const byDate = new Map();
    for (const r of open) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
    const featureCols = ['lag_1', 'same_dow_last_open', 'days_since_last_open', 'rolling_7', 'rolling_14', 'dow', 'is_weekend', 'is_payday', 'month', 'day'];
    const blocks = [...byDate.entries()].map(([date, rows]) => `<details${date === data.from ? ' open' : ''}><summary>${esc(weekdayOf(date))} ${esc(longDate(date))}${rows[0].uses_own_predictions ? ' — uses the model\'s own earlier predictions' : ' — real sales only'}</summary>
${table(['Product', ...featureCols, 'Stored forecast', 'Re-predicted', 'Same?'],
    rows.sort((a, b) => (b.stored || 0) - (a.stored || 0)).map((r) => [esc(productById.get(r.product_id)?.name || r.product_id),
      ...featureCols.map((k) => num(r.features[k])), num(r.stored), num(r.recomputed),
      r.match === null ? '—' : (r.match ? '<span class="ok">yes</span>' : '<span class="bad">NO</span>')]),
    { numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })}</details>`).join('');
    section('inputs', '3. What the model was given', `
<p>For every product and day, the 11 inputs (features) are rebuilt with the ML service's own code and the saved model is run again. ${ml.model_loaded ? `<b>${matched} of ${checked.length}</b> re-predictions equal the stored forecast (within ±${num(ml.match_tolerance)} item).` : 'The model was not loaded, so only the inputs are shown.'}</p>
<ul><li>Day 1 uses only real sales before ${esc(longDate(data.from))}. Days 2 and later use the model's own predictions for the earlier days, because those days had not happened yet (recursive forecasting).</li>
<li>lag_1 = items sold on the previous open day; same_dow_last_open = items sold on the same weekday the last time the store was open; rolling_7 / rolling_14 = average items sold over the previous 7 / 14 open days; dow 0 = Monday.</li>
<li>Product id is also an input (it tells the model which product the row is about).</li></ul>
${(ml.notes || []).map((n) => `<p class="warn">${esc(n)}</p>`).join('')}${blocks}`);
  } else {
    section('inputs', '3. What the model was given', `<p class="warn">The model part was not run${ml && ml.error ? `: ${esc(ml.error)}` : ' (--no-model)'}. Run without --no-model, with ml-service/.env and Python available.</p>`);
  }

  // 4. Predicted items sold
  const openF = forecasts.filter((f) => !closedRow(f));
  const tableRows = (data.forecasting.prediction && data.forecasting.prediction.rows) || [];
  const rowKey = new Map(tableRows.map((r) => [`${r.productId}:${r.date}`, r]));
  const actualKey = new Map(data.accuracy.rows.map((r) => [`${r.productId}:${r.date}`, r.a]));
  const sample = [...openF].sort((a, b) => b.predicted_quantity - a.predicted_quantity)[0];
  const sampleRow = sample && rowKey.get(`${sample.product_id}:${String(sample.forecast_date).slice(0, 10)}`);
  section('items', '4. Predicted items sold, revenue and cost', `
<p>Predicted items sold = the model's forecast rounded half up to a whole number. Every later number uses this whole number. Forecast revenue = predicted items sold × selling price. Est. total cost = predicted items sold × COGS per item, where COGS = Σ recipe amount × ingredient unit cost (the same COGS Product Management shows).</p>
${sample ? `<p class="example">Example: ${esc(productById.get(sample.product_id)?.name)} on ${esc(longDate(sample.forecast_date))}: forecast ${num(sample.predicted_quantity)} → <b>${wholeOf(sample.predicted_quantity)}</b> items${sampleRow && sampleRow.price != null ? `; revenue ${wholeOf(sample.predicted_quantity)} × ${peso(sampleRow.price)} = <b>${peso(sampleRow.forecastRevenue)}</b>` : ''}${sampleRow && sampleRow.cogsPerUnit != null ? `; est. cost ${wholeOf(sample.predicted_quantity)} × ${peso(sampleRow.cogsPerUnit)} = <b>${peso(sampleRow.estCost)}</b>` : ''}.</p>` : ''}
${data.window.map((date) => {
    const rows = openF.filter((f) => String(f.forecast_date).slice(0, 10) === date).sort((a, b) => b.predicted_quantity - a.predicted_quantity);
    if (!rows.length) return `<h3>${esc(weekdayOf(date))} ${esc(longDate(date))}</h3><p class="note">Closed day or no forecast: 0 items.</p>`;
    const total = rows.reduce((t, f) => t + wholeOf(f.predicted_quantity), 0);
    return `<details${date === data.from ? ' open' : ''}><summary>${esc(weekdayOf(date))} ${esc(longDate(date))} — ${total} predicted items, ${rows.length} products</summary>
${table(['Product', 'Model forecast', 'Predicted items sold', 'Actual items sold', 'Price', 'Forecast revenue', 'COGS / item', 'Est. total cost', 'Recipe?'],
      rows.map((f) => {
        const r = rowKey.get(`${f.product_id}:${date}`);
        return [esc(productById.get(f.product_id)?.name || f.product_id), num(f.predicted_quantity), `<b>${wholeOf(f.predicted_quantity)}</b>`,
          actualKey.has(`${f.product_id}:${date}`) ? num(actualKey.get(`${f.product_id}:${date}`)) : '—', r ? peso(r.price) : '—', r ? peso(r.forecastRevenue) : '—',
          r ? peso(r.cogsPerUnit) : '—', r ? peso(r.estCost) : '—', r ? 'yes' : 'no (not on Sales and Demand)'];
      }), { numeric: [1, 2, 3, 4, 5, 6, 7] })}</details>`;
  }).join('')}
<p class="note">Products without a recipe are forecast but are not listed on the Sales and Demand table and have no cost or ingredient need.</p>`);

  // 5. Demand level
  const demandRows = (data.performance.demandClassification || []);
  const thr = (ml && ml.thresholds) || {};
  const levels = ['High Demand', 'Medium Demand', 'Low Demand', 'Not enough data'];
  const exD = demandRows[0];
  section('demand', '5. Demand level (P40 / P80)', `
<p>Each product's predicted items sold is compared with that product's own past daily sales: <b>High</b> above its 80th percentile (P80), <b>Medium</b> from P40 to P80, <b>Low</b> below P40. P40 = the value 40% of its past days were at or below.</p>
${exD ? `<p class="example">Example: ${esc(exD.product)} on ${esc(longDate(exD.date))}: ${exD.forecastQty} items; ${esc(exD.demandBasis || '')} → <b>${esc(exD.demandLevel)}</b>.</p>` : ''}
${table(['Date', ...levels.map((l) => l.replace(' Demand', ''))], [...new Set(demandRows.map((r) => r.date))].sort().map((date) => [esc(longDate(date)),
    ...levels.map((l) => String(demandRows.filter((r) => r.date === date && r.demandLevel === l).length))]), { numeric: [1, 2, 3, 4] })}
${[...new Set(demandRows.map((r) => r.date))].sort().map((date) => `<details><summary>${esc(longDate(date))}: every product</summary>
${table(['Product', 'Predicted items sold', 'P40', 'P80', 'Level', 'App basis', 'Bottleneck ingredient (status)'],
    demandRows.filter((r) => r.date === date).map((r) => {
      const t = thr[String(r.productId)];
      return [esc(r.product), String(r.forecastQty), t ? num(t.p40) : '—', t ? num(t.p80) : '—', esc(r.demandLevel), esc(r.demandBasis || ''), `${esc(r.bottleneckIngredient || '—')} (${esc(r.bottleneckStatus || '—')})`];
    }), { numeric: [1, 2, 3] })}</details>`).join('')}
<p class="note">P40 and P80 columns: recomputed from sales before ${esc(longDate(data.from))}. "App basis" is what the app stored at the forecast run.</p>`);

  // 6. Ingredient demand
  const buffer = Number(data.bufferPct);
  const firstDay = data.daily[0];
  const exI = firstDay && firstDay.rows[0];
  const exParts = exI && firstDay.breakdown[exI.ingredientId];
  section('ingredients', '6. Ingredient demand, stock status and what to buy', `
<p>Raw = Σ predicted items sold × recipe amount per item × (1 − modifier share). Safety buffer = Raw × ${num(buffer)}%. Forecasted need = Raw + buffer (each rounded to 2 decimals; pieces round up). Predicted Stock Level Status = stock ÷ forecasted need × 100: Critical Shortage below 50%, Insufficient Supply below 100%, Sufficient Supply up to 200%, Above Forecast Limit above 200%. To Buy = forecasted need − stock (only when short). Est. cost = To Buy × unit cost.</p>
<p class="warn">Stock, recipes, unit costs and the safety buffer are the values in the system <b>now</b> (when this report ran), exactly like the app's pages. For a past test week, On Stock is today's stock, not the stock on that day.</p>
${exI && exParts ? `<p class="example">Example: ${esc(exI.name)} on ${esc(longDate(firstDay.date))}: Raw = ${exParts.map((p) => `${p.items} × ${qty(p.qty)}${p.share ? ` × (1 − ${qty(p.share)})` : ''}`).join(' + ')} = <b>${num(exI.rawForecastedNeed)} ${esc(exI.unit)}</b>; buffer ${num(exI.safetyBuffer)}; need <b>${num(exI.forecastedNeed)}</b>; stock ${qty(exI.onStock)} → ${esc(exI.predictedStatus || exI.status)}${exI.toBuy ? `; To Buy ${num(exI.toBuy)} × ${peso(exI.marketPrice)} = <b>${peso(exI.estCost)}</b>` : ''}.</p>` : ''}
${data.daily.map((day) => {
    const cost = day.rows.reduce((t, r) => t + (Number(r.estCost) || 0), 0);
    return `<details${day === firstDay ? ' open' : ''}><summary>${esc(weekdayOf(day.date))} ${esc(longDate(day.date))} — ${day.rows.length} ingredients, est. cost to buy ${peso(cost)}</summary>
${table(['Ingredient', 'Unit', 'Raw', 'Buffer', 'Forecasted need', 'On stock (now)', 'Predicted status', 'To buy', 'Unit cost', 'Est. cost', 'How Raw adds up'],
      day.rows.map((r) => [esc(r.name), esc(r.unit), num(r.rawForecastedNeed), num(r.safetyBuffer), `<b>${num(r.forecastedNeed)}</b>`, qty(r.onStock),
        esc(r.predictedStatus || r.status), r.toBuy != null ? num(r.toBuy) : '—', peso(r.marketPrice), peso(r.estCost),
        `<span class="small">${(day.breakdown[r.ingredientId] || []).map((p) => `${esc(p.product)} ${p.items}×${qty(p.qty)}${p.share ? `×(1−${qty(p.share)})` : ''}`).join(' + ') || '—'}</span>`]),
      { numeric: [2, 3, 4, 5, 7, 8, 9] })}</details>`;
  }).join('')}`);

  // 7. Weekly
  section('weekly', '7. Weekly ingredient demand and grocery list', data.weekly.map((w) => `<h3>Week of ${esc(longDate(w.weekStart))} – ${esc(longDate(w.weekEnd))}</h3>
<p>Heatmap values = Raw per day (no buffer). Weekly need = the sum of the 7 daily forecasted needs (buffer included).</p>
${table(['Ingredient', 'Unit', ...w.days.map((d) => `${weekdayOf(d)} ${d.slice(5)}`), 'Week total (raw)'],
    (w.rows || []).map((r) => [esc(r.ingredient || r.name), esc(r.unit), ...(r.values || r.days || []).map((v) => num(v)), num(r.total ?? (r.values || []).reduce((a, b) => a + Number(b || 0), 0))]),
    { numeric: [2, 3, 4, 5, 6, 7, 8, 9] })}
${table(['Ingredient', 'Weekly need', 'On stock (now)', 'Status', 'To buy', 'Est. cost'],
    ((w.grocery && w.grocery.all) || []).map((g) => [esc(g.name), num(g.forecastedNeed), qty(g.onStock ?? g.currentStock), esc(g.predictedStatus || g.status || ''), num(g.toBuy), peso(g.estCost)]),
    { numeric: [1, 2, 4, 5] })}`).join('') || '<p>No open forecast days.</p>');

  // 8. Accuracy
  const a = data.accuracy.summary;
  section('accuracy', '8. Forecast vs actual sales', a ? `
<p>Compared on ${a.openDays} open day(s) with uploaded sales (${a.productDays} product-days). Predicted items sold are whole numbers; the benchmarks are fixed on the day before the window starts (7-day average over ${data.accuracy.last7.length} open days; same weekday, last open day).</p>
${table(['Measure', 'Value', 'Meaning'], [
    ['Actual items sold', num(a.actual), 'Σ A'],
    ['Predicted items sold', num(a.forecast), 'Σ F'],
    ['WMAPE', `<b>${pct(a.wmape)}</b>`, 'Σ|A − F| ÷ ΣA × 100: share of items the forecast missed'],
    ['Accuracy', `<b>${pct(a.accuracy)}</b>`, '100 − WMAPE'],
    ['WMAPE with decimal forecasts', pct(a.wmapeDecimal), 'Same, before rounding (comparable to the training test)'],
    ['MAE', `${num(a.mae)} items`, 'Average miss per product per day'],
    ['RMSE', `${num(a.rmse)} items`, 'Like MAE, big misses count more'],
    ['Bias', pct(a.bias), '(ΣF − ΣA) ÷ ΣA × 100; positive = forecast too high'],
    ['Store-level WMAPE', pct(a.storeWmape), 'Error on the whole store\'s daily total'],
    ['7-day average WMAPE', pct(a.avg7Wmape), 'Benchmark an owner can compute by hand'],
    ['Same weekday WMAPE', pct(a.sameWeekdayWmape), 'Benchmark: last time open on that weekday'],
    ['Skill vs 7-day average', pct(a.skillVsAvg7), '(1 − model ÷ benchmark) × 100; above 0 = the model is better'],
  ])}
${storeChart(a.byDay)}
${table(['Day', 'Actual', 'Predicted', 'Difference'], a.byDay.map((d) => [esc(`${weekdayOf(d.date)} ${longDate(d.date)}`), num(d.a), num(d.f), num(d.f - d.a)]), { numeric: [1, 2, 3] })}
<details><summary>Per product (whole window)</summary>${table(['Product', 'Actual', 'Predicted', 'Missed items', 'WMAPE'],
    Object.values(data.accuracy.rows.reduce((m2, r) => { const e = m2[r.product] || (m2[r.product] = { product: r.product, a: 0, f: 0, miss: 0 }); e.a += r.a; e.f += r.f; e.miss += Math.abs(r.a - r.f); return m2; }, {}))
      .sort((x, y) => y.a - x.a).map((e) => [esc(e.product), num(e.a), num(e.f), num(e.miss), e.a > 0 ? pct((100 * e.miss) / e.a) : '—']), { numeric: [1, 2, 3, 4] })}</details>
<p class="note">The training test (section 2) scored the model one day ahead with real sales every day. Here the model forecasts up to a week ahead using its own earlier predictions, so higher errors are expected.</p>`
    : `<p>No actual sales are uploaded yet for the open days of this window. Upload them (and mark closed days), then run this report again.</p>`);

  // 9. Performance ratio
  const pr = data.performance.performanceRatio || {};
  section('ratio', '9. Performance ratio (actual sales in the window)', `
<p>Ratio = (product's items sold ÷ open days) ÷ store average items sold per open day over all active products. ${pr.ratioShift ? `<span class="warn">The window had no sales, so the app used ${esc(longDate(pr.range.from))} – ${esc(longDate(pr.range.to))} instead.</span>` : ''} Open days: ${esc(pr.openDays ?? '—')}; store average: ${num(pr.storeAverageDaily)} items per open day; active products: ${esc(pr.activeProductCount ?? '—')}.</p>
${table(['Product', 'Items sold', 'Open days', 'Avg / day', 'Ratio', 'Action signal'],
    (pr.rows || []).map((r) => [esc(r.product), num(r.quantitySold), esc(r.openDays), num(r.avgDaily), r.performanceRatio == null ? '—' : num(r.performanceRatio), esc(r.actionSignal)]),
    { numeric: [1, 2, 3, 4] })}`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forecast Report ${esc(data.from)} to ${esc(data.to)}</title><style>
:root{--ink:#1f2328;--muted:#5d6670;--line:#d9dee3;--bg:#fff;--soft:#f5f7f9;--accent:#7a0101;--ok:#17703a;--bad:#b42318;--warn:#8a5a00}
@media (prefers-color-scheme: dark){:root{--ink:#e6e9ec;--muted:#a3acb6;--line:#38404a;--bg:#15191d;--soft:#1d2329;--accent:#ff8a80;--ok:#5fd28c;--bad:#ff8b80;--warn:#f0c062}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 Arial,Helvetica,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{display:grid;grid-template-columns:230px 1fr;max-width:1400px;margin:0 auto}
nav{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;padding:24px 16px;border-right:1px solid var(--line)}
nav a{display:block;color:var(--ink);text-decoration:none;padding:4px 0;font-size:14px}nav a:hover{color:var(--accent)}
main{padding:24px 32px;min-width:0}h1{margin:0 0 4px;font-size:24px}h2{margin:36px 0 8px;font-size:19px;border-bottom:2px solid var(--accent);padding-bottom:4px}h3{font-size:16px;margin:20px 0 6px}
.sub{color:var(--muted);margin:0 0 16px}.tw{overflow-x:auto;margin:8px 0 12px}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{background:var(--soft);position:sticky;top:0}.n{text-align:right;font-variant-numeric:tabular-nums}
td.empty{color:var(--muted);text-align:center}details{margin:6px 0;border:1px solid var(--line);border-radius:6px;padding:6px 10px}summary{cursor:pointer;font-weight:600}
.note{color:var(--muted);font-size:13px}.warn{color:var(--warn)}.ok{color:var(--ok)}.bad{color:var(--bad)}.small{font-size:12px;color:var(--muted)}
.example{background:var(--soft);border-left:3px solid var(--accent);padding:8px 12px}
svg{width:100%;max-width:720px;height:auto}svg text{font-size:11px;fill:var(--muted)}.axis{stroke:var(--line)}path.actual{fill:none;stroke:var(--ink);stroke-width:2}path.forecast{fill:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:5 4}
.actual-dot{fill:var(--ink)}.forecast-dot{fill:var(--accent)}figcaption{font-size:13px;color:var(--muted)}.key{display:inline-block;width:18px;height:3px;vertical-align:middle}.actual-key{background:var(--ink)}.forecast-key{background:var(--accent)}
@media (max-width:800px){.wrap{display:block}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:12px 16px}main{padding:16px}}
@media print{nav{display:none}.wrap{display:block}details{border:0}details>summary{list-style:none}}
</style></head><body><div class="wrap"><nav><b>Forecast Report</b>${nav.join('')}</nav><main>
<h1>Forecast Report: ${esc(longDate(data.from))} to ${esc(longDate(data.to))}</h1>
<p class="sub">Generated ${esc(manilaTime(data.generatedAt))} (Manila) · read-only · business numbers from the app's own calculations · model ${esc(data.version || '—')}</p>
${s.join('\n')}
</main></div></body></html>`;
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { model: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-model') args.model = false;
    else if (a === '--python') args.python = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  for (const k of ['from', 'to']) if (args[k] && !YMD.test(args[k])) throw new Error(`--${k} must be YYYY-MM-DD`);
  if ((args.from && !args.to) || (!args.from && args.to)) throw new Error('Give both --from and --to, or neither.');
  if (args.from && args.to < args.from) throw new Error('--to is before --from');
  return args;
}

function runModelPart({ from, to, python }) {
  const mlDir = path.join(__dirname, '..', '..', 'ml-service');
  const out = path.join(os.tmpdir(), `dfs-forecast-inputs-${process.pid}.json`);
  const py = python || (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(py, [path.join('reports', 'forecast_inputs.py'), '--from', from, '--to', to, '--json', out], { cwd: mlDir, encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(out)) {
    const tail = `${r.stderr || ''}${r.error ? r.error.message : ''}`.trim().split('\n').slice(-3).join(' ');
    return { error: tail || `exit ${r.status}` };
  }
  try { return JSON.parse(fs.readFileSync(out, 'utf8')); } finally { fs.rmSync(out, { force: true }); }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('node scripts/forecast-report.js [--from YYYY-MM-DD --to YYYY-MM-DD] [--no-model] [--out file.html] [--python python3]');
    return 0;
  }
  // Quiet the config's connection banners; keep errors.
  const log = console.log;
  console.log = () => {};
  const { supabaseAdmin } = require('../config/supabase');
  const analytics = require('../services/analyticsService');
  console.log = log;
  if (!supabaseAdmin) throw new Error('backend/.env needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

  let { from, to } = args;
  if (!from) {
    const w = await detectLatestWindow(supabaseAdmin);
    if (!w) throw new Error('No forecasts in the database yet.');
    ({ from, to } = w);
    console.log(`Newest forecast run covers ${from} to ${to}.`);
  }
  let ml = null;
  if (args.model) {
    console.log('Rebuilding the model inputs (ml-service/reports/forecast_inputs.py)…');
    ml = runModelPart({ from, to, python: args.python });
    if (ml.error) console.warn(`Model part skipped: ${ml.error}`);
  }
  console.log('Reading forecasts and running the business calculations…');
  const data = await collect({ client: supabaseAdmin, analytics, from, to, ml });
  const out = args.out || path.join(__dirname, '..', '..', 'ml-service', 'reports', 'output', `forecast_report_${from}_to_${to}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, render(data), 'utf8');
  const acc = data.accuracy.summary;
  console.log(`Wrote ${out}`);
  console.log(acc ? `Accuracy on ${acc.openDays} day(s) with actual sales: WMAPE ${num(acc.wmape)}% (accuracy ${num(acc.accuracy)}%), 7-day average ${num(acc.avg7Wmape)}%.` : 'No actual sales uploaded for this window yet.');
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`forecast-report: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { num, peso, wholeOf, datesBetween, describeTrigger, accuracyOf, detectLatestWindow, collect, render, parseArgs, manilaTime };
