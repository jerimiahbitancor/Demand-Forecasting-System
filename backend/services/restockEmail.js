// services/restockEmail.js
//
// The daily restock email (Oct 17 2026). Pure: builds { subject, preheader,
// html, text } from a restock list (services/stockAlertService.js
// loadRestockList, or the copy saved in the restock_summary notification).
//
// Design: the owner's target restock_email_sample.html (Oct 17 2026). Email
// rules: table layout, inline styles only, no web fonts, no images, max
// width 600px, every value through escapeHtml, numbers at most 2 decimals,
// a plain-text version with the same rows.

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { escapeHtml } = require('../utils/escapeHtml');

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TZ = 'Asia/Manila';
const MAX_ROWS = 15;
const LINK_PATH = '/ingredient-demand'; // Ingredient Demand page (Grocery List)
const FOOTER = 'You get this email because reminders are on. Change the email in Settings > Business Profile.';
// Until backend/utils/recipeUnits.js:275 (cross-family units passed
// through unconverted) is fixed, some needs are too big.
const UNITS_CAVEAT = 'Some amounts may be overstated while recipe units are being corrected.';

const C = {
  page: '#EEF0F2', card: '#FFFFFF', brand: '#8B1538', ink: '#1E2329', muted: '#5E6670',
  faint: '#8A929B', line: '#E3E6EA', box: '#F6F7F8', track: '#EEF0F2',
};
const GROUPS = {
  out: { label: 'Out of stock', head: '#7A1230', bar: null, summary: (n) => `${n} out of stock` },
  critical: { label: 'Critical', head: '#C62828', bar: '#C62828', summary: (n) => `${n} critical` },
  low: { label: 'Low', head: '#A86A12', bar: '#D9A441', summary: (n) => `${n} low` },
};
const GROUP_ORDER = ['out', 'critical', 'low'];
const FONT = 'font-family:Helvetica,Arial,sans-serif;';

// At most 2 decimals, no trailing zeros, thousands separators.
function fmtNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const withUnit = (value, unit) => (unit ? `${fmtNum(value)} ${unit}` : fmtNum(value));

// Estimates in whole pesos (an estimate, not a receipt).
function fmtPeso(value) {
  const n = Number(value) || 0;
  if (n > 0 && n < 0.5) return '<₱1';
  return `₱${Math.round(n).toLocaleString('en-US')}`;
}

const plural = (n, one, many) => (n === 1 ? one : many);

function weekdayOf(forDate) {
  return dayjs.tz(forDate, PH_TZ).format('dddd');
}

function stockTimeOf(stockAt) {
  return dayjs(stockAt).tz(PH_TZ).format('h:mm A, ddd D MMM YYYY');
}

// "1 out of stock, 3 critical" (zero parts left out), or '' when neither.
// Used in the subject and the bell title.
function urgentCountsText(counts = {}) {
  return [
    counts.out ? `${counts.out} out of stock` : null,
    counts.critical ? `${counts.critical} critical` : null,
  ].filter(Boolean).join(', ');
}

// 'Fri 16-10' — the night whose sales are not uploaded yet.
function shortDayOf(isoDate) {
  return dayjs.tz(isoDate, PH_TZ).format('ddd DD-MM');
}

function summaryParts(counts) {
  return GROUP_ORDER.filter((g) => counts[g] > 0).map((g) => ({ group: g, text: GROUPS[g].summary(counts[g]) }));
}

// "Buy 24.4 kg" for a forecast row; "Restock" when there is no forecast
// need to compute an amount from (min_stock rule).
function buyLabel(item) {
  return item.toBuy != null && item.toBuy > 0 ? `Buy ${withUnit(item.toBuy, item.unit)}` : 'Restock';
}

function costLabel(item) {
  if (item.estCost != null) return fmtPeso(item.estCost);
  if (item.price === null || item.price === undefined) return 'No price yet';
  return '—';
}

function detailLine(item) {
  if (item.rule === 'min_stock') {
    return `Have ${withUnit(item.stock, item.unit)}, ideal stock level ${withUnit(item.minStock, item.unit)}`;
  }
  const used = item.usedIn && item.usedIn.length ? `. For ${item.usedIn.join(', ')}` : '.';
  return `Have ${withUnit(item.stock, item.unit)} of ${withUnit(item.need, item.unit)} needed${used}`;
}

function barHtml(item) {
  if (item.rule === 'min_stock' || item.coveragePct == null) return '';
  const pct = Math.round(Math.max(0, Math.min(100, Number(item.coveragePct) || 0)));
  const color = GROUPS[item.group].bar;
  const inner = pct > 0 && color
    ? `<td width="${pct}%" style="height:6px;background:${color};border-radius:3px;font-size:0;line-height:0;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td>`
    : '<td width="0%" style="height:6px;font-size:0;line-height:0;">&nbsp;</td>';
  return `
      <tr><td colspan="2" style="padding:0 0 6px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.track};border-radius:3px;"><tr>
          ${inner}
        </tr></table>
      </td></tr>`;
}

function rowHtml(item, isLast) {
  const border = isLast ? '' : `border-bottom:1px solid ${C.line};`;
  return `
  <tr><td style="padding:0 24px;${FONT}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${border}">
      <tr>
        <td style="padding:12px 0 4px 0;font-size:15px;font-weight:700;color:${C.ink};">${escapeHtml(item.name)}</td>
        <td align="right" style="padding:12px 0 4px 0;font-size:15px;font-weight:700;color:${C.ink};white-space:nowrap;">${escapeHtml(buyLabel(item))}</td>
      </tr>${barHtml(item)}
      <tr>
        <td style="padding:0 0 12px 0;font-size:12.5px;line-height:1.4;color:${C.muted};">${escapeHtml(detailLine(item))}</td>
        <td align="right" style="padding:0 0 12px 0;font-size:12.5px;color:${C.muted};white-space:nowrap;">${escapeHtml(costLabel(item))}</td>
      </tr>
    </table>
  </td></tr>`;
}

function groupHeaderHtml(group, count, weekday, first) {
  const g = GROUPS[group];
  let note = '';
  if (group === 'critical') note = ` less than half of what ${weekday} needs`;
  if (group === 'low') note = ` enough for part of ${weekday}`;
  const noteHtml = note ? `<span style="font-weight:400;color:${C.muted};">${escapeHtml(note)}</span>` : '';
  return `
  <tr><td style="padding:${first ? 18 : 20}px 24px 2px 24px;${FONT}">
    <div style="font-size:14px;font-weight:700;color:${g.head};border-bottom:2px solid ${g.head};padding-bottom:6px;">${escapeHtml(`${g.label} (${count})`)}${noteHtml}</div>
  </td></tr>`;
}

/**
 * @param {object} list { forDate, safetyBufferPct, stockAt, items, counts, totalEstCost,
 *                        unpricedCount, salesPendingDate? }
 * @param {object} [opts] { baseUrl, unitsCaveat = true, maxRows = 15 }
 */
function buildRestockEmail(list, { baseUrl = '', unitsCaveat = true, maxRows = MAX_ROWS } = {}) {
  const items = list.items || [];
  const counts = list.counts || { out: 0, critical: 0, low: 0, total: items.length };
  const total = counts.total != null ? counts.total : items.length;
  const weekday = weekdayOf(list.forDate);
  const priced = items.some((i) => i.estCost != null);
  const unpriced = Number(list.unpricedCount) || 0;
  const url = `${String(baseUrl || '').replace(/\/+$/, '')}${LINK_PATH}`;

  const urgent = urgentCountsText(counts);
  const subject = `ChefDuo: ${total} ${plural(total, 'ingredient', 'ingredients')} to restock${urgent ? ` (${urgent})` : ''}`;
  const pendingLine = list.salesPendingDate
    ? `Stock does not yet include ${shortDayOf(list.salesPendingDate)} sales. Upload them to update this list.`
    : null;
  const heading = `${total} ${plural(total, 'ingredient', 'ingredients')} to restock for ${weekday}`;
  const subLine = `Based on ${weekday}'s forecast plus your ${fmtNum(list.safetyBufferPct)}% safety buffer. `
    + `Stock counted as of ${stockTimeOf(list.stockAt)}.`;
  const parts = summaryParts(counts);
  const summaryText = `${parts.map((p) => p.text).join(', ')}.`;
  const costText = priced ? fmtPeso(list.totalEstCost) : '—';
  const preheader = `${summaryText} ${priced ? `About ${fmtPeso(list.totalEstCost)} at current market prices.` : 'No market prices yet.'}`;
  const caveat = [
    unpriced > 0
      ? `Costs use the latest market prices; ${unpriced} ${plural(unpriced, 'item has', 'items have')} no price yet.`
      : 'Costs use the latest market prices.',
    unitsCaveat ? UNITS_CAVEAT : null,
  ].filter(Boolean).join(' ');

  const shown = items.slice(0, Math.max(0, maxRows));
  const hidden = items.length - shown.length;
  const moreText = hidden > 0 ? `…and ${hidden} more in the grocery list.` : null;

  // ---- HTML ----
  let rowsHtml = '';
  let firstGroup = true;
  for (const group of GROUP_ORDER) {
    const inGroup = shown.filter((i) => i.group === group);
    if (inGroup.length === 0) continue;
    rowsHtml += groupHeaderHtml(group, counts[group] || inGroup.length, weekday, firstGroup);
    firstGroup = false;
    inGroup.forEach((item) => {
      rowsHtml += rowHtml(item, item === shown[shown.length - 1]);
    });
  }

  const summarySpans = parts
    .map((p) => `<span style="color:${GROUPS[p.group].head};font-weight:700;">${escapeHtml(p.text)}</span>`)
    .join(',\n          ');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">
  ${escapeHtml(preheader)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${C.card};border-radius:10px;border-top:4px solid ${C.brand};">

  <tr><td style="padding:22px 24px 4px 24px;${FONT}">
    <div style="font-size:15px;font-weight:700;color:${C.brand};letter-spacing:0.2px;">ChefDuo</div>
  </td></tr>

  <tr><td style="padding:6px 24px 0 24px;${FONT}">
    <h1 style="margin:0;font-size:23px;line-height:1.3;font-weight:700;color:${C.ink};">${escapeHtml(heading)}</h1>
    <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;color:${C.muted};">
      ${escapeHtml(subLine)}
    </p>${pendingLine ? `
    <p style="margin:8px 0 0 0;font-size:14px;line-height:1.55;font-weight:700;color:${GROUPS.low.head};">
      ${escapeHtml(pendingLine)}
    </p>` : ''}
  </td></tr>

  <tr><td style="padding:18px 24px 6px 24px;${FONT}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.box};border-radius:8px;">
      <tr>
        <td style="padding:14px 16px;font-size:14px;line-height:1.5;color:${C.ink};">
          ${summarySpans}.
        </td>
        <td align="right" style="padding:14px 16px;font-size:14px;line-height:1.3;color:${C.muted};white-space:nowrap;">
          Est. cost<br><span style="font-size:20px;font-weight:700;color:${C.ink};">${escapeHtml(costText)}</span>
        </td>
      </tr>
    </table>
  </td></tr>
${rowsHtml}
${moreText ? `
  <tr><td style="padding:14px 24px 0 24px;${FONT}">
    <p style="margin:0;font-size:13px;line-height:1.5;color:${C.ink};">${escapeHtml(moreText)}</p>
  </td></tr>` : ''}
  <tr><td style="padding:18px 24px 0 24px;${FONT}">
    <p style="margin:0;font-size:12.5px;line-height:1.5;color:${C.muted};">
      ${escapeHtml(caveat)}
    </p>
  </td></tr>

  <tr><td style="padding:20px 24px 26px 24px;${FONT}">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:${C.brand};border-radius:8px;">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;">Open grocery list</a>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:16px 24px 20px 24px;border-top:1px solid ${C.line};${FONT}">
    <p style="margin:0;font-size:12px;line-height:1.5;color:${C.faint};">
      ${escapeHtml(FOOTER)}
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>
`;

  // ---- plain text: same rows, one per line ----
  const lines = [heading, subLine, ...(pendingLine ? [pendingLine] : []), '', `${summaryText} Est. cost ${costText}.`];
  for (const group of GROUP_ORDER) {
    const inGroup = shown.filter((i) => i.group === group);
    if (inGroup.length === 0) continue;
    lines.push('', `${GROUPS[group].label.toUpperCase()} (${counts[group] || inGroup.length})`);
    for (const item of inGroup) {
      lines.push(`- ${item.name}: ${buyLabel(item)}. ${detailLine(item).replace(/\.$/, '')}. ${costLabel(item)}`);
    }
  }
  if (moreText) lines.push('', moreText);
  lines.push('', caveat, '', `Open grocery list: ${url}`, '', FOOTER);
  const text = lines.join('\n');

  return { subject, preheader, html, text, url };
}

// The list saved in a restock_summary notification's metadata -> the shape
// buildRestockEmail() takes.
function restockListFromMetadata(md = {}) {
  return {
    forDate: md.for_date,
    safetyBufferPct: md.safety_buffer_pct,
    stockAt: md.stock_at,
    items: md.items || [],
    counts: md.counts || {},
    totalEstCost: md.total_est_cost,
    unpricedCount: md.unpriced_count,
    salesPendingDate: md.sales_pending_date || null,
  };
}

module.exports = {
  buildRestockEmail,
  restockListFromMetadata,
  fmtNum,
  fmtPeso,
  urgentCountsText,
  MAX_ROWS,
  LINK_PATH,
  UNITS_CAVEAT,
};
