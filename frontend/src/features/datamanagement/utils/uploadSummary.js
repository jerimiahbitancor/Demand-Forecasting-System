// utils/uploadSummary.js
//
// The upload summary after a sales upload (owner's v3 flowchart, page 2,
// "Output (upload summary)"). The backend returns one summary per file
// (summary.uploadSummary); a run can upload many files, so these helpers
// merge them into one report. Pure: no React, no network.

const KEYS = [
  'modifierProducts', 'sizeProducts', 'newProducts', 'unmatchedNames',
  'aliasMatches', 'possibleDuplicates', 'shortfalls',
  // Ingredients whose stock was NOT deducted, and why (stock edited after
  // the sale day, recipe unit could not be converted), plus errors in the
  // follow-up processing. Without these, a skipped deduction was silent.
  'stockNotDeducted', 'followUpErrors',
];

const lower = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

export function emptySummary() {
  return Object.fromEntries(KEYS.map((k) => [k, []]));
}

/**
 * Merges per-file summaries.
 *  - modifier plates are added up per product and keyword
 *  - lists are de-duplicated
 *  - shortfalls are grouped per ingredient: total shortfall and how many
 *    files ran short, keeping the latest message
 */
export function mergeUploadSummaries(summaries = []) {
  const modifiers = new Map();
  const sizes = new Map();
  const created = new Map();
  const unmatched = new Map();
  const aliases = new Map();
  const duplicates = new Map();
  const shortfalls = new Map();
  const notDeducted = new Map();
  const followUpErrors = new Set();

  for (const s of summaries) {
    if (!s) continue;
    for (const m of s.modifierProducts || []) {
      const entry = modifiers.get(m.productId) || { productId: m.productId, name: m.name, plates: {} };
      for (const [keyword, plates] of Object.entries(m.plates || {})) {
        entry.plates[keyword] = (entry.plates[keyword] || 0) + (Number(plates) || 0);
      }
      modifiers.set(m.productId, entry);
    }
    for (const p of s.sizeProducts || []) if (!sizes.has(p.productId)) sizes.set(p.productId, p);
    for (const p of s.newProducts || []) if (!created.has(lower(p.name))) created.set(lower(p.name), p);
    for (const name of s.unmatchedNames || []) if (!unmatched.has(lower(name))) unmatched.set(lower(name), name);
    for (const a of s.aliasMatches || []) if (!aliases.has(lower(a.alias))) aliases.set(lower(a.alias), a);
    for (const d of s.possibleDuplicates || []) {
      const key = `${d.newProduct?.id}-${d.looksLike?.id}`;
      if (!duplicates.has(key)) duplicates.set(key, d);
    }
    for (const sf of s.shortfalls || []) {
      const entry = shortfalls.get(sf.ingredientId) || { ingredientId: sf.ingredientId, ingredient: sf.ingredient, shortfall: 0, files: 0, message: '' };
      entry.shortfall += Number(sf.shortfall) || 0;
      entry.files += 1;
      entry.message = sf.message || entry.message;
      shortfalls.set(sf.ingredientId, entry);
    }
    for (const nd of s.stockNotDeducted || []) {
      const key = `${nd.ingredientId}|${nd.reason}`;
      const entry = notDeducted.get(key) || { ...nd, days: [] };
      entry.days = [...new Set([...entry.days, ...(nd.days || [])])].sort();
      entry.message = nd.message || entry.message;
      notDeducted.set(key, entry);
    }
    for (const message of s.followUpErrors || []) followUpErrors.add(message);
  }

  const byName = (a, b) => String(a.name || a.ingredient || a.alias || a).localeCompare(String(b.name || b.ingredient || b.alias || b));
  return {
    modifierProducts: [...modifiers.values()].sort(byName),
    sizeProducts: [...sizes.values()].sort(byName),
    newProducts: [...created.values()].sort(byName),
    unmatchedNames: [...unmatched.values()].sort(byName),
    aliasMatches: [...aliases.values()].sort(byName),
    possibleDuplicates: [...duplicates.values()],
    shortfalls: [...shortfalls.values()].sort(byName),
    stockNotDeducted: [...notDeducted.values()].sort(byName),
    followUpErrors: [...followUpErrors],
  };
}

// True when there is at least one thing to show.
export function hasSummaryContent(summary) {
  return Boolean(summary) && KEYS.some((k) => Array.isArray(summary[k]) && summary[k].length > 0);
}

/**
 * Per-cell errors from a 400 "Invalid sales file" response
 * ({ errors: [{ row, column, message }] }), tagged with the file name.
 * Anything else gives [].
 */
export function collectCellErrors(fileName, responseData) {
  const errors = responseData && Array.isArray(responseData.errors) ? responseData.errors : [];
  return errors
    .filter((e) => e && typeof e === 'object' && e.message)
    .map((e) => ({ file: fileName, row: e.row ?? null, column: e.column ?? null, message: String(e.message) }));
}

/**
 * The ingredients that blocked a file, from a 422 "Not enough stock"
 * response ({ insufficientStock: true, shortfalls: [...] }), tagged with the
 * file name. One row per ingredient. Anything else gives [].
 * (Nothing from such a file was saved: see migration 020.)
 */
export function collectStockRefusals(fileName, responseData) {
  if (!responseData || responseData.insufficientStock !== true) return [];
  const items = Array.isArray(responseData.shortfalls) ? responseData.shortfalls : [];
  return items
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      file: fileName,
      ingredientId: s.ingredientId ?? null,
      ingredient: String(s.name || 'Ingredient'),
      unit: s.unit || null,
      required: s.required ?? null,
      available: s.available ?? null,
      shortfall: s.shortfall ?? null,
    }));
}

// "NO EGG 3, NO RICE 2"
export function formatPlates(plates = {}) {
  return Object.entries(plates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([keyword, n]) => `${keyword} ${n}`)
    .join(', ');
}
