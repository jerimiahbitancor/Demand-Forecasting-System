// backend/services/daPriceImportService.js
//
// Daily automated import of the DA "Daily Price Index" (Bantay Presyo) sheets
// published on https://www.da.gov.ph/price-monitoring/ into the market_price
// table, under the built-in `da_reference` source.
//
// Each day the job (jobs/dailyPriceImportJob.js):
//   1. reads the price-monitoring page HTML and finds the newest
//      "Daily Price Index" PDF link (filenames are
//      "Daily-Price-Index-{Month}-{Day}-{YYYY}.pdf", with "Revised-" and
//      "-1" variants WordPress adds);
//   2. downloads the PDF and extracts its text layer with pdf.js;
//   3. parses the commodity table with utils/dailyPriceIndex.js;
//   4. matches every pricing commodity against the CURRENT (non-archived)
//      ingredient list by word containment (singularized, so "Carrot" meets
//      "Carrots") plus a fuzzy-confidence bar (see findConfidentIngredient),
//      skipping everything not confident enough to write without a human;
//   5. writes ONE row per ingredient for that sheet date — the mean of that
//      day's confident commodity matches — so a second run lands on a
//      different date and the price-trend chart sees a comparable point per
//      day (the exact same DA variants reappear daily, so the mean is stable
//      run to run);
//
// This is the ONLY place in the backend that makes an outbound HTTP call for
// prices, and it is deliberate: the DA publishes these sheets for the public
// (Bantay Presyo is a transparency service) and the job runs once per the
// daily schedule — not a crawl. Every price a human types in the UI still
// goes through the manual-only controller unchanged. Disable entirely with
// DA_PRICE_IMPORT_ENABLED=false.
'use strict';

const { supabaseAdmin } = require('../config/supabase');
const { isDailyPriceIndex, parseDailyPriceIndex } = require('../utils/dailyPriceIndex');
const { extractPdfText } = require('../utils/pdfText');
const { createIngredientFuse, matchConfidence } = require('../utils/ingredientMatch');

const SOURCE_KEY = 'da_reference';

const DEFAULT_MONITORING_URL = 'https://www.da.gov.ph/price-monitoring/';

// One page, ~a day, and the request must fail loudly instead of hanging.
const FETCH_TIMEOUT_MS = 60 * 1000;

// The review screen cannot auto-save a match below 0.6 without a human; the
// scheduled importer has no human, so it simply skips those rows. Same bar,
// same rationale. The importer ALSO applies a word-containment guard (see
// findConfidentIngredient below) that fuzzy matching alone cannot provide:
// plain Fuse would happily auto-save "Chicken Feet, Local" onto an ingredient
// called "Chicken Egg" (both share "Chicken") and miss "Basmati Rice" for an
// ingredient called "Rice" entirely.
const AUTOSAVE_CONFIDENCE = 0.6;

// Ingredient list source bounds. The inventory never approaches this today;
// the cap is a sanity guard in case a deployment imports a full product db.
const MAX_INGREDIENTS = 5000;

// A DA commodity above this price is a parse artifact, not a market price.
const MAX_PRICE = 100000;

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PH_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Manila (UTC+8, no DST)

// ---- pure helpers (exported for tests) --------------------------------------

// "Daily-Price-Index-October-8-2026.pdf" / "Revised-Daily-Price-Index-April-16-2026.pdf"
// / "September-18-2026-DPI-AFC.pdf" all carry their date as
// {Month}-{Day}-{Year}. Returns "YYYY-MM-DD" or null.
const parseSheetDateFromFilename = (filename) => {
  const name = String(filename || '').split('/').pop().replace(/\.pdf$/i, '');
  const match = name.match(/([A-Za-z]{3,9})[-_ ](\d{1,2})[-_ ](\d{4})/);
  if (!match) return null;
  const month = MONTHS[String(match[1]).toLowerCase()];
  if (!month) return null;
  const day = String(Number(match[2])).padStart(2, '0');
  return `${match[3]}-${month}-${day}`;
};

// Some sheets only print the date as text ("Released: October 8, 2026" in the
// PDF body); fallback probe for when the filename carries no date.
const MONTH_FULL_RE =
  /([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s+(\d{4})/;

const parseSheetDateFromText = (text) => {
  const match = String(text || '').match(MONTH_FULL_RE);
  if (!match) return null;
  const month = MONTHS[String(match[1]).toLowerCase()];
  if (!month) return null;
  const day = String(Number(match[2])).padStart(2, '0');
  return `${match[3]}-${month}-${day}`;
};

// Pull every "Daily Price Index"-looking PDF link out of the monitoring page
// HTML: the canonical "Daily-Price-Index-*" names, the "Revised-*" corrections,
// and the "*-DPI-AFC" naming one office used. Returns
// [{ url, name, date: "YYYY-MM-DD" }] with date null when unparsable.
const extractPriceIndexCandidates = (html) => {
  const hrefRe = /href=["']([^"']+\.pdf)["']/gi;
  const candidates = [];
  let hrefMatch;
  while ((hrefMatch = hrefRe.exec(String(html || '')))) {
    let url = hrefMatch[1];
    if (url.startsWith('//')) url = `https:${url}`;
    if (url.startsWith('/')) url = `https://www.da.gov.ph${url}`;
    if (!/^https?:\/\//i.test(url)) continue;
    const name = url.split('/').pop().replace(/\.pdf$/i, '');
    if (!/price-?index|(?:^|-)dpi/i.test(name)) continue;
    if (parseSheetDateFromFilename(name) === null) continue;
    candidates.push({ url, name, date: parseSheetDateFromFilename(name) });
  }
  return candidates;
};

// Same sheet can appear twice (revised correction, "-1" WordPress copy).
// Within one date prefer the revised correction, then the canonical name,
// then anything else. Across dates, newest wins. Returns the best link or null.
const selectLatestPriceIndexLink = (candidates, { now = new Date() } = {}) => {
  if (!Array.isArray(candidates) || !candidates.length) return null;

  const maxFuture = new Date(now.getTime() + 5 * DAY_MS);
  const parse = (date) => new Date(`${date}T00:00:00`);

  const rank = (name) => {
    if (/^revised[-_ ]/i.test(name)) return 0;
    if (/^daily[-_ ]price[-_ ]index/i.test(name)) return 1;
    return 2;
  };

  const valid = candidates
    .filter((c) => {
      const d = parse(c.date);
      return !Number.isNaN(d.getTime()) && d <= maxFuture;
    })
    .sort((a, b) => {
      const dateDiff = parse(b.date).getTime() - parse(a.date).getTime();
      return dateDiff || rank(a.name) - rank(b.name);
    });

  return valid[0] || null;
};

// ---- network ---------------------------------------------------------------

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms} ms`)), ms)
    ),
  ]);

const USER_AGENT = 'Sales-Forecasting-System/1.0 (https://github.com/; daily DA price index importer)';

async function fetchHtml(url) {
  const res = await withTimeout(
    fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*' } }),
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`DA price-monitoring page returned HTTP ${res.status}`);
  return res.text();
}

async function downloadPdf(url) {
  const res = await withTimeout(
    fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,*/*' } }),
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`DA PDF download returned HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  // Refuse non-PDF bodies (HTML error pages, redirect traps) by magic bytes.
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error('Downloaded file is not a PDF (missing %PDF header)');
  }
  return Buffer.from(bytes);
}

// The fallback path constructs the canonical URL for a PH date and probes it.
async function urlExists(url) {
  try {
    const head = await withTimeout(
      fetch(url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT } }),
      FETCH_TIMEOUT_MS
    );
    if (head.ok) return true;
  } catch {
    // HEAD unsupported (405 etc.) — fall through to a GET probe.
  }
  try {
    const res = await withTimeout(
      fetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } }),
      FETCH_TIMEOUT_MS
    );
    return res.ok;
  } catch {
    return false;
  }
}

// PH calendar date (UTC+8) for a given instant — used so the white-list
// guesses name the right local day regardless of the server's UTC clock.
const phDateOf = (d) => new Date(d.getTime() + PH_OFFSET_MS);

const guessedUrlForPhDate = (phDate) => {
  const year = phDate.getUTCFullYear();
  const month = phDate.getUTCMonth() + 1;
  const monthName = Object.keys(MONTHS)[month - 1];
  const monthNameCapitalized = monthName[0].toUpperCase() + monthName.slice(1);
  const mm = String(month).padStart(2, '0');
  const day = phDate.getUTCDate();
  return `https://www.da.gov.ph/wp-content/uploads/${year}/${mm}/Daily-Price-Index-${monthNameCapitalized}-${day}-${year}.pdf`;
};

// WordPress upload paths are exactly "{YYYY}/{MM}/Daily-Price-Index-{Month}-{D}-{YYYY}.pdf".
// Probing the last few PH days covers a sheet posted late on the previous day.
const guessedUrlsFor = (now) => {
  const urls = [];
  for (let back = 0; back <= 3; back += 1) {
    const at = new Date(now.getTime() - back * DAY_MS);
    urls.push(guessedUrlForPhDate(phDateOf(at)));
  }
  return urls;
};

// ---- database ---------------------------------------------------------------

async function loadActiveIngredients() {
  const { data, error } = await supabaseAdmin
    .from('ingredients')
    .select('id, name, unit')
    .eq('is_archived', false)
    .order('name', { ascending: true })
    .limit(MAX_INGREDIENTS);
  if (error) throw error;
  return data || [];
}

// One automated import per sheet date. Manual DA entries
// (is_manual_entry = true) never trip this guard.
async function alreadyImportedForDate(dateStr) {
  const { data, error } = await supabaseAdmin
    .from('market_price')
    .select('id')
    .eq('source', SOURCE_KEY)
    .eq('is_manual_entry', false)
    .gte('scraped_at', `${dateStr}T00:00:00`)
    .lte('scraped_at', `${dateStr}T23:59:59`)
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length);
}

// market_price.unit is NOT NULL and constrained to the store's units. The DA
// sheet sells most commodities per kilo; eggs and a few others per piece —
// but the ingredient list already knows its own unit, and the comparison view
// displays the ingredient's unit regardless. Normalize what we can, else kg.
const UNIT_ALIASES = {
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gram: 'g', grams: 'g',
  l: 'L', litre: 'L', liters: 'L', liter: 'L',
  ml: 'mL', millilitre: 'mL', milliliters: 'mL', milliliter: 'mL',
  pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs',
  pack: 'pack', packs: 'pack', box: 'box', boxes: 'box',
};
// unitForIngredient is CJS-style: normalize unit, else kg.
const unitForIngredient = (unit) =>
  UNIT_ALIASES[String(unit || '').trim().toLowerCase()] || 'kg';

// ---- confidence-matching -----------------------------------------------------

// Lower-cased alpha words of a name that actually identify it, singularized so
// "Carrots" in the DA sheet matches a "Carrot" ingredient and vice-versa.
// Tokens shorter than 3 letters (size units like "cm", "gm") are dropped.
// Parentheticals are KEPT on purpose: the DA sheet frequently carries the
// common name there — "Tambakol (Yellow-Fin Tuna)", "Sugar (Brown)",
// "Lettuce (Iceberg)" — and extra words on the DA side can only make a
// containment match easier, never narrower.
const singularize = (word) => {
  if (word.length <= 3) return word;
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`; // berries -> berry
  if (/oes$/.test(word)) return word.slice(0, -2); // tomatoes -> tomato
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2); // dishes -> dish
  if (/s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1); // carrots -> carrot
  return word;
};

const wordsOf = (name) => {
  const raw = String(name || '').toLowerCase().match(/[a-z]+/g) || [];
  return raw.filter((w) => w.length >= 3).map(singularize);
};

// The review path searches DA name -> ingredient list (long pattern, short
// bodies); here the containment guard has already pinned the ingredient, so
// the useful question is "how well does this SHORT ingredient name occur in
// the commodity name" — a substring scores ~1.0 where the reverse search
// would noisily fail (Fuse matched "Basmati Rice" against "Rice" badly).
const searchConfidence = (ingredientName, recordName) => {
  const fuse = createIngredientFuse([{ name: String(recordName) }]);
  const hits = fuse.search(String(ingredientName));
  if (hits.length) return matchConfidence(hits[0]);

  // Fuse's bitap matches substrings, so a reordered name ("Brown Sugar" vs the
  // sheet's "Sugar (Brown)") finds no hit at all. Containment has already
  // proved every ingredient word is present as a whole word, so fall back to
  // how much of the ingredient name the commodity covers (which is 1.0 for a
  // containment survivor) instead of rejecting on a scorer artefact.
  const daWords = new Set(wordsOf(recordName));
  const ingWords = wordsOf(ingredientName);
  if (!ingWords.length) return 0;
  return ingWords.filter((w) => daWords.has(w)).length / ingWords.length;
};

/**
 * Find the ingredient a DA commodity price should be auto-saved to, or null.
 *
 * Two independent bars, both required:
 *   1. containment — every significant word of the ingredient name must appear
 *      as a whole word in the DA commodity name (singularized, parens kept).
 *      This rejects "Chicken Feet" for an ingredient called "Chicken Egg" and
 *      keeps "Tambakol (Yellow-Fin Tuna)" reachable for an ingredient "Tuna".
 *   2. confidence — the ingredient name, searched against the commodity name
 *      (SHORT pattern, LONG body — the reverse of the review path's Fuse
 *      direction), must clear AUTOSAVE_CONFIDENCE. A substring ingredient
 *      scores ~1.0 ("Rice" inside "Basmati Rice"); an edit-distorted one does
 *      not.
 *
 * Among the survivors the most specific ingredient wins: highest confidence,
 * then the longest name (more words pinned the commodity), then document
 * order. Null means "not confident enough to write without a human" — the row
 * is skipped, never queued.
 */
const findConfidentIngredient = (recordName, ingredients) => {
  const daWords = wordsOf(recordName);
  if (!daWords.length) return null;

  const daMap = new Set(daWords);
  const scored = [];
  for (const ingredient of ingredients || []) {
    const ingWords = wordsOf(ingredient.name);
    if (!ingWords.length) continue;
    if (!ingWords.every((w) => daMap.has(w))) continue;

    const confidence = searchConfidence(ingredient.name, recordName);
    if (confidence < AUTOSAVE_CONFIDENCE) continue;
    scored.push({ ingredient, confidence });
  }
  if (!scored.length) return null;

  scored.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      b.ingredient.name.length - a.ingredient.name.length ||
      a.ingredient.id - b.ingredient.id
  );

  const best = scored[0];
  return { ingredient: best.ingredient, confidence: best.confidence };
};

// ---- the run ----------------------------------------------------------------

// Collapse the day's per-commodity matches into at most one row per ingredient:
// price = mean of the confident matches, so "Rice" is one stable number across
// Basmati/Glutinous/milled variants rather than whichever commodity happened to
// appear last in the sheet. This is what makes day-over-day comparison honest:
// the same DA variants return daily, so the mean moves only when the market
// does. Each input row already carries the same source / unit / receipt_url /
// scraped_at (one sheet date), so averaging price and confidence is sufficient.
const aggregateDailyRows = (rows) => {
  const byIngredient = new Map();
  for (const row of rows) {
    const existing = byIngredient.get(row.ingredient_id);
    if (!existing) {
      byIngredient.set(row.ingredient_id, {
        ...row,
        _priceSum: Number(row.price),
        _confidenceSum: Number(row.ocr_confidence) || 0,
        _count: 1,
      });
      continue;
    }
    existing._priceSum += Number(row.price);
    existing._confidenceSum += Number(row.ocr_confidence) || 0;
    existing._count += 1;
  }

  const out = [];
  for (const aggregate of byIngredient.values()) {
    const { _priceSum, _confidenceSum, _count, ...row } = aggregate;
    out.push({
      ...row,
      price: Number((_priceSum / _count).toFixed(3)),
      ocr_confidence: Number((_confidenceSum / _count).toFixed(3)),
    });
  }
  return out;
};

// Returns a report object (never throws). status is one of: 'succeeded',
// 'skipped' (same sheet date already imported), 'no_match', 'dryrun', 'failed'.
async function discoverLatestPriceIndexUrl({ now = new Date() } = {}) {
  const monitoringUrl = process.env.DA_PRICE_MONITORING_URL || DEFAULT_MONITORING_URL;
  const html = await fetchHtml(monitoringUrl);
  const best = selectLatestPriceIndexLink(extractPriceIndexCandidates(html), { now });
  if (best) return best.url;
  for (const url of guessedUrlsFor(now)) {
    if (await urlExists(url)) return url;
  }
  return null;
}

async function runDailyPriceImport({ dryRun = false } = {}) {
  const report = { status: 'running', startedAt: new Date().toISOString(), url: null, sheetDate: null };
  try {
    const now = new Date();
    const url = await discoverLatestPriceIndexUrl({ now });
    if (!url) {
      report.status = 'failed';
      report.error = 'No Daily Price Index PDF found on the price-monitoring page (and no dated fallback URL resolved).';
      return report;
    }
    report.url = url;

    const fileNameDate = parseSheetDateFromFilename(url);
    report.sheetDate = fileNameDate;

    if (fileNameDate && (await alreadyImportedForDate(fileNameDate))) {
      report.status = 'skipped';
      report.reason = `already imported for ${fileNameDate}`;
      return report;
    }

    const pdf = await downloadPdf(url);
    const text = await extractPdfText(pdf);
    if (!isDailyPriceIndex(text)) {
      report.status = 'failed';
      report.error = 'Downloaded PDF text is not a Daily Price Index sheet.';
      return report;
    }

    const { records, skipped } = parseDailyPriceIndex(text);
    report.recordsParsed = records.length;
    report.unavailable = skipped;

    const sheetDate = fileNameDate || parseSheetDateFromText(text) || now.toISOString().slice(0, 10);
    report.sheetDate = sheetDate;
    if (!fileNameDate) report.sheetDateFromText = true;

    const ingredients = await loadActiveIngredients();
    const rows = [];
    const skippedMatches = [];

    for (const record of records) {
      if (record.price === null) continue;
      if (!(record.price > 0) || record.price > MAX_PRICE) continue;

      const match = findConfidentIngredient(record.name, ingredients);
      if (!match) {
        skippedMatches.push({ name: record.name });
        continue;
      }
      const { ingredient, confidence } = match;

      rows.push({
        ingredient_id: ingredient.id,
        source: SOURCE_KEY,
        price: Number(record.price),
        unit: unitForIngredient(ingredient.unit),
        // Not a human entry: marks this row as fed by the automated import.
        is_manual_entry: false,
        // Same semantics as the receipt-OCR column: how sure the fuzzy match
        // was (0..1), so a low-confidence row can be spotted later.
        ocr_confidence: Number(confidence.toFixed(3)),
        // Provenance: which official sheet this price came from. Stored as
        // text, never fetched by the server (same contract as receipts).
        receipt_url: url,
        scraped_at: `${sheetDate}T00:00:00`,
      });
    }

    report.matchedCommodities = rows.length;
    report.lowConfidenceCount = skippedMatches.length;
    report.lowConfidence = skippedMatches.slice(0, 25);

    // One price point per ingredient per sheet date (see aggregateDailyRows).
    const dailyRows = aggregateDailyRows(rows);
    report.matched = dailyRows.length;

    if (dryRun) {
      report.status = 'dryrun';
      report.rows = dailyRows;
      return report;
    }

    if (!dailyRows.length) {
      report.status = 'no_match';
      report.reason = 'No commodity scored a confident match against the current inventory.';
      return report;
    }

    const { data: inserted, error } = await supabaseAdmin
      .from('market_price')
      .insert(dailyRows)
      .select();
    if (error) throw error;

    report.saved = (inserted || []).length;
    report.status = 'succeeded';
    report.finishedAt = new Date().toISOString();

    
  } catch (error) {
    report.status = 'failed';
    report.finishedAt = new Date().toISOString();
    report.error = String((error && error.message) || error || 'unknown error').slice(0, 400);
    console.error('[daPriceImport] Run failed:', error);
  }

  return report;
}

module.exports = {
  SOURCE_KEY,
  AUTOSAVE_CONFIDENCE,
  parseSheetDateFromFilename,
  parseSheetDateFromText,
  extractPriceIndexCandidates,
  selectLatestPriceIndexLink,
  guessedUrlsFor,
  wordsOf,
  searchConfidence,
  findConfidentIngredient,
  aggregateDailyRows,
  runDailyPriceImport,
};