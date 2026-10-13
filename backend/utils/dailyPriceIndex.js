// backend/utils/dailyPriceIndex.js
//
// Parser for the Department of Agriculture "Daily Price Index" sheets that the
// regional field offices publish as PDFs (a.k.a. Bantay Presyo). The PDFs that
// carry a real text layer extract cleanly through pdf.js, but their layout is
// nothing like a grocery receipt: section headers, one average price per
// commodity, "n/a" for unavailable items, commodity names that wrap across two
// lines, and specifications full of numbers, percent signs and parentheses
// ("Well Milled 1-19% bran streak", "Chicken Egg (White, Medium) 56-60
// grams/pc"). The receipt parser in routes/marketPrices.js drops most of those
// rows, so the sheet gets its own parser here.
//
// Pure text in, records out — no Express, no Supabase, no PDF library — so it
// can be unit-tested with plain `node tests/dailyPriceIndex.test.js`.
'use strict';

// Recognised the way a human would: the sheet always prints its own title and
// subtitle. The subtitle ("Prevailing Retail Price of Agri-fishery ...") is
// what every regional variant shares, so either marker is enough.
const DAILY_PRICE_INDEX_RE =
  /daily\s+price\s+index|prevailing\s+retail\s+price\s+of\s+agri/i;

const isDailyPriceIndex = (text) => DAILY_PRICE_INDEX_RE.test(String(text || ''));

// A price cell is either a two-decimal peso amount ("170.00", "1,005.00") or
// the literal "n/a". Specifications such as "56-60", "12-14 pcs/kg" or
// "510 gm - 1 kg/head" deliberately do NOT match: they never end in a
// two-decimal amount.
const PRICE_TAIL_RE = /^(.*?)\s*((?:n\/a)|(?:\d{1,3}(?:,\d{3})*|\d{1,4})\.\d{2})$/i;
const NA_RE = /^n\/a$/i;

// Section headers ("IMPORTED COMMERCIAL RICE", "OTHER LIVESTOCK MEAT",
// "PRODUCTS") carry no lowercase letters and no price, so this one test skips
// them and the table's own column header ("COMMODITY SPECIFICATION ...").
const isUppercaseHeader = (line) =>
  /[A-Z]/.test(line) && line === line.toUpperCase();

// Preamble/footer lines that are not data. Region names vary, so "region" and
// "province" are matched loosely; the note block ends the sheet entirely.
const NOISE_RE =
  /^(?:page\s+\d+\s+of\s+\d+|department\s+of\s+agriculture|daily\s+price\s+index|prevailing\b|national\s+capital|region\b|province\b|commodity\b|unit\s*\(|note\b)/i;
const DATE_ONLY_RE = /^\(.*\d{4}.*\)$/;
const NOTE_START_RE = /^note\s*\(s\)/i;

const toPrice = (raw) => {
  if (NA_RE.test(String(raw).trim())) return null;
  const value = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
};

// OCR'd sheets prefix rows with an item number and separate cells with pipes;
// both are noise for matching. Runs of spaces are collapsed by the caller.
const normalizeLine = (raw) =>
  String(raw)
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*\d{1,3}\s*[.)]\s+/, '')
    .trim();

const cleanName = (raw) =>
  String(raw)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;)])/g, '$1')
    .replace(/[-–—,;:]+$/, '')
    .replace(/^[\s\-–—,;:]+/, '')
    .trim();

/**
 * Parse a Daily Price Index sheet into reviewable records.
 *
 * @param {string} text  text extracted from the PDF (one visual line per "\n")
 * @returns {{ records: Array<{ name: string, price: number|null, raw: string }>, skipped: number }}
 *   `records` keeps every commodity found, priced or not (price === null for
 *   "n/a"); `skipped` counts the "n/a" rows so callers can report them.
 */
function parseDailyPriceIndex(text) {
  const records = [];

  // A wrapped commodity name is buffered here until its price (or the price
  // that precedes it) arrives. `pendingPrice` covers the layout where the price
  // cell sits on its own line ABOVE the commodity ("n/a" then "Duck Meat,
  // Imported"); `tailOfStandalone` covers the opposite, where the last word of
  // a wrapped name ("Local"/"Imported") drops BELOW a standalone price line.
  let buffer = [];
  // `pending` (not a null price) marks a standalone price line whose commodity
  // is still to come; a null price is a valid "n/a" value, so it cannot double
  // as the "nothing pending" sentinel.
  let pending = null; // { price }
  // True while the just-emitted record's wrapped name may still have a tail
  // ("Local"/"Imported"/"... hd)") on the following line(s).
  let tailOpen = false;

  // A fragment only continues the previous row when it clearly reads as a
  // wrapped-name tail; a new commodity's spec prefix never does.
  const TAIL_LIKE_RE = /^(?:local|imported)$|\)\s*$|-\s*$/i;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = normalizeLine(rawLine);
    if (!line) continue;

    if (NOTE_START_RE.test(line)) break;
    if (DATE_ONLY_RE.test(line)) continue;

    const match = line.match(PRICE_TAIL_RE);
    if (match) {
      const name = match[1].trim();
      const price = toPrice(match[2]);

      if (name) {
        // Inline row: "Basmati Rice 170.00". Everything buffered above is the
        // wrapped prefix of this commodity's name, so an inline row built on a
        // buffer is itself wrapped and may still have a tail.
        const wrapped = buffer.length > 0;
        records.push({ name: cleanName(`${buffer.join(' ')} ${name}`), price, raw: line });
        buffer = [];
        pending = null;
        tailOpen = wrapped;
      } else if (buffer.length) {
        // The price sits on its own line but a name was already buffered —
        // the name wrapped and its tail follows ("Pork Picnic Shoulder
        // (Kasim)," / "312.75" / "Local").
        records.push({ name: cleanName(buffer.join(' ')), price, raw: line });
        buffer = [];
        tailOpen = true;
      } else {
        // Price before its commodity ("n/a" / "Duck Meat, Imported").
        pending = { price };
        tailOpen = false;
      }
      continue;
    }

    if (isUppercaseHeader(line) || NOISE_RE.test(line)) {
      // A section boundary: never let the previous section's fragments leak
      // into the next one.
      buffer = [];
      pending = null;
      tailOpen = false;
      continue;
    }

    // No price on this line: a name/specification fragment.
    if (pending) {
      records.push({ name: cleanName(line), price: pending.price, raw: line });
      pending = null;
      tailOpen = true;
      continue;
    }

    if (tailOpen && records.length && TAIL_LIKE_RE.test(line)) {
      // Tail of a wrapped name that fell below its price line.
      const last = records[records.length - 1];
      last.name = cleanName(`${last.name} ${line}`);
      tailOpen = false;
      continue;
    }

    tailOpen = false;
    buffer.push(line);
  }

  const skipped = records.reduce(
    (count, record) => (record.price === null ? count + 1 : count),
    0
  );

  return { records, skipped };
}

module.exports = { isDailyPriceIndex, parseDailyPriceIndex };
