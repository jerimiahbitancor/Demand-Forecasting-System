// controllers/inventoryController.js
const { supabaseAdmin } = require('../config/supabase');
const { logAction } = require('../services/auditService');
const analyticsService = require('../services/analyticsService');
const { classifyStock } = require('../services/stockAlertService');
const { queueStockRefresh } = require('../services/notificationService');
const {
  parseRecipeQuantityDecimal,
  deriveUnitPrice,
  isMissingColumnError,
  inventoryUnitMetadata,
  Decimal,
  UnitConversionError,
} = require('../utils/recipeUnits');

const actorOf = (req) => req.user?.name || req.user?.email || null;

// A stock amount as text, without trailing zeros: 30.000000 -> "30",
// 0.500000 -> "0.5". The value itself is never rounded, only its text form
// is cleaned up, so "30.000000" never reaches the owner.
const formatStockAmount = (value) => {
  const n = value instanceof Decimal ? value : new Decimal(String(value ?? 0));
  if (!n.isFinite()) return '0';
  return n.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
};

// The sales shortfalls of one ingredient that are still waiting to be
// covered, oldest first. A restock must never be spent on them: the stock
// that was received is stock on hand. They are hidden from the stock
// function for the duration of the restock and put back unchanged
// afterwards, so the unmet demand stays on record.
const readPendingShortfalls = async (ingredientId) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('inventory_shortfall_balances')
      .select('sale_transaction_id, remaining_quantity')
      .eq('ingredient_id', ingredientId)
      .gt('remaining_quantity', 0)
      .order('created_at', { ascending: true })
      .order('sale_transaction_id', { ascending: true });
    if (error) return [];
    return (data || []).map((row) => ({
      sale_transaction_id: row.sale_transaction_id,
      remaining_quantity: String(row.remaining_quantity),
    }));
  } catch (error) {
    // The shortfall ledger is optional: a database without it still gets a
    // working restock.
    console.warn('Could not read the pending shortfalls:', error.message);
    return [];
  }
};

// The open sales shortfalls of the given ingredients: how much demand is
// still waiting to be covered, and how many sales it came from. A sale that
// could not be fully served leaves a short behind; it stays open until a
// stock count (an "adjustment") records what is really on hand.
const readOpenShortfalls = async (ingredientIds) => {
  const totals = new Map();
  const ids = (ingredientIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  if (!ids.length) return totals;

  try {
    const { data, error } = await supabaseAdmin
      .from('inventory_shortfall_balances')
      .select('ingredient_id, remaining_quantity')
      .in('ingredient_id', ids)
      .gt('remaining_quantity', 0);
    if (error) {
      console.warn('Could not read the open shortfalls:', error.message);
      return totals;
    }
    for (const row of data || []) {
      const remaining = Number(row.remaining_quantity) || 0;
      if (remaining <= 0) continue;
      const entry = totals.get(row.ingredient_id) || { total: 0, sales: 0 };
      entry.total += remaining;
      entry.sales += 1;
      totals.set(row.ingredient_id, entry);
    }
  } catch (error) {
    // The shortfall ledger is optional: a database without it simply has no
    // open shorts.
    console.warn('Could not read the open shortfalls:', error.message);
  }
  return totals;
};

const writeShortfallRemaining = async (rows) => {
  for (const row of rows) {
    const { error } = await supabaseAdmin
      .from('inventory_shortfall_balances')
      .update({ remaining_quantity: row.remaining_quantity })
      .eq('sale_transaction_id', row.sale_transaction_id);
    if (error) throw error;
  }
};

// The movement row the stock function just wrote gets its note here, so the
// numbers in the stock history never carry the raw decimals of the database
// ("30.000000") whichever version of the stock function is installed.
const writeRestockNote = async (ingredientId, received, { quantity, newQuantity, note }) => {
  const { data: rows, error } = await supabaseAdmin
    .from('inventory_transactions')
    .select('id')
    .eq('ingredient_id', ingredientId)
    .eq('transaction_type', 'restock')
    .eq('received_quantity', received.toString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !rows || rows.length === 0) return;
  const values = { notes: note };
  if (quantity) values.quantity = quantity;
  if (newQuantity) values.new_quantity = newQuantity;
  await supabaseAdmin
    .from('inventory_transactions')
    .update(values)
    .eq('id', rows[0].id);
};

// Purchase pack ("150 g per sachet for ₱200") -> { pack_qty, pack_unit, pack_price }.
// Anything missing or invalid is stored as NULL so the ingredient simply has
// no pack recorded and keeps its manually typed unit cost.
const readPackFields = (body = {}, stockUnit = '') => {
  const rawQty = body.pack_qty;
  const rawPrice = body.pack_price;
  const qty = rawQty === '' || rawQty === null || rawQty === undefined ? null : parseRecipeQuantityDecimal(rawQty);
  const price = rawPrice === '' || rawPrice === null || rawPrice === undefined ? null : parseRecipeQuantityDecimal(rawPrice);
  const unitRaw = body.pack_unit ? String(body.pack_unit).trim() : String(stockUnit || '').trim();
  const validQty = qty?.isFinite() && qty.gt(0);
  return {
    pack_qty: validQty ? qty.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString() : null,
    pack_unit: validQty && unitRaw ? unitRaw : null,
    pack_price: price?.isFinite() && price.gt(0)
      ? price.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
      : null,
  };
};

// The unit cost saved on the ingredient is always the pack's price spread over
// the amount it holds, expressed in the stock unit (150 g for ₱200 on a
// kg-stocked ingredient -> ₱1333.33/kg) so COGS, demand and the grocery list
// keep reading a plain price-per-stock-unit. Without a usable pack the price
// the owner typed is kept as-is.
const resolveUnitPrice = ({ pack, stockUnit, gramsPerCup, ingredientName, fallbackPrice }) => {
  if (pack.pack_qty && pack.pack_price && pack.pack_unit) {
    const derived = deriveUnitPrice({
      packQty: pack.pack_qty,
      packUnit: pack.pack_unit,
      packPrice: pack.pack_price,
      stockUnit,
      gramsPerCup,
      ingredientName,
    });
    if (derived != null) return derived.toString();
  }
  return fallbackPrice;
};

// Strip the pack columns and retry: migration 012 not applied yet.
const stripPackColumns = (row) => {
  const copy = { ...row };
  delete copy.pack_qty;
  delete copy.pack_unit;
  delete copy.pack_price;
  return copy;
};

const stripCanonicalUnitColumns = (row) => {
  const copy = { ...row };
  delete copy.base_unit;
  delete copy.unit_family;
  delete copy.stock_scale;
  delete copy.allow_fractional;
  delete copy.pack_size;
  delete copy.density_g_per_ml;
  return copy;
};

const stripCanonicalColumns = (row) => stripPackColumns(stripCanonicalUnitColumns(row));

// Helper function to get user ID - SIMPLIFIED
// Use req.user.id directly since it already contains the numeric user ID
const getUserIdFromAuth = (req) => {
  // The user object from req.user has the numeric id (727)
  // which matches your user table's id column
  const userId = req.user?.id;
  
  if (!userId) {
    console.error('❌ No user id found in request');
    throw new Error('User not authenticated');
  }
  
  console.log('✅ Using user id directly:', userId);
  return userId;
};

// Get all inventory items with user info
const getInventoryItems = async (req, res) => {
  try {
    const {
      search,
      category,
      sortBy = 'created_at',
      sortOrder = 'desc',
      page = 1,
      limit = 5,
      showArchived = false,
      date,
      dateStart,
      dateEnd,
      archived,
      status
    } = req.query;

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageLimit = Math.max(parseInt(limit, 10) || 10, 1);
    const includeArchived = archived === 'true' || showArchived === 'true';

    console.log('📦 Fetching inventory items...');

    // Get all items for summary stats (without pagination)
    let summaryQuery = supabaseAdmin
      .from('ingredients')
      .select('id, quantity, price, min_stock, category, is_archived');

    if (includeArchived) {
      summaryQuery = summaryQuery.eq('is_archived', true);
    } else {
      summaryQuery = summaryQuery.eq('is_archived', false);
    }

    if (search) {
      summaryQuery = summaryQuery.or(`name.ilike.%${search}%,category.ilike.%${search}%`);
    }

    if (category && category !== 'All') {
      summaryQuery = summaryQuery.eq('category', category);
    }

    if (date || (dateStart && dateEnd)) {
      const startDate = dateStart ? new Date(dateStart) : new Date(`${date}T00:00:00.000Z`);
      const endDate = dateEnd ? new Date(dateEnd) : new Date(startDate);
      if (!dateEnd) endDate.setUTCDate(endDate.getUTCDate() + 1);
      if (!Number.isNaN(startDate.getTime())) {
        summaryQuery = summaryQuery
          .gte('updated_at', startDate.toISOString())
          .lt('updated_at', endDate.toISOString());
      }
    }

    const { data: summaryData, error: summaryError } = await summaryQuery;
    if (summaryError) throw summaryError;

    // ---- Forecast-based stock status ----
    // The settled spec classifies stock by comparing current quantity
    // against the day's FORECASTED demand (Critical <50%, Low <100%,
    // Normal 100-200%, Excess >200%), not against the static min_stock
    // reorder point. min_stock thresholds made nearly every well-stocked
    // ingredient read as "Excess Stock" (e.g. qty 25, min_stock 5:
    // 25 >= 5*3 -> Excess). Compute the same forecasted need the
    // Analytics > Ingredient Demand view uses, and derive status from it.
    const dailyNeeds = await analyticsService.getIngredientDailyNeeds();

    // One rule shared with the bell's stock alerts and the restock email
    // (services/stockAlertService.js classifyStock): out of stock is always
    // "Critical Stock" on this page, whether or not a forecast exists.
    const statusFor = (item) => classifyStock({
      quantity: item.quantity,
      isArchived: item.is_archived,
      need: dailyNeeds.get(item.id) || 0,
    }).pageLabel;

    const totalItems = summaryData?.length || 0;
    const totalStockValue = (summaryData || []).reduce((sum, item) => {
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      return sum + (quantity * price);
    }, 0);
    const lowStockAlerts = (summaryData || []).filter((item) => {
      const s = statusFor(item);
      return s === 'Low Stock' || s === 'Critical Stock';
    }).length;
    const outOfStockItems = (summaryData || []).filter((item) => (Number(item.quantity) || 0) === 0).length;
    const stockCounts = (summaryData || []).reduce((counts, item) => {
      const s = statusFor(item);
      if (s === 'Critical Stock') counts.criticalStock++;
      else if (s === 'Low Stock') counts.lowStock++;
      else if (s === 'Excess Stock') counts.excessStock++;
      else if (s === 'Normal Stock') counts.normalStock++;
      return counts;
    }, { excessStock: 0, normalStock: 0, lowStock: 0, criticalStock: 0 });

    // ---- Unmapped ingredients ----
    // Ingredients that exist in stock but appear in no product recipe. Counted
    // against the recipe map rather than dailyNeeds: an ingredient with a
    // recipe but no forecast row for today also reports 'No Forecast', and
    // treating that as unmapped would flag healthy ingredients. Archived rows
    // are excluded unless the caller asked for them, so the card agrees with
    // the "Active inventory items" framing of the Total Items card.
    const mappedIngredientIds = await analyticsService.getMappedIngredientIds();
    const unmappedIngredients = (summaryData || []).filter((item) => {
      if (item.is_archived) return false;
      return !mappedIngredientIds.has(item.id);
    }).length;

    // Main query with pagination
    let query = supabaseAdmin
      .from('ingredients')
      .select('*', { count: 'exact' });

    if (includeArchived) {
      query = query.eq('is_archived', true);
    } else {
      query = query.eq('is_archived', false);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,category.ilike.%${search}%`);
    }

    if (category && category !== 'All') {
      query = query.eq('category', category);
    }

    if (date || (dateStart && dateEnd)) {
      const startDate = dateStart ? new Date(dateStart) : new Date(`${date}T00:00:00.000Z`);
      const endDate = dateEnd ? new Date(dateEnd) : new Date(startDate);
      if (!dateEnd) endDate.setUTCDate(endDate.getUTCDate() + 1);
      if (!Number.isNaN(startDate.getTime())) {
        query = query
          .gte('updated_at', startDate.toISOString())
          .lt('updated_at', endDate.toISOString());
      }
    }

    const validSortFields = ['created_at', 'updated_at', 'name', 'category', 'quantity', 'price'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    // Status is derived from quantity and min_stock, so filter it after retrieval.
    if (!status || status === 'All') {
      const from = (pageNumber - 1) * pageLimit;
      const to = from + pageLimit - 1;
      query = query.range(from, to);
    }

    const { data: queriedData, error, count } = await query;

    if (error) throw error;

    const filteredData = status && status !== 'All'
      ? (queriedData || []).filter((item) => {
          const itemStatus = statusFor(item);
          return itemStatus === status;
        })
      : (queriedData || []);
    const from = (pageNumber - 1) * pageLimit;
    const paginatedData = status && status !== 'All'
      ? filteredData.slice(from, from + pageLimit)
      : filteredData;
    const total = status && status !== 'All' ? filteredData.length : (count || 0);

    // ---- Avg market price from the market_price table ----
    // For each ingredient on this page: take the latest recorded price per
    // source (robinsons/sm/puregold/wet_market/da_reference) and average them.
    // This gives staff a single "average store price" number per ingredient.
    const pageIds = (paginatedData || []).map((item) => item.id);
    const avgMap = {};

    if (pageIds.length) {
      const { data: marketRows, error: marketPriceError } = await supabaseAdmin
        .from('market_price')
        .select('ingredient_id, source, price, scraped_at')
        .in('ingredient_id', pageIds);

      if (marketPriceError) throw marketPriceError;

      const latestByKey = new Map();
      for (const row of (marketRows || [])) {
        const key = `${row.ingredient_id}:${row.source}`;
        const existing = latestByKey.get(key);
        if (!existing || new Date(row.scraped_at) > new Date(existing.scraped_at)) {
          latestByKey.set(key, row);
        }
      }

      const sums = {};
      const counts = {};
      latestByKey.forEach((row) => {
        sums[row.ingredient_id] = (sums[row.ingredient_id] || 0) + Number(row.price);
        counts[row.ingredient_id] = (counts[row.ingredient_id] || 0) + 1;
      });
      Object.keys(sums).forEach((ingId) => {
        avgMap[ingId] = counts[ingId] ? Number((sums[ingId] / counts[ingId]).toFixed(2)) : null;
      });
    }

    // ---- The sales shortfalls that are still open ----
    // A sale that could not be fully served leaves a short behind. It is not
    // paid off by a delivery (the delivery is stock on hand), so it is shown
    // next to the stock until a stock count clears it.
    const openShortfalls = await readOpenShortfalls(pageIds);
    // Which forecast the statuses above are measured against, for the
    // "As of Latest Forecast" note. Its own try/catch: a failure here must
    // never stop the table from loading.
    let forecastBasis = null;
    try {
      forecastBasis = await analyticsService.getForecastBasis();
    } catch (basisError) {
      console.warn('Could not load the forecast basis for Ingredient Management:', basisError.message);
    }

    const data = (paginatedData || []).map((item) => ({
      ...item,
      forecasted_need: dailyNeeds.get(item.id) || 0,
      stock_status: statusFor(item),
      avg_market_price: avgMap[item.id] !== undefined ? avgMap[item.id] : null,
      open_shortfall: openShortfalls.get(item.id)?.total || 0,
      open_shortfall_sales: openShortfalls.get(item.id)?.sales || 0
    }));

    res.json({
      success: true,
      data,
      total,
      page: pageNumber,
      limit: pageLimit,
      totalPages: Math.ceil(total / pageLimit),
      summary: {
        totalItems,
        totalStockValue,
        lowStockAlerts: stockCounts.lowStock,
        outOfStockItems,
        excessStock: stockCounts.excessStock,
        normalStock: stockCounts.normalStock,
        criticalStock: stockCounts.criticalStock,
        unmappedIngredients
      },
      forecastBasis
    });
  } catch (error) {
    console.error('❌ Error fetching inventory:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single inventory item
const getInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // The sales shortfalls that are still open for this ingredient.
    const openShortfalls = await readOpenShortfalls([Number(id)]);

    res.json({
      success: true,
      data: {
        ...data,
        open_shortfall: openShortfalls.get(Number(id))?.total || 0,
        open_shortfall_sales: openShortfalls.get(Number(id))?.sales || 0
      }
    });
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Create inventory item
const createInventoryItem = async (req, res) => {
  try {
    const {
      name,
      category,
      unit,
      quantity,
      price,
      min_stock,
    } = req.body;

    console.log('📝 Creating inventory item:', { name, category, quantity, price });

    const stockUnit = unit || 'pcs';
    const pack = readPackFields(req.body, stockUnit);

    if (!name || !category || quantity === undefined || (price === undefined && !(pack.pack_qty && pack.pack_price && pack.pack_unit))) {
      return res.status(400).json({
        success: false,
        error: 'Name, category, quantity, and price are required'
      });
    }

    const parsedQuantity = parseRecipeQuantityDecimal(quantity);
    if (!parsedQuantity?.isFinite() || parsedQuantity.lt(0)) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be a valid number greater than or equal to 0'
      });
    }

    // Get user ID directly from req.user.id
    const userId = getUserIdFromAuth(req);
    console.log('👤 User ID:', userId);

    const parsedMinStock = parseRecipeQuantityDecimal(min_stock);
    const parsedGramsPerCup = parseRecipeQuantityDecimal(req.body.grams_per_cup);
    const gramsPerCup = parsedGramsPerCup?.gt(0) ? parsedGramsPerCup.toString() : null;
    let canonicalFields;
    try {
      canonicalFields = inventoryUnitMetadata({
        unit: stockUnit,
        name: name.trim(),
        gramsPerCup,
        packQty: pack.pack_qty,
        packUnit: pack.pack_unit,
      });
    } catch (error) {
      if (!(error instanceof UnitConversionError)) throw error;
      return res.status(400).json({ success: false, error: error.message });
    }
    const insertData = {
      name: name.trim(),
      category: category.trim(),
      unit: stockUnit,
      quantity: parsedQuantity.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString(),
      price: resolveUnitPrice({
        pack,
        stockUnit,
        gramsPerCup,
        ingredientName: name.trim(),
        fallbackPrice: price,
      }),
      min_stock: parsedMinStock?.isFinite()
        ? parsedMinStock.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
        : '0',
      pack_qty: pack.pack_qty,
      pack_unit: pack.pack_unit,
      pack_price: pack.pack_price,
      ...canonicalFields,
      created_by: userId,
      updated_by: userId
    };

    insertData.grams_per_cup = gramsPerCup;

    console.log('📦 Insert data:', insertData);

    let insertResult = await supabaseAdmin
      .from('ingredients')
      .insert([insertData])
      .select()
      .single();

    // Older databases may not have the package and canonical-unit columns yet.
    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      insertResult = await supabaseAdmin
        .from('ingredients')
        .insert([stripCanonicalUnitColumns(insertData)])
        .select()
        .single();
    }
    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      insertResult = await supabaseAdmin
        .from('ingredients')
        .insert([stripCanonicalColumns(insertData)])
        .select()
        .single();
    }

    const { data, error } = insertResult;

    if (error) {
      console.error('❌ Error creating item:', error);
      throw error;
    }

    await supabaseAdmin
      .from('inventory_transactions')
      .insert([{
        ingredient_id: data.id,
        transaction_type: 'restock',
        quantity: parsedQuantity.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString(),
        previous_quantity: '0',
        new_quantity: parsedQuantity.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString(),
        reason: 'Initial stock',
        notes: 'Item created',
        created_by: userId
      }]);

    console.log('✅ Item created successfully:', data.id);

    await logAction(
      'item_created',
      `Added ingredient "${data.name}" (qty ${data.quantity}, ₱${data.price}/${data.unit})`,
      actorOf(req)
    );

    res.json({ success: true, data, message: 'Item added successfully' });
  } catch (error) {
    console.error('❌ Error creating item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update inventory item
const updateInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      category,
      unit,
      quantity,
      price,
      min_stock,
    } = req.body;

    console.log('📝 Updating inventory item:', { id, name, category, quantity, price });
    const { data: currentItem, error: fetchError } = await supabaseAdmin
      .from('ingredients')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      console.error('❌ Item not found:', id);
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Get user ID directly from req.user.id
    const userId = getUserIdFromAuth(req);
    console.log('👤 User ID:', userId);

    // Build update data - ONLY fields that exist in the table
    const updateData = {
      updated_by: userId
    };

    if (name !== undefined && name !== null) updateData.name = name.trim();
    if (category !== undefined && category !== null) updateData.category = category.trim();
    if (unit !== undefined && unit !== null) updateData.unit = unit;
    if (quantity !== undefined && quantity !== null) {
      const parsedQty = parseRecipeQuantityDecimal(quantity);
      if (!parsedQty?.isFinite() || parsedQty.lt(0)) {
        return res.status(400).json({ success: false, error: 'Quantity must be a valid number greater than or equal to 0' });
      }
      updateData.quantity = parsedQty.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
    }
    if (price !== undefined && price !== null) {
      const parsedPrice = parseRecipeQuantityDecimal(price);
      if (!parsedPrice?.isFinite() || parsedPrice.lt(0)) {
        return res.status(400).json({ success: false, error: 'Price must be a valid number greater than or equal to 0' });
      }
      updateData.price = parsedPrice.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
    }
    if (min_stock !== undefined && min_stock !== null) {
      const parsedMin = parseRecipeQuantityDecimal(min_stock);
      if (!parsedMin?.isFinite() || parsedMin.lt(0)) {
        return res.status(400).json({ success: false, error: 'Minimum stock must be a valid number greater than or equal to 0' });
      }
      updateData.min_stock = parsedMin.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
    }
    if (req.body.grams_per_cup !== undefined) {
      const g = parseRecipeQuantityDecimal(req.body.grams_per_cup);
      updateData.grams_per_cup = g?.gt(0)
        ? g.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
        : null;
    }

    // The pack is only touched when the client actually sent it, so older
    // callers (and the restock/archive paths) never wipe it by accident.
    const packSent = req.body.pack_qty !== undefined
      || req.body.pack_unit !== undefined
      || req.body.pack_price !== undefined;
    const nextStockUnit = updateData.unit !== undefined ? updateData.unit : currentItem.unit;
    const pack = readPackFields(req.body, nextStockUnit);
    if (packSent) {
      updateData.pack_qty = pack.pack_qty;
      updateData.pack_unit = pack.pack_unit;
      updateData.pack_price = pack.pack_price;
    }

    // Re-derive the unit cost from the pack when one is set (see
    // resolveUnitPrice); otherwise keep the price from the request.
    const effective = {
      unit: nextStockUnit,
      name: updateData.name !== undefined ? updateData.name : currentItem.name,
      gramsPerCup: updateData.grams_per_cup !== undefined ? updateData.grams_per_cup : currentItem.grams_per_cup,
      pack_qty: packSent ? updateData.pack_qty : currentItem.pack_qty,
      pack_unit: packSent ? updateData.pack_unit : currentItem.pack_unit,
      pack_price: packSent ? updateData.pack_price : currentItem.pack_price,
    };
    try {
      Object.assign(updateData, inventoryUnitMetadata({
        unit: effective.unit,
        name: effective.name,
        gramsPerCup: effective.gramsPerCup,
        packQty: effective.pack_qty,
        packUnit: effective.pack_unit,
      }));
    } catch (error) {
      if (!(error instanceof UnitConversionError)) throw error;
      return res.status(400).json({ success: false, error: error.message });
    }
    const resolvedPrice = resolveUnitPrice({
      pack: { pack_qty: effective.pack_qty, pack_unit: effective.pack_unit, pack_price: effective.pack_price },
      stockUnit: effective.unit,
      gramsPerCup: effective.gramsPerCup,
      ingredientName: effective.name,
      fallbackPrice: updateData.price,
    });
    if (resolvedPrice !== undefined) updateData.price = resolvedPrice;

    console.log('📦 Update data:', updateData);

    // Update item
    let updateResult = await supabaseAdmin
      .from('ingredients')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    // Older databases may not have the package and canonical-unit columns yet.
    if (updateResult.error && isMissingColumnError(updateResult.error)) {
      updateResult = await supabaseAdmin
        .from('ingredients')
        .update(stripCanonicalUnitColumns(updateData))
        .eq('id', id)
        .select()
        .single();
    }
    if (updateResult.error && isMissingColumnError(updateResult.error)) {
      updateResult = await supabaseAdmin
        .from('ingredients')
        .update(stripCanonicalColumns(updateData))
        .eq('id', id)
        .select()
        .single();
    }

    const { data, error } = updateResult;

    if (error) {
      console.error('❌ Error updating item:', error);
      throw error;
    }

    // Log an 'adjustment' only when the quantity was really written above
    // (valid, >= 0) AND differs from before. The latest adjustment is read
    // as the ingredient's last stock count, so a rejected or unchanged
    // value must not leave a row behind (it used to: e.g. quantity null or
    // -5 was not saved, yet an adjustment was logged).
    const previousQuantity = new Decimal(String(currentItem.quantity || '0'));
    const quantityWritten = Object.prototype.hasOwnProperty.call(updateData, 'quantity');
    const nextQuantity = quantityWritten ? new Decimal(updateData.quantity) : previousQuantity;
    if (quantityWritten && !nextQuantity.eq(previousQuantity)) {
      await supabaseAdmin
        .from('inventory_transactions')
        .insert([{
          ingredient_id: id,
          transaction_type: 'adjustment',
          quantity: nextQuantity.minus(previousQuantity).toString(),
          previous_quantity: previousQuantity.toString(),
          new_quantity: nextQuantity.toString(),
          reason: 'Stock adjustment',
          notes: 'Updated via edit',
          created_by: userId
        }]);
    }

    // The open shortfalls are read again: a stock count (an "adjustment")
    // clears the shortages that are older than the count, so the answer has
    // to be the one the database holds now.
    const openShortfalls = await readOpenShortfalls([Number(id)]);

    console.log('✅ Item updated successfully:', data.id);

    await logAction(
      'item_updated',
      `Updated ingredient "${currentItem.name || data.name}"`,
      actorOf(req)
    );

    res.json({
      success: true,
      data: {
        ...data,
        open_shortfall: openShortfalls.get(Number(id))?.total || 0,
        open_shortfall_sales: openShortfalls.get(Number(id))?.sales || 0
      },
      message: 'Item updated successfully'
    });
    // Stock, min_stock or unit may have changed: refresh the stock alerts.
    // Not awaited and never throws (see queueStockRefresh).
    queueStockRefresh('stock_edit');

    res.json({ success: true, data, message: 'Item updated successfully' });
  } catch (error) {
    console.error('❌ Error updating item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete inventory item
const deleteInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('🗑️ Deleting inventory item:', id);

    const { data: currentItem, error: fetchError } = await supabaseAdmin
      .from('ingredients')
      .select('name')
      .eq('id', id)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const { error } = await supabaseAdmin
      .from('ingredients')
      .delete()
      .eq('id', id);

    if (error) {
      // 23503 = FK violation: this ingredient is still referenced by a
      // recipe (product_ingredients) or a stock movement
      // (inventory_transactions), both ON DELETE RESTRICT. A hard delete
      // here would otherwise surface as an unhandled 500 — tell the
      // caller what actually happened and point at the existing archive
      // action instead of leaving orphaned references or a confusing error.
      if (error.code === '23503') {
        return res.status(409).json({
          success: false,
          error: 'Ingredient is in use',
          message: 'This ingredient is used in a recipe or has stock history and cannot be deleted. Archive it instead.'
        });
      }
      throw error;
    }

    await logAction(
      'item_deleted',
      `Deleted ingredient "${currentItem?.name || id}"`,
      actorOf(req)
    );

    console.log('✅ Item deleted successfully:', id);
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Archive inventory item
const archiveInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📦 Archiving inventory item:', id);

    const userId = getUserIdFromAuth(req);
    console.log('👤 User ID:', userId);

    const { data: currentItem, error: fetchError } = await supabaseAdmin
      .from('ingredients')
      .select('is_archived, name')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .update({
        is_archived: true,
        updated_by: userId
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAction(
      'item_archived',
      `Archived ingredient "${currentItem.name}"`,
      actorOf(req)
    );

    console.log('✅ Item archived successfully:', id);
    // Archived ingredients have no alerts (the refresh retires them); this
    // endpoint also un-archives. Not awaited, never throws.
    queueStockRefresh('archive');
    res.json({ 
      success: true, 
      data, 
      message: 'Item archived successfully' 
    });
  } catch (error) {
    console.error('Error archiving item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Restore an archived inventory item
const restoreInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('📦 Restoring inventory item:', id);

    const userId = getUserIdFromAuth(req);
    const { data: currentItem, error: fetchError } = await supabaseAdmin
      .from('ingredients')
      .select('is_archived, name')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .update({
        is_archived: false,
        updated_by: userId
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAction(
      'item_restored',
      `Unarchived ingredient "${currentItem.name}"`,
      actorOf(req)
    );

    console.log('✅ Item unarchived successfully:', id);
    console.log('✅ Item restored successfully:', id);
    // A restored ingredient that is low alerts again. Not awaited, never throws.
    queueStockRefresh('restore');
    res.json({
      success: true,
      data,
      message: 'Item unarchived successfully'
    });
  } catch (error) {
    console.error('Error unarchiving item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Restock inventory item
const restockInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, pack_count: rawPackCount, reason, notes } = req.body;

    console.log('📦 Restocking inventory item:', { id, quantity, pack_count: rawPackCount });

    const { data: currentItem, error: fetchError } = await supabaseAdmin
      .from('ingredients')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const packCount = rawPackCount === undefined || rawPackCount === null || rawPackCount === ''
      ? null
      : parseRecipeQuantityDecimal(rawPackCount);
    let restockQuantity;
    if (packCount !== null) {
      if (!packCount?.isFinite() || packCount.lte(0)) {
        return res.status(400).json({ success: false, error: 'Pack count must be greater than zero' });
      }
      let packSize = currentItem.pack_size;
      if (packSize == null && currentItem.pack_qty != null && currentItem.pack_unit) {
        try {
          packSize = inventoryUnitMetadata({
            unit: currentItem.unit,
            name: currentItem.name,
            gramsPerCup: currentItem.grams_per_cup,
            packQty: currentItem.pack_qty,
            packUnit: currentItem.pack_unit,
          }).pack_size;
        } catch (error) {
          if (!(error instanceof UnitConversionError)) throw error;
          return res.status(400).json({ success: false, error: error.message });
        }
      }
      const packSizeDecimal = packSize == null ? null : new Decimal(String(packSize));
      if (!packSizeDecimal?.isFinite() || packSizeDecimal.lte(0)) {
        return res.status(400).json({
          success: false,
          error: 'This ingredient does not have a valid pack size. Update its pack details before restocking by pack.',
        });
      }
      restockQuantity = packCount.mul(packSizeDecimal);
    } else {
      restockQuantity = parseRecipeQuantityDecimal(quantity);
      if (!restockQuantity?.isFinite() || restockQuantity.lte(0)) {
        return res.status(400).json({ success: false, error: 'Valid quantity is required' });
      }
    }
    restockQuantity = restockQuantity.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);

    const userId = getUserIdFromAuth(req);
    console.log('👤 User ID:', userId);
    
    const packNote = packCount === null
      ? null
      : `Received ${formatStockAmount(packCount)} pack${packCount.eq(1) ? '' : 's'}`
        + ` (${formatStockAmount(restockQuantity)} ${currentItem.unit || currentItem.base_unit || 'units'})`;
    const restockNotes = [
      notes || null,
      packNote,
    ].filter(Boolean).join(' · ') || null;

    // The incoming stock is stock on hand, so the pending sales shortfalls of
    // earlier uploads are hidden from the stock function while it runs and
    // put back unchanged afterwards.
    const pendingShortfalls = await readPendingShortfalls(Number(id));
    let restockResult = null;
    let restockError = null;
    try {
      try {
        await writeShortfallRemaining(
          pendingShortfalls.map((row) => ({ ...row, remaining_quantity: '0' }))
        );
      } catch (hideError) {
        // The delivery has to reach the stock balance either way, so the
        // correction further down takes over.
        console.warn('Could not hide the pending shortfalls:', hideError.message);
      }
      const rpc = await supabaseAdmin.rpc('restock_ingredient_stock', {
        p_ingredient_id: Number(id),
        p_quantity: restockQuantity.toString(),
        p_updated_by: userId,
        p_reason: reason || 'Restock',
        p_notes: restockNotes,
      });
      restockResult = rpc.data;
      restockError = rpc.error;
    } finally {
      try {
        await writeShortfallRemaining(pendingShortfalls);
      } catch (restoreError) {
        console.error('Could not restore the pending shortfalls:', restoreError.message);
      }
    }

    if (restockError) throw restockError;
    const restockRow = Array.isArray(restockResult) ? restockResult[0] : restockResult;
    if (!restockRow) {
      throw new Error(`Restock result was empty for ingredient ${id}`);
    }
    const newQuantity = new Decimal(String(restockRow.new_quantity));
    const receivedQuantity = new Decimal(String(restockRow.received_quantity));
    const addedQuantity = new Decimal(String(restockRow.added_quantity));
    const unitLabel = currentItem.unit || currentItem.base_unit || 'units';

    // The stock that was received has to land in the stock balance. A
    // database that still runs the older version of the stock function pays
    // earlier sales shortfalls with the incoming stock first, so the
    // delivery never reaches the balance; the withheld part is put back
    // here, so adding stock always moves the stock.
    const withheld = receivedQuantity.minus(addedQuantity);
    const finalQuantity = withheld.gt(0) ? newQuantity.plus(withheld) : newQuantity;
    if (withheld.gt(0)) {
      const { error: updateError } = await supabaseAdmin
        .from('ingredients')
        .update({ quantity: finalQuantity.toString(), updated_by: userId })
        .eq('id', id);
      if (updateError) throw updateError;
    }

    const openShortfalls = await readOpenShortfalls([Number(id)]);
    const data = {
      ...currentItem,
      quantity: finalQuantity.toString(),
      open_shortfall: openShortfalls.get(Number(id))?.total || 0,
      open_shortfall_sales: openShortfalls.get(Number(id))?.sales || 0
    };

    // The movement row is finished here, so the numbers in the stock history
    // never carry the raw decimals of the database ("30.000000").
    await writeRestockNote(
      Number(id),
      receivedQuantity,
      {
        quantity: receivedQuantity.toString(),
        newQuantity: finalQuantity.toString(),
        note: [
          notes || null,
          packNote,
          packNote
            ? `Stock is now ${formatStockAmount(finalQuantity)} ${unitLabel}.`
            : `Received ${formatStockAmount(receivedQuantity)} ${unitLabel}; `
              + `stock is now ${formatStockAmount(finalQuantity)} ${unitLabel}.`,
        ].filter(Boolean).join(' · '),
      }
    );

    await logAction(
      'item_restocked',
      `Restocked ingredient "${currentItem.name}" by ${formatStockAmount(receivedQuantity)} ${unitLabel}`,
      actorOf(req)
    );

    // New stock may clear a low-stock alert: refresh the bell, same as
    // edit/archive/restore do. Not awaited and never throws.
    queueStockRefresh('restock');

    console.log('✅ Item restocked successfully:', { id, newQuantity: finalQuantity.toString() });
    res.json({
      success: true,
      data,
      message: `Added ${formatStockAmount(receivedQuantity)} ${unitLabel} to ${currentItem.name}. `
        + `Stock is now ${formatStockAmount(finalQuantity)} ${unitLabel}.`
    });
  } catch (error) {
    console.error('Error restocking item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get transaction history
const getItemTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabaseAdmin
      .from('inventory_transactions')
      .select('*', { count: 'exact' })
      .eq('ingredient_id', id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const total = count || 0;
    res.json({
      success: true,
      data: data || [],
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// The recipes one ingredient is used in: the dishes that use it and how much
// of it one serving of that dish takes.
//
// Read only on purpose. The portion belongs to the dish, not to the
// ingredient, so it is edited in the Menu Builder. The ingredient window
// only shows where the portions already are, so nobody types a portion into
// the purchase pack fields.
const getIngredientRecipes = async (req, res) => {
  try {
    const { id } = req.params;

    let { data: lines, error } = await supabaseAdmin
      .from('product_ingredients')
      .select('product_id, quantity_per_serving, unit')
      .eq('ingredient_id', id);

    // product_ingredients.unit arrived with migration 008. A database that
    // has not run it yet still answers without the column.
    if (error && isMissingColumnError(error)) {
      const fallback = await supabaseAdmin
        .from('product_ingredients')
        .select('product_id, quantity_per_serving')
        .eq('ingredient_id', id);
      if (fallback.error) throw fallback.error;
      lines = fallback.data;
    } else if (error) {
      throw error;
    }

    if (!lines || lines.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const productIds = [...new Set(lines.map((line) => line.product_id).filter((value) => value != null))];
    let names = new Map();
    if (productIds.length > 0) {
      const { data: products, error: productError } = await supabaseAdmin
        .from('products')
        .select('id, name')
        .in('id', productIds);
      if (productError) throw productError;
      names = new Map((products || []).map((product) => [product.id, product.name]));
    }

    const data = lines.map((line) => ({
      product_id: line.product_id,
      product_name: names.get(line.product_id) || 'Unknown product',
      quantity_per_serving: line.quantity_per_serving,
      unit: line.unit || null,
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching ingredient recipes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getInventoryItems,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  archiveInventoryItem,
  restoreInventoryItem,
  restockInventoryItem,
  getItemTransactions,
  getIngredientRecipes
};