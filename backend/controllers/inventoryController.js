// controllers/inventoryController.js
const { supabaseAdmin } = require('../config/supabase');
const { logAction } = require('../services/auditService');
const analyticsService = require('../services/analyticsService');
const { classifyStock } = require('../services/stockAlertService');
const { queueStockRefresh } = require('../services/notificationService');
const { parseRecipeQuantity, deriveUnitPrice, isMissingColumnError } = require('../utils/recipeUnits');

const actorOf = (req) => req.user?.name || req.user?.email || null;

// Purchase pack ("150 g per sachet for ₱200") -> { pack_qty, pack_unit, pack_price }.
// Anything missing or invalid is stored as NULL so the ingredient simply has
// no pack recorded and keeps its manually typed unit cost.
const readPackFields = (body = {}) => {
  const rawQty = body.pack_qty;
  const rawPrice = body.pack_price;
  const qty = rawQty === '' || rawQty === null || rawQty === undefined ? NaN : parseRecipeQuantity(rawQty);
  const price = rawPrice === '' || rawPrice === null || rawPrice === undefined ? NaN : Number(rawPrice);
  const unitRaw = body.pack_unit ? String(body.pack_unit).trim() : '';
  const validQty = Number.isFinite(qty) && qty > 0;
  return {
    pack_qty: validQty ? qty : null,
    pack_unit: validQty && unitRaw ? unitRaw : null,
    pack_price: Number.isFinite(price) && price > 0 ? price : null,
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
    if (derived != null) return derived;
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
      avg_market_price: avgMap[item.id] !== undefined ? avgMap[item.id] : null
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

    res.json({ success: true, data });
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

    const pack = readPackFields(req.body);

    if (!name || !category || quantity === undefined || (price === undefined && !(pack.pack_qty && pack.pack_price && pack.pack_unit))) {
      return res.status(400).json({
        success: false,
        error: 'Name, category, quantity, and price are required'
      });
    }

    const parsedQuantity = parseRecipeQuantity(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be a valid number greater than or equal to 0'
      });
    }

    // Get user ID directly from req.user.id
    const userId = getUserIdFromAuth(req);
    console.log('👤 User ID:', userId);

    const parsedMinStock = parseRecipeQuantity(min_stock);
    const parsedGramsPerCup = parseFloat(req.body.grams_per_cup);
    const gramsPerCup = Number.isFinite(parsedGramsPerCup) && parsedGramsPerCup > 0 ? parsedGramsPerCup : null;
    const stockUnit = unit || 'pcs';
    const insertData = {
      name: name.trim(),
      category: category.trim(),
      unit: stockUnit,
      quantity: parsedQuantity,
      price: resolveUnitPrice({
        pack,
        stockUnit,
        gramsPerCup,
        ingredientName: name.trim(),
        fallbackPrice: parseFloat(price),
      }),
      min_stock: Number.isFinite(parsedMinStock) ? (parsedMinStock || 0) : 0,
      pack_qty: pack.pack_qty,
      pack_unit: pack.pack_unit,
      pack_price: pack.pack_price,
      created_by: userId,
      updated_by: userId
    };

    if (req.body.grams_per_cup !== undefined && req.body.grams_per_cup !== null) {
      const g = parseFloat(req.body.grams_per_cup);
      insertData.grams_per_cup = Number.isFinite(g) && g > 0 ? g : null;
    }

    console.log('📦 Insert data:', insertData);

    let insertResult = await supabaseAdmin
      .from('ingredients')
      .insert([insertData])
      .select()
      .single();

    // Migration 012 not applied yet (pack columns missing): save without them.
    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      insertResult = await supabaseAdmin
        .from('ingredients')
        .insert([stripPackColumns(insertData)])
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
        quantity: parsedQuantity,
        previous_quantity: 0,
        new_quantity: parsedQuantity,
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
      const parsedQty = parseRecipeQuantity(quantity);
      if (Number.isFinite(parsedQty) && parsedQty >= 0) updateData.quantity = parsedQty;
    }
    if (price !== undefined && price !== null) updateData.price = parseFloat(price);
    if (min_stock !== undefined && min_stock !== null) {
      const parsedMin = parseRecipeQuantity(min_stock);
      updateData.min_stock = Number.isFinite(parsedMin) ? (parsedMin || 0) : 0;
    }
    if (req.body.grams_per_cup !== undefined) {
      const g = parseFloat(req.body.grams_per_cup);
      updateData.grams_per_cup = Number.isFinite(g) && g > 0 ? g : null;
    }

    // The pack is only touched when the client actually sent it, so older
    // callers (and the restock/archive paths) never wipe it by accident.
    const packSent = req.body.pack_qty !== undefined
      || req.body.pack_unit !== undefined
      || req.body.pack_price !== undefined;
    const pack = readPackFields(req.body);
    if (packSent) {
      updateData.pack_qty = pack.pack_qty;
      updateData.pack_unit = pack.pack_unit;
      updateData.pack_price = pack.pack_price;
    }

    // Re-derive the unit cost from the pack when one is set (see
    // resolveUnitPrice); otherwise keep the price from the request.
    const effective = {
      unit: updateData.unit !== undefined ? updateData.unit : currentItem.unit,
      name: updateData.name !== undefined ? updateData.name : currentItem.name,
      gramsPerCup: updateData.grams_per_cup !== undefined ? updateData.grams_per_cup : currentItem.grams_per_cup,
      pack_qty: packSent ? updateData.pack_qty : currentItem.pack_qty,
      pack_unit: packSent ? updateData.pack_unit : currentItem.pack_unit,
      pack_price: packSent ? updateData.pack_price : currentItem.pack_price,
    };
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

    // Migration 012 not applied yet (pack columns missing): save the rest.
    if (updateResult.error && isMissingColumnError(updateResult.error) && packSent) {
      updateResult = await supabaseAdmin
        .from('ingredients')
        .update(stripPackColumns(updateData))
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
    const previousQuantity = Number(currentItem.quantity) || 0;
    const quantityWritten = Object.prototype.hasOwnProperty.call(updateData, 'quantity');
    if (quantityWritten && updateData.quantity !== previousQuantity) {
      await supabaseAdmin
        .from('inventory_transactions')
        .insert([{
          ingredient_id: id,
          transaction_type: 'adjustment',
          quantity: updateData.quantity - previousQuantity,
          previous_quantity: previousQuantity,
          new_quantity: updateData.quantity,
          reason: 'Stock adjustment',
          notes: 'Updated via edit',
          created_by: userId
        }]);
    }

    console.log('✅ Item updated successfully:', data.id);

    await logAction(
      'item_updated',
      `Updated ingredient "${currentItem.name || data.name}"`,
      actorOf(req)
    );

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
        is_archived: !currentItem.is_archived,
        updated_by: userId
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logAction(
      'item_archived',
      `${currentItem.is_archived ? 'Unarchived' : 'Archived'} ingredient "${currentItem.name}"`,
      actorOf(req)
    );

    console.log('✅ Item archived successfully:', id);
    // Archived ingredients have no alerts (the refresh retires them); this
    // endpoint also un-archives. Not awaited, never throws.
    queueStockRefresh('archive');
    res.json({ 
      success: true, 
      data, 
      message: currentItem.is_archived ? 'Item unarchived successfully' : 'Item archived successfully' 
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
      `Restored ingredient "${currentItem?.name || data?.name || id}"`,
      actorOf(req)
    );

    console.log('✅ Item restored successfully:', id);
    // A restored ingredient that is low alerts again. Not awaited, never throws.
    queueStockRefresh('restore');
    res.json({
      success: true,
      data,
      message: 'Item restored successfully'
    });
  } catch (error) {
    console.error('Error restoring item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Restock inventory item
const restockInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, reason, notes } = req.body;

    console.log('📦 Restocking inventory item:', { id, quantity });

    const restockQuantity = parseRecipeQuantity(quantity);
    if (!Number.isFinite(restockQuantity) || restockQuantity <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid quantity is required'
      });
    }

    const { data: currentItem, error: fetchError } = await supabaseAdmin
      .from('ingredients')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const userId = getUserIdFromAuth(req);
    console.log('👤 User ID:', userId);
    
    const newQuantity = currentItem.quantity + restockQuantity;

    const { data, error } = await supabaseAdmin
      .from('ingredients')
      .update({
        quantity: newQuantity,
        updated_by: userId
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await supabaseAdmin
      .from('inventory_transactions')
      .insert([{
        ingredient_id: id,
        transaction_type: 'restock',
        quantity: restockQuantity,
        previous_quantity: currentItem.quantity,
        new_quantity: newQuantity,
        reason: reason || 'Restock',
        notes: notes || null,
        created_by: userId
      }]);

    await logAction(
      'item_restocked',
      `Restocked ingredient "${currentItem.name}" by ${restockQuantity} ${currentItem.unit || ''}`,
      actorOf(req)
    );

    console.log('✅ Item restocked successfully:', { id, newQuantity });
    // A delivery can clear alerts. Not awaited and never throws.
    queueStockRefresh('restock');
    res.json({
      success: true,
      data,
      message: `Added ${quantity} units to ${currentItem.name}`
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

module.exports = {
  getInventoryItems,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  archiveInventoryItem,
  restoreInventoryItem,
  restockInventoryItem,
  getItemTransactions
};