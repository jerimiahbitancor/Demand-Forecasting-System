// controllers/marketPriceController.js
/**
 * Market Price controller — LEGAL / MANUAL-ONLY EDITION
 *
 * This module does NOT scrape any website and does NOT call any external API.
 * No axios.get, no fetch, no node-fetch, no puppeteer, no cheerio, no playwright.
 * The only "network" this code talks to is the Supabase database.
 *
 * Every price row originates from authenticated human input via the UI:
 * staff physically read the price in a store or on the official DA Bantay
 * Presyo page, then type it into the app.
 *
 * The `scraped_at` column is repurposed as "recorded_at" — the timestamp when
 * a human entered the price. The column name is kept as-is to avoid a
 * database migration; never use it for automated scraping.
 *
 * Rationale: scraping Philippine supermarket or government websites may violate
 * their Terms of Service, the Cybercrime Prevention Act, and NPC Advisory
 * No. 2026-01 on data privacy. See: https://privacy.gov.ph/
 */
const { supabaseAdmin } = require('../config/supabase');
const { logAction } = require('../services/auditService');
const { createNotification } = require('../services/notificationService');

// Market sources are stored in the `market_sources` table so staff can add
// their own stores (e.g. "Gaisano", "Metro", "SNR") without touching code.
// These five are the built-in defaults, and also the fallback when the table
// is not present / empty.
const DEFAULT_SOURCES = [
  { key: 'robinsons', label: "Robinson's", tooltip: 'Manually recorded from an in-store visit.' },
  { key: 'sm', label: 'SM', tooltip: 'Manually recorded from an in-store visit.' },
  { key: 'puregold', label: 'Puregold', tooltip: 'Manually recorded from an in-store visit.' },
  { key: 'wet_market', label: 'Wet Market', tooltip: 'Manually recorded from an in-store visit.' },
  { key: 'da_reference', label: 'DA Reference', tooltip: 'Manually copied from the DA Bantay Presyo page (da.gov.ph/price-monitoring).' }
];

const ALLOWED_UNITS = ['kg', 'g', 'L', 'mL', 'pcs', 'box', 'pack'];

let cachedSources = null;

const getMarketSources = async ({ force = false } = {}) => {
  if (cachedSources && !force) return cachedSources;
  try {
    const { data, error } = await supabaseAdmin
      .from('market_sources')
      .select('key, label, tooltip, display_order, is_active')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (!error && Array.isArray(data) && data.length > 0) {
      cachedSources = data.map((s) => ({ id: s.id, key: s.key, label: s.label, tooltip: s.tooltip || '' }));
      return cachedSources;
    }
  } catch (e) {
    // `market_sources` table not present yet — fall back to the built-in defaults.
  }
  cachedSources = DEFAULT_SOURCES.map((s) => ({ ...s }));
  return cachedSources;
};

// Reverse lookup for a readable source name in audit logs ("sm" -> "SM").
const labelForSource = (sources, key) => (sources.find((s) => s.key === key) || {}).label || key;

const isKnownSource = async (source) => (await getMarketSources()).some((s) => s.key === source);

// Ingredient units are stored as free text (e.g. "KG", "Grams", "pcs").
// Normalize any common spelling to the canonical unit the market_price table uses.
const UNIT_ALIASES = {
  kg: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg', 'kg (kg)': 'kg', 'kilograms (kg)': 'kg',
  g: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g', 'g (g)': 'g', 'gram (g)': 'g', 'grams (g)': 'g',
  l: 'L', litre: 'L', litres: 'L', liter: 'L', liters: 'L', 'l (l)': 'L', 'liter (l)': 'L', 'liters (l)': 'L', 'litre (l)': 'L',
  ml: 'mL', millilitre: 'mL', millilitres: 'mL', milliliter: 'mL', milliliters: 'mL', 'ml (ml)': 'mL', 'milliliter (ml)': 'mL', 'milliliters (ml)': 'mL',
  pcs: 'pcs', pc: 'pcs', pce: 'pcs', pces: 'pcs', piece: 'pcs', pieces: 'pcs', 'pcs (pcs)': 'pcs', 'pieces (pcs)': 'pcs',
  box: 'box', boxes: 'box', 'box (box)': 'box', 'boxes (box)': 'box',
  pack: 'pack', packs: 'pack', 'pack (pack)': 'pack', 'packs (pack)': 'pack'
};

const normalizeUnit = (value) => {
  if (value === undefined || value === null) return null;
  const key = String(value).trim().toLowerCase();
  return UNIT_ALIASES[key] || null;
};

const actorOf = (req) => req.user?.name || req.user?.email || null;

const toNumber = (value) =>
  value === undefined || value === null || value === '' ? null : Number(value);

const isValidNonNegativeDecimal = (value) => {
  if (value === undefined || value === null || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
};

const normalizeScrapedAt = (value) => {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const validationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const getIngredient = async (ingredientId) => {
  const { data, error } = await supabaseAdmin
    .from('ingredients')
    .select('id, name, unit')
    .eq('id', ingredientId)
    .maybeSingle();

  if (error) {
    console.error('Error checking ingredient:', error);
    throw error;
  }
  return data;
};

const computeSummary = (rows, sources) => {
  const sourceSums = {};
  sources.forEach((s) => {
    sourceSums[s.key] = [];
  });

  let sumLowest = 0;
  let countLowest = 0;
  let biggestGap = null;
  let biggestGapIngredient = null;
  let maxLastUpdated = null;

  for (const row of rows) {
    sources.forEach((s) => {
      if (row[s.key] !== null && row[s.key] !== undefined) sourceSums[s.key].push(row[s.key]);
    });

    if (row.lowest !== null) {
      sumLowest += Number(row.lowest);
      countLowest += 1;
    }
    if (row.highest !== null && row.lowest !== null) {
      const gap = Number(row.highest) - Number(row.lowest);
      if (biggestGap === null || gap > biggestGap) {
        biggestGap = gap;
        biggestGapIngredient = row.ingredient;
      }
    }
    if (row.lastUpdated && (!maxLastUpdated || new Date(row.lastUpdated) > new Date(maxLastUpdated))) {
      maxLastUpdated = row.lastUpdated;
    }
  }

  let cheapestSource = null;
  let cheapestAvg = null;
  sources.forEach((s) => {
    if (sourceSums[s.key].length) {
      const avg = sourceSums[s.key].reduce((sum, v) => sum + v, 0) / sourceSums[s.key].length;
      if (cheapestAvg === null || avg < cheapestAvg) {
        cheapestAvg = avg;
        cheapestSource = s;
      }
    }
  });

  return {
    cheapestSource: cheapestSource
      ? { source: cheapestSource.key, label: cheapestSource.label, avg: Number(cheapestAvg.toFixed(2)) }
      : null,
    avgPrice: countLowest ? Number((sumLowest / countLowest).toFixed(2)) : 0,
    biggestGap:
      biggestGap !== null
        ? { value: Number(biggestGap.toFixed(2)), ingredient: biggestGapIngredient }
        : null,
    lastUpdated: maxLastUpdated || null
  };
};

// GET /api/market-prices/comparison
const getComparison = async (req, res) => {
  try {
    const {
      search,
      category,
      source,
      sortBy = 'ingredient',
      sortOrder = 'asc',
      page = 1,
      limit = 10
    } = req.query;

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageLimit = Math.max(parseInt(limit, 10) || 10, 1);

    // ---- 1. Fetch matching ingredients (archived excluded, like the main table) ----
    let ingredientQuery = supabaseAdmin
      .from('ingredients')
      .select('id, name, unit, price, category, is_archived')
      .eq('is_archived', false);

    // Some deployments may carry a `market_price` column on ingredients; if it
    // exists we use it as the ingredient's own market price for savings math.
    try {
      const probe = await supabaseAdmin.from('ingredients').select('market_price').limit(1);
      if (!probe.error) {
        ingredientQuery = supabaseAdmin
          .from('ingredients')
          .select('id, name, unit, price, category, is_archived, market_price')
          .eq('is_archived', false);
      }
    } catch (e) {
      // `market_price` column not present — fall back to `price`. Nothing to do.
    }

    if (search) {
      ingredientQuery = ingredientQuery.or(`name.ilike.%${search}%`);
    }
    if (category && category !== 'All') {
      ingredientQuery = ingredientQuery.eq('category', category);
    }

    const { data: ingredients, error: ingredientError } = await ingredientQuery;
    if (ingredientError) throw ingredientError;

    // ---- 2. Fetch all market price rows (latest recording is newest scraped_at) ----
    const sources = await getMarketSources();
    const { data: priceRows, error: priceError } = await supabaseAdmin
      .from('market_price')
      .select('*')
      .order('scraped_at', { ascending: false });

    if (priceError) throw priceError;

    // ---- 3. Pivot: most recent recording per (ingredient, source) ----
    const ingredientIds = new Set((ingredients || []).map((ing) => ing.id));
    const latestByKey = new Map();

    for (const row of priceRows || []) {
      if (!ingredientIds.has(row.ingredient_id)) continue;
      const key = `${row.ingredient_id}:${row.source}`;
      if (!latestByKey.has(key)) {
        latestByKey.set(key, row);
      }
    }

    // ---- 4. Build comparison rows (one column per market source) ----
    const rows = (ingredients || []).map((ingredient) => {
      const prices = {};
      const sourceIds = {};
      let lastUpdated = null;

      sources.forEach((s) => {
        const row = latestByKey.get(`${ingredient.id}:${s.key}`);
        prices[s.key] = row ? toNumber(row.price) : null;
        sourceIds[s.key] = row ? row.id : null;
        if (row && (!lastUpdated || new Date(row.scraped_at) > new Date(lastUpdated))) {
          lastUpdated = row.scraped_at;
        }
      });

      const present = sources.map((s) => prices[s.key]).filter((v) => v !== null);
      const lowest = present.length ? Math.min(...present) : null;
      const highest = present.length ? Math.max(...present) : null;

      // The ingredient's own current cost used for "Savings vs Your Price".
      const yourPrice =
        ingredient.market_price !== undefined && ingredient.market_price !== null
          ? toNumber(ingredient.market_price)
          : toNumber(ingredient.price);
      const savings = lowest !== null && yourPrice !== null ? Number((yourPrice - lowest).toFixed(2)) : null;

      return {
        ingredientId: ingredient.id,
        ingredient: ingredient.name,
        unit: ingredient.unit,
        category: ingredient.category,
        yourPrice,
        ...prices,
        sourceIds,
        lowest,
        highest,
        savings,
        lastUpdated
      };
    });

    // ---- 5. Source filter: only ingredients that have a price for that source ----
    let filtered = rows;
    if (source && sources.some((s) => s.key === source)) {
      filtered = rows.filter((r) => r[source] !== null);
    }

    // ---- 6. Summary over the FULL filtered set (independent of pagination) ----
    const summary = computeSummary(filtered, sources);

    // ---- 7. Sort (nulls always pushed to the end) ----
    const sortableFields = ['ingredient', 'category', 'lowest', 'highest', 'savings', 'lastUpdated', ...sources.map((s) => s.key)];
    const safeSortBy = sortableFields.includes(sortBy) ? sortBy : 'ingredient';
    const ascending = sortOrder !== 'desc';

    filtered.sort((a, b) => {
      const av = a[safeSortBy];
      const bv = b[safeSortBy];
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (typeof av === 'string') {
        return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return ascending ? av - bv : bv - av;
    });

    // ---- 8. Paginate ----
    const total = filtered.length;
    const start = (pageNumber - 1) * pageLimit;
    const paginated = filtered.slice(start, start + pageLimit);

    res.json({
      success: true,
      data: paginated,
      total,
      page: pageNumber,
      limit: pageLimit,
      totalPages: Math.ceil(total / pageLimit),
      summary
    });
  } catch (error) {
    console.error('Error fetching market price comparison:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// GET /api/market-prices/ingredient/:ingredientId
const getIngredientPrices = async (req, res) => {
  try {
    const { ingredientId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('market_price')
      .select('*')
      .eq('ingredient_id', ingredientId)
      .order('scraped_at', { ascending: false });

    if (error) throw error;

    // One row per source — the most recent recording per source wins.
    const seen = new Set();
    const result = [];
    for (const row of data || []) {
      if (!seen.has(row.source)) {
        seen.add(row.source);
        result.push(row);
      }
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching ingredient prices:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// GET /api/market-prices/history/:ingredientId
const getPriceHistory = async (req, res) => {
  try {
    const { ingredientId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('market_price')
      .select('*')
      .eq('ingredient_id', ingredientId)
      .order('scraped_at', { ascending: true });

    if (error) throw error;

    res.json({ success: true, data: data || [] });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// POST /api/market-prices — one manual entry
const createManualPrice = async (req, res) => {
  try {
    const { ingredientId, source, price, unit, scraped_at } = req.body;

    if (!ingredientId) throw validationError('ingredientId is required');
    const sources = await getMarketSources();
    if (!sources.some((s) => s.key === source)) {
      throw validationError(`source must be one of: ${sources.map((s) => s.key).join(', ')}`);
    }
    if (!isValidNonNegativeDecimal(price)) {
      throw validationError('price must be a valid decimal >= 0');
    }
    const normalizedUnit = normalizeUnit(unit);
    if (!normalizedUnit) {
      throw validationError(`unit must be one of: ${ALLOWED_UNITS.join(', ')}`);
    }

    const ingredient = await getIngredient(ingredientId);
    if (!ingredient) {
      return res.status(404).json({ success: false, error: 'Ingredient not found' });
    }

    // Manual-only: every row is flagged as a human entry with a recorded timestamp.
    const { data, error } = await supabaseAdmin
      .from('market_price')
      .insert([{
        ingredient_id: ingredientId,
        source,
        price: Number(price),
        unit: normalizedUnit,
        is_manual_entry: true,
        scraped_at: normalizeScrapedAt(scraped_at)
      }])
      .select()
      .single();

    if (error) throw error;

    await logAction(
      'price_recorded',
      `Recorded ${labelForSource(sources, source)} price ₱${Number(price)} for ${ingredient.name || `ingredient #${ingredientId}`} (${normalizedUnit})`,
      actorOf(req)
    );

    createNotification({
      userId: req.user?.user_id,
      type: 'success',
      title: `Price recorded for ${ingredient.name || `ingredient #${ingredientId}`}`,
      message: `${labelForSource(sources, source)} — ₱${Number(price)} per ${normalizedUnit}`,
      link: '/inventory-management',
      metadata: { kind: 'market_price', action: 'recorded', ingredient_id: ingredientId, source },
    });

    res.json({ success: true, data, message: 'Price recorded successfully' });
  } catch (error) {
    console.error('Error creating manual price:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// PUT /api/market-prices/:id
const updateManualPrice = async (req, res) => {
  try {
    const { id } = req.params;
    const { source, price, unit, scraped_at } = req.body;

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('market_price')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Price entry not found' });
    }

    const updateData = { is_manual_entry: true };
    const sources = await getMarketSources();

    if (source !== undefined) {
      if (!sources.some((s) => s.key === source)) {
        throw validationError(`source must be one of: ${sources.map((s) => s.key).join(', ')}`);
      }
      updateData.source = source;
    }
    if (price !== undefined) {
      if (!isValidNonNegativeDecimal(price)) {
        throw validationError('price must be a valid decimal >= 0');
      }
      updateData.price = Number(price);
    }
    if (unit !== undefined) {
      const normalizedUnit = normalizeUnit(unit);
      if (!normalizedUnit) {
        throw validationError(`unit must be one of: ${ALLOWED_UNITS.join(', ')}`);
      }
      updateData.unit = normalizedUnit;
    }
    if (scraped_at !== undefined) {
      updateData.scraped_at = normalizeScrapedAt(scraped_at);
    }

    const { data, error } = await supabaseAdmin
      .from('market_price')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    let ingredientName = `ingredient #${existing.ingredient_id}`;
    if (existing.ingredient_id) {
      const ing = await getIngredient(existing.ingredient_id);
      if (ing && ing.name) ingredientName = ing.name;
    }

    await logAction(
      'price_updated',
      `Updated price entry #${id} for ${ingredientName} — ${labelForSource(sources, updateData.source ?? existing.source)} ₱${updateData.price ?? existing.price} (${updateData.unit || existing.unit})`,
      actorOf(req)
    );

    createNotification({
      userId: req.user?.user_id,
      type: 'success',
      title: `Price updated for ${ingredientName}`,
      message: `${labelForSource(sources, updateData.source ?? existing.source)} — ₱${updateData.price ?? existing.price} per ${updateData.unit || existing.unit}`,
      link: '/inventory-management',
      metadata: { kind: 'market_price', action: 'updated', ingredient_id: existing.ingredient_id, price_id: id },
    });

    res.json({ success: true, data, message: 'Price entry updated successfully' });
  } catch (error) {
    console.error('Error updating price entry:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// DELETE /api/market-prices/:id
const deleteManualPrice = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('market_price')
      .select('id, ingredient_id, source, price')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Price entry not found' });
    }

    const { error } = await supabaseAdmin
      .from('market_price')
      .delete()
      .eq('id', id);

    if (error) throw error;

    let ingredientName = `ingredient #${existing.ingredient_id}`;
    if (existing.ingredient_id) {
      const ing = await getIngredient(existing.ingredient_id);
      if (ing && ing.name) ingredientName = ing.name;
    }
    const sources = await getMarketSources();

    await logAction(
      'price_deleted',
      `Deleted ${labelForSource(sources, existing.source)} price ₱${existing.price} for ${ingredientName}`,
      actorOf(req)
    );

    res.json({ success: true, message: 'Price entry deleted successfully' });
  } catch (error) {
    console.error('Error deleting price entry:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// POST /api/market-prices/bulk-upsert
// Saves manual prices for one ingredient across multiple sources (used by the
// edit modal AND the inline table editor). Every save APPENDS a new history
// row (one per source) so the price trend chart accumulates points over time.
// The comparison view already pivots to the most recent recording per
// (ingredient_id, source), so the table never shows duplicates. All rows are
// flagged as manual entries.
const bulkUpsertPrices = async (req, res) => {
  try {
    const { ingredientId, entries } = req.body;

    if (!ingredientId) throw validationError('ingredientId is required');

    const ingredient = await getIngredient(ingredientId);
    if (!ingredient) {
      return res.status(404).json({ success: false, error: 'Ingredient not found' });
    }

    if (!Array.isArray(entries)) throw validationError('entries must be an array');

    const sources = await getMarketSources();
    const validEntries = [];
    for (const entry of entries || []) {
      const { source, price, unit } = entry || {};

      // Only non-empty prices are saved (the modal never sends blank rows).
      if (price === undefined || price === null || price === '') continue;

      if (!sources.some((s) => s.key === source)) {
        throw validationError(`source must be one of: ${sources.map((s) => s.key).join(', ')}`);
      }
      if (!isValidNonNegativeDecimal(price)) {
        throw validationError('price must be a valid decimal >= 0');
      }
      const normalizedUnit = normalizeUnit(unit);
      if (!normalizedUnit) {
        throw validationError(`unit must be one of: ${ALLOWED_UNITS.join(', ')}`);
      }

      validEntries.push({
        ingredient_id: ingredientId,
        source,
        price: Number(price),
        unit: normalizedUnit,
        is_manual_entry: true,
        scraped_at: normalizeScrapedAt(entry.scraped_at)
      });
    }

    if (!validEntries.length) {
      return res.json({ success: true, data: [], message: 'No price entries to save' });
    }

    // Append each entry as a new history row. The comparison/timeline views
    // pick the most recent price per (ingredient, source), so older rows are
    // never shown in the table — they only power the price trend chart.
    const saved = [];
    for (const entry of validEntries) {
      const { data, error } = await supabaseAdmin
        .from('market_price')
        .insert([entry])
        .select()
        .single();
      if (error) throw error;
      saved.push(data);
    }

    const ingredientName = ingredient?.name || `ingredient #${ingredientId}`;
    const details = validEntries
      .map((e) => `${labelForSource(sources, e.source)} ₱${e.price}`)
      .join(', ');

    await logAction(
      'price_updated',
      `Updated ${validEntries.length} market price(s) for ${ingredientName} (${ingredient?.unit || 'unit'}): ${details}`,
      actorOf(req)
    );

    createNotification({
      userId: req.user?.user_id,
      type: 'success',
      title: `Market prices updated for ${ingredientName}`,
      message: `Updated ${validEntries.length} price(s) (${ingredient?.unit || 'unit'}): ${details}`,
      link: '/inventory-management',
      metadata: { kind: 'market_price', action: 'bulk_updated', ingredient_id: ingredientId },
    });

    res.json({
      success: true,
      data: saved || [],
      message: `${saved.length} price record(s) saved successfully`
    });
  } catch (error) {
    console.error('Error in market price bulk upsert:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// GET /api/market-prices/sources
const getSourcesList = async (req, res) => {
  try {
    const sources = await getMarketSources({ force: true });
    res.json({ success: true, data: sources });
  } catch (error) {
    console.error('Error fetching market sources:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// POST /api/market-prices/sources — add a new store/market source
const createSource = async (req, res) => {
  try {
    const { label, tooltip } = req.body;
    if (!label || !String(label).trim()) throw validationError('Source name is required');

    const cleanLabel = String(label).trim();
    if (cleanLabel.length > 40) {
      throw validationError('Source name must be 40 characters or less');
    }

    const key = cleanLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!key) throw validationError('Source name must contain letters or numbers');

    const sources = await getMarketSources({ force: true });
    if (sources.some((s) => s.key === key)) {
      return res.status(409).json({ success: false, error: `A market source named "${cleanLabel}" already exists` });
    }

    // Place the new source after the current last one.
    const { data: maxRow, error: maxError } = await supabaseAdmin
      .from('market_sources')
      .select('display_order')
      .order('display_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;

    const { data, error } = await supabaseAdmin
      .from('market_sources')
      .insert([{
        key,
        label: cleanLabel,
        tooltip: tooltip !== undefined && tooltip !== null ? String(tooltip).trim() || null : null,
        display_order: (maxRow?.display_order ?? DEFAULT_SOURCES.length) + 1
      }])
      .select()
      .single();

    if (error) throw error;

    cachedSources = null;
    await logAction('source_created', `Added new market source "${cleanLabel}"`, actorOf(req));

    res.json({ success: true, data, message: `Added market source "${cleanLabel}"` });
  } catch (error) {
    console.error('Error creating market source:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

// DELETE /api/market-prices/sources/:id
const deleteSource = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('market_sources')
      .select('id, key, label')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Source not found' });
    }

    const { error } = await supabaseAdmin
      .from('market_sources')
      .delete()
      .eq('id', id);

    if (error) throw error;

    cachedSources = null;
    await logAction('source_deleted', `Removed market source "${existing.label}"`, actorOf(req));

    res.json({ success: true, message: `Removed market source "${existing.label}"` });
  } catch (error) {
    console.error('Error deleting market source:', error);
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getComparison,
  getIngredientPrices,
  getPriceHistory,
  createManualPrice,
  updateManualPrice,
  deleteManualPrice,
  bulkUpsertPrices,
  getSourcesList,
  createSource,
  deleteSource
};