// backend/routes/marketPrices.js
//
// POST /api/market-prices/parse-receipt — turns OCR text from a staff-supplied
// receipt photo into reviewable, ingredient-matched price lines.
//
// Kept in a separate file from routes/marketPrice.js on purpose: that router
// is the "MANUAL-ONLY" module (see its controller header) and this one is the
// only place that touches receipt text. Both are mounted on the same
// /api/market-prices prefix in server.js — Express falls through the first
// router when no route matches.
//
// This module never writes anything. The returned lines are shown in the
// review screen and only reach the database when staff press "Save confirmed
// prices", which posts to the existing /market-prices/bulk-upsert endpoint.
//
// No website is scraped and no retailer is contacted: the only input is the
// text the user's own photo produced (tesseract.js in the browser).
const express = require('express');
const Fuse = require('fuse.js');
const authenticateToken = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();
router.use(authenticateToken);

// ---- tuning ----------------------------------------------------------------

// OCR text is user input. Anything longer than this is either a pasted novel
// or an attack, never a receipt, and Fuse would burn CPU on it.
const MAX_TEXT_LENGTH = 100000;

// A grocery receipt line above this is a misread (8 -> 888888) — saving it
// would poison the price history, so the line is dropped before review.
const MAX_PRICE = 100000;

// Fuse's threshold is "reject anything scoring worse than this". 0.5 keeps
// plural/singular and word-order differences ("Pork, Ground" vs "Ground Pork")
// while dropping unrelated words; the flip side is that a passing score can
// still be a weak match, which is exactly what `confidence` (1 - score) and
// the <0.6 low-confidence highlight in the UI are for.
const FUZZY_THRESHOLD = 0.5;
const CANDIDATE_COUNT = 5;

// The ingredient list changes rarely and every scan re-reads it; 60s keeps a
// burst of scans off the database without ever serving stale data for long.
const INGREDIENT_CACHE_MS = 60 * 1000;

// The source key is validated for SHAPE here only — the authoritative check
// ("must exist in market_sources") already happens in bulkUpsertPrices at
// save time, so the source registry lives in exactly one place.
const SOURCE_KEY_RE = /^[a-z0-9_]{1,40}$/i;

// market_price.unit is a constrained column (ALLOWED_UNITS in
// marketPriceController). A receipt unit outside it would make bulk-upsert
// reject the WHOLE payload, so units are mapped to a storable one here and
// the reviewer still sees the original text in the raw column.
// lb/lbs map to null on purpose: converting pounds to kilos means changing
// the quantity too, which is a human decision, not ours.
const TO_STORABLE_UNIT = {
  kg: 'kg',
  k: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  g: 'g',
  gram: 'g',
  grams: 'g',
  l: 'L',
  litre: 'L',
  litres: 'L',
  liter: 'L',
  liters: 'L',
  ml: 'mL',
  pc: 'pcs',
  pcs: 'pcs',
  p: 'pcs',
  piece: 'pcs',
  pieces: 'pcs',
  pack: 'pack',
  packs: 'pack',
  box: 'box',
  boxes: 'box',
  bottle: 'pcs',
  bottles: 'pcs',
  can: 'pcs',
  cans: 'pcs',
  sack: 'pcs',
  sacks: 'pcs',
  lb: null,
  lbs: null,
};

// ---- receipt line parser ---------------------------------------------------

// One price pattern shared by both line shapes:
//  * thousands separators ("1,299.75") because SM/Gaisano receipts print
//    them — with a bare \d{1,6} the line below would parse as price 1 and
//    then fail on ",299.75", silently losing the item;
//  * OCR'd decimal comma ("62,50") because OCR reads the point as a comma.
const PRICE_NUM = String.raw`\d{1,3}(?:,\d{3})+(?:[.,]\d{1,2})?|\d{1,6}(?:[.,]\d{1,2})?`;

// Unit tokens, longest-first (kilograms before kilo before k) so the
// alternation never has to backtrack into a wrong branch. The single-letter
// forms (k, p, l) are what receipts use in per-unit prices: "100/k",
// "60/p". Case-insensitive at use sites; every token is lower-case here
// because TO_STORABLE_UNIT is keyed lower-case.
const UNIT_TOKEN = String.raw`kilograms|kilogram|kgs|kilos|kg|kilo|k|grams|gram|g|millilitres|milliliters|millilitre|milliliter|ml|litres|liters|litre|liter|l|pieces|piece|pcs|pc|p|packs|pack|boxes|box|bottles|bottle|cans|can|sacks|sack|lbs|lb`;

// Full item line: optional name + optional (qty + unit) + price + optional
// range ("240.00 - 280.00" on DA price lists) + optional per-unit suffix
// ("100/k"). Tuning notes:
//  * the whole qty+unit group sits inside one optional group with the space,
//    so a name-only-amount line ("Sibuyas 179.00") parses without demanding
//    a unit, while "3 kg" still binds qty to its unit;
//  * the unit inside that group is REQUIRED when the group matches — making
//    it optional would let qty swallow the price ("Sibuyas 179.00" could
//    parse as qty=17, price=9.00 after backtracking);
//  * the name is up to 60 characters because OCR glues the store banner or
//    a long product description onto the item line;
//  * ^...$ anchors survive because callers trim/collapse whitespace first.
const LINE_RE = new RegExp(
  `^(?<name>[A-Za-z][A-Za-z0-9&'.,\\- ]{2,60}?)` +
    `(?:\\s+(?:(?<qty>\\d+(?:[.,]\\d+)?)\\s*)?(?<unit>${UNIT_TOKEN}))?` +
    `\\s*(?:[xX*@]\\s*)?` +
    `(?<price>${PRICE_NUM})` +
    `(?:\\s*(?:-|\\bto\\b)\\s*(?<price2>${PRICE_NUM}))?` +
    `(?:(?:\\s*/\\s*|\\s*\\bper\\s+)\\s*(?<sfunit>${UNIT_TOKEN}))?` +
    `\\s*$`,
  'i'
);

// Nameless per-unit amount ("100/k", "6O/p", "₱ 160.00 per kg") — the unit
// price lines market price lists print with no item name on the row. The
// suffix is REQUIRED so a bare amount ("179.00") never becomes a nameless
// row: those must merge into the name line above via mergeSplitLines.
const PRICE_LINE_RE = new RegExp(
  `^(?:[₱$]\\s*)?(?<price>${PRICE_NUM})` +
    `(?:\\s*(?:-|\\bto\\b)\\s*(?<price2>${PRICE_NUM}))?` +
    `(?:\\s*/\\s*|\\s*\\bper\\s+)\\s*(?<sfunit>${UNIT_TOKEN})` +
    `\\s*$`,
  'i'
);

// Second attempt for lines with junk after the price ("89.50 *" or
// "89.50 PHP") — receipts print trailing reference codes constantly.
const TRAILING_JUNK_RE = /[^0-9]+$/;

// Totals, column headers and counter lines are not items. Each alternative
// exists because it showed up in real OCR output; they are checked before the
// item regex so "TOTAL DUE 1,299.75" never reaches the review screen as an
// ingredient called "Total Due". "commodity|page|released" covers DA price
// list sheets ("Commodity", "Page 1 of 1", "Released: ...").
const NOISE_RE = /^(?:total|subtotal|sub\s*total|amount\s*due|balance|payment|cash|change|tender(?:ed)?|vat|vatable|sales\s*tax|tax|discount|points?|loyalty|item|items|description|qty|quantity|unit\s*price|amount|product|code|sku|barcode|date|time|cashier|terminal|transaction|invoice|receipt|order|ref(?:erence)?|or#|tin|vat\s*reg|address|tel|phone|www|commodity|page|released|thank\s*you|welcome)\b/i;

const isNoiseLine = (line) =>
  NOISE_RE.test(line) ||
  /^[^A-Za-z]*$/.test(line) || // no letters at all: bare totals, rules, barcode runs
  /\*{3,}|={3,}|-{5,}/.test(line); // separator rows

const normalizeReceiptLine = (line) =>
  String(line)
    .replace(/\s+/g, ' ')
    .replace(/[₱$]/g, ' ') // currency symbols belong to the price, not the name
    // Currency words leave the amount leading the line ("Php 100/k" ->
    // "100/k") so PRICE_LINE_RE can see it; the lookahead keeps the word in
    // prose that merely precedes a number ("Receipt 5").
    .replace(/\b(?:php|pesos?)(?=\s*[\d.])/gi, ' ')
    // Bare "P 100"/"P100" currency marker, but only outside a word: "cup 3"
    // must keep its p.
    .replace(/(^|[^A-Za-z])p(?=\s*\d)/gi, '$1')
    // OCR reads capital O as zero inside numbers: "6O/p" -> "60/p",
    // "1OO.00" -> "100.00". Runs of O's all become zeros.
    .replace(/([0-9])[Oo]+/g, (match, digit) => digit + '0'.repeat(match.length - 1))
    .replace(/[\u2013\u2014]/g, '-') // en/em dash -> hyphen so ranges parse
    .replace(/^\s*\d{1,3}\s*[.)]\s+/, '') // "1. ONION ..." enumeration
    .replace(/\s+/g, ' ')
    .trim();

// "1,299.75" is thousands+decimal, "89,50" is an OCR'd decimal point, and
// "89.50" needs no work — one heuristic covers all three without mistaking
// 89,50 for 8950.
const toPrice = (raw) => {
  let text = String(raw);
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text)) {
    text = text.replace(/,/g, '');
  } else if (/^\d+,\d{2}$/.test(text)) {
    text = text.replace(',', '.');
  } else {
    text = text.replace(/,/g, '');
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const toQuantity = (raw) => {
  const value = Number(String(raw).replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

// Tries both line shapes, with the trailing-junk second attempt for each:
// a full item line first (it can carry the same suffix as a nameless
// amount), then the nameless "100/k" form.
const matchReceiptLine = (line) => {
  for (const candidate of [line, line.replace(TRAILING_JUNK_RE, '').trim()]) {
    if (!candidate) continue;
    const item = LINE_RE.exec(candidate);
    if (item && item.groups) return item.groups;
    const amount = PRICE_LINE_RE.exec(candidate);
    if (amount && amount.groups) return amount.groups;
  }
  return null;
};

const parseReceiptLine = (rawLine) => {
  const line = normalizeReceiptLine(rawLine);
  if (!line || isNoiseLine(line)) return null;

  const groups = matchReceiptLine(line);
  if (!groups) return null;

  // A price range lists two numbers; the second one is the current/higher
  // figure a market price should record.
  const price = toPrice(groups.price2 || groups.price);
  // Negative prices are impossible (the regex has no sign) but a misread
  // six-digit price is not, so the guard stays explicit.
  if (price === null || price < 0 || price > MAX_PRICE) return null;

  // The per-unit suffix ("100/k") states the unit the price is FOR, so it
  // wins over any unit bound to the quantity on the same line.
  const unitToken = groups.sfunit || groups.unit;

  return {
    // Nameless per-unit rows keep name null (Fuse is skipped for them in
    // the handler) and reach review unassigned for manual matching.
    name: groups.name ? groups.name.trim() : null,
    qty: groups.qty ? toQuantity(groups.qty) : null,
    unit: unitToken ? unitToken.toLowerCase() : null,
    price,
  };
};

// OCR often breaks a wide receipt BETWEEN an item's name and its amount
// ("ONION" on one line, "89.50" on the next). Name-only lines carry no price
// and bare-number lines are filtered out, so without this pass that item — and
// on a 4-item receipt that is a whole quarter of the scan — silently vanishes.
// The rule is deliberately conservative so real totals never join an item:
//   * the previous line must contain a letter AND not end in a digit (a line
//     already ending in a number is a complete item: "ONION 89.50");
//   * the current line must be money-only — digits/commas/decimals with an
//     optional ₱/$/PHP, and crucially NO dashes, so dates like 2026-10-06
//     and times can never be glued onto a name as a fake price.
const HAS_LETTER_RE = /[A-Za-z]/;
const ENDS_WITH_DIGIT_RE = /\d$/;
const MONEY_ONLY_RE = /^(?:[₱$]\s*)?\d{1,3}(?:,\d{3})*(?:[.,]\d{1,2})?(?:\s*(?:php|pesos?))?$/i;
// A line that LEADS with currency ("Php 100/k", "P 60", "₱160.00"): it is
// an amount whose item name sits on the line above, even when a per-unit
// suffix stops it from being money-only. The lookahead requires a digit
// right after the marker so prose like "Php payment..." never merges.
const PRICE_LED_RE = /^(?:[₱$]\s*|php\s*|pesos?\s*|p\s*)(?=[\d.])/i;

const mergeSplitLines = (rawLines) => {
  const merged = [];
  for (const rawLine of rawLines) {
    const text = rawLine.trim();
    if (!text) continue;
    const prev = merged.length ? merged[merged.length - 1] : null;
    if (
      prev &&
      HAS_LETTER_RE.test(prev) &&
      !ENDS_WITH_DIGIT_RE.test(prev) &&
      (MONEY_ONLY_RE.test(text) || PRICE_LED_RE.test(text))
    ) {
      merged[merged.length - 1] = `${prev} ${text}`;
      continue;
    }
    merged.push(text);
  }
  return merged;
};

// ---- ingredients ------------------------------------------------------------

let ingredientCache = { rows: null, at: 0 };

const loadIngredients = async () => {
  const now = Date.now();
  if (ingredientCache.rows && now - ingredientCache.at < INGREDIENT_CACHE_MS) {
    return ingredientCache.rows;
  }

  // Archived ingredients must never receive new prices, hence the filter
  // (they are still listed in the inventory for historical records).
  const { data, error } = await supabaseAdmin
    .from('ingredients')
    .select('id, name, unit')
    .eq('is_archived', false)
    .order('name', { ascending: true })
    .limit(1000);

  if (error) throw error;
  ingredientCache = { rows: data || [], at: now };
  return ingredientCache.rows;
};

// ---- handler ----------------------------------------------------------------

// POST /api/market-prices/parse-receipt
// Body:   { text: string, source: string }
// Response: { success, data: { lines, fallbackIngredients, skipped } }
const parseReceipt = async (req, res) => {
  try {
    const { text, source } = req.body || {};

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: 'text must be a non-empty string of receipt text'
      });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({
        success: false,
        error: `text must be at most ${MAX_TEXT_LENGTH} characters`
      });
    }
    if (
      source !== undefined &&
      source !== null &&
      source !== '' &&
      !SOURCE_KEY_RE.test(String(source))
    ) {
      return res.status(400).json({ success: false, error: 'source is not a valid market source key' });
    }

    const ingredients = await loadIngredients();
    const fuse = new Fuse(ingredients, {
      keys: ['name'],
      threshold: FUZZY_THRESHOLD,
      ignoreLocation: true,
      includeScore: true,
    });

    const lines = [];
    let skipped = 0;

    // mergeSplitLines first: re-joins name/amount pairs that OCR split across
    // lines, so a 4-item paper stays 4 review rows instead of dropping the
    // items whose amount landed on its own line.
    for (const trimmed of mergeSplitLines(text.split(/\r?\n/))) {
      const parsed = parseReceiptLine(trimmed);
      if (!parsed) {
        skipped += 1;
        continue;
      }

      // Nameless per-unit rows ("100/k") have no name to search — Fuse
      // treats a non-string pattern as an extended-search expression
      // (crash), so the guard is explicit; they reach review unassigned.
      const hits = parsed.name ? fuse.search(parsed.name) : [];
      const top = hits[0];

      lines.push({
        raw: trimmed,
        qty: parsed.qty,
        // undefined key (e.g. "jar") -> null, which the UI turns into the
        // matched ingredient's own unit.
        unit: parsed.unit ? (TO_STORABLE_UNIT[parsed.unit] ?? null) : null,
        price: parsed.price,
        ingredientId: top ? top.item.id : null,
        ingredientName: top ? top.item.name : null,
        confidence: top ? Math.max(0, Math.min(1, 1 - top.score)) : 0,
        candidates: hits.slice(0, CANDIDATE_COUNT).map((hit) => ({
          id: hit.item.id,
          name: hit.item.name,
        })),
      });
    }

    res.json({
      success: true,
      data: {
        lines,
        // Used to fill the "All ingredients" half of every candidate dropdown
        // (the top-5 fuzzy hits are already per line).
        fallbackIngredients: ingredients.map((item) => ({
          id: item.id,
          name: item.name,
          unit: item.unit,
        })),
        skipped,
      },
    });
  } catch (error) {
    // Receipt text can never produce a 500: every input problem is answered
    // with 400 above, and "no parseable lines" is a 200 with lines: [].
    // Reaching here means the ingredient lookup failed.
    console.error('Error parsing receipt:', error);
    res.status(500).json({ success: false, error: 'Could not parse the receipt' });
  }
};

router.post('/parse-receipt', parseReceipt);

module.exports = router;
