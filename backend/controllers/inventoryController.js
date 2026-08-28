// controllers/inventoryController.js
const { supabase } = require('../config/supabase');

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
    let summaryQuery = supabase
      .from('inventory_items')
      .select('quantity, price, min_stock, category, is_archived');

    if (includeArchived) {
      summaryQuery = summaryQuery.eq('is_archived', true);
    } else {
      summaryQuery = summaryQuery.eq('is_archived', false);
    }

    if (search) {
      summaryQuery = summaryQuery.or(`name.ilike.%${search}%,category.ilike.%${search}%,batch.ilike.%${search}%`);
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

    const totalItems = summaryData?.length || 0;
    const totalStockValue = (summaryData || []).reduce((sum, item) => {
      const quantity = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      return sum + (quantity * price);
    }, 0);
    const lowStockAlerts = (summaryData || []).filter((item) => {
      const quantity = Number(item.quantity) || 0;
      const minStock = Number(item.min_stock) || 0;
      return quantity <= minStock && quantity > 0;
    }).length;
    const outOfStockItems = (summaryData || []).filter((item) => (Number(item.quantity) || 0) === 0).length;
    const stockCounts = (summaryData || []).reduce((counts, item) => {
      const quantity = Number(item.quantity) || 0;
      const minStock = Number(item.min_stock) || 0;

      if (quantity === 0 || quantity <= minStock * 0.5) {
        counts.criticalStock++;
      } else if (quantity <= minStock) {
        counts.lowStock++;
      } else if (quantity >= minStock * 3) {
        counts.excessStock++;
      } else {
        counts.normalStock++;
      }

      return counts;
    }, { excessStock: 0, normalStock: 0, lowStock: 0, criticalStock: 0 });

    // Main query with pagination
    let query = supabase
      .from('inventory_items')
      .select('*', { count: 'exact' });

    if (includeArchived) {
      query = query.eq('is_archived', true);
    } else {
      query = query.eq('is_archived', false);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,category.ilike.%${search}%,batch.ilike.%${search}%`);
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

    const validSortFields = ['created_at', 'updated_at', 'name', 'category', 'quantity', 'price', 'batch'];
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
          const quantity = Number(item.quantity) || 0;
          const minStock = Number(item.min_stock) || 0;
          const itemStatus = quantity === 0 || quantity <= minStock * 0.5
            ? 'Critical Stock'
            : quantity <= minStock
              ? 'Low Stock'
              : quantity >= minStock * 3
                ? 'Excess Stock'
                : 'Normal Stock';
          return itemStatus === status;
        })
      : (queriedData || []);
    const from = (pageNumber - 1) * pageLimit;
    const paginatedData = status && status !== 'All'
      ? filteredData.slice(from, from + pageLimit)
      : filteredData;
    const total = status && status !== 'All' ? filteredData.length : (count || 0);

    res.json({
      success: true,
      data: paginatedData,
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
        criticalStock: stockCounts.criticalStock
      }
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
    const { data, error } = await supabase
      .from('inventory_items')
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
      batch
    } = req.body;

    console.log('📝 Creating inventory item:', { name, category, quantity, price });

    if (!name || !category || quantity === undefined || price === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Name, category, quantity, and price are required'
      });
    }

    // Get user ID directly from req.user.id
    const userId = getUserIdFromAuth(req);
    console.log('👤 User ID:', userId);

    const insertData = {
      name: name.trim(),
      category: category.trim(),
      unit: unit || 'pcs',
      quantity: parseFloat(quantity),
      price: parseFloat(price),
      min_stock: min_stock ? parseFloat(min_stock) : 0,
      batch: batch || null,
      created_by: userId,
      updated_by: userId
    };

    console.log('📦 Insert data:', insertData);

    const { data, error } = await supabase
      .from('inventory_items')
      .insert([insertData])
      .select()
      .single();

    if (error) {
      console.error('❌ Error creating item:', error);
      throw error;
    }

    await supabase
      .from('inventory_transactions')
      .insert([{
        item_id: data.id,
        transaction_type: 'restock',
        quantity: parseFloat(quantity),
        previous_quantity: 0,
        new_quantity: parseFloat(quantity),
        reason: 'Initial stock',
        notes: 'Item created',
        created_by: userId
      }]);

    console.log('✅ Item created successfully:', data.id);

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
      batch
    } = req.body;

    console.log('📝 Updating inventory item:', { id, name, category, quantity, price });

    // Get current item
    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
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
    if (quantity !== undefined && quantity !== null) updateData.quantity = parseFloat(quantity);
    if (price !== undefined && price !== null) updateData.price = parseFloat(price);
    if (min_stock !== undefined && min_stock !== null) updateData.min_stock = parseFloat(min_stock) || 0;
    if (batch !== undefined && batch !== null) updateData.batch = batch || null;

    console.log('📦 Update data:', updateData);

    // Update item
    const { data, error } = await supabase
      .from('inventory_items')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('❌ Error updating item:', error);
      throw error;
    }

    // Log transaction if quantity changed
    if (quantity !== undefined && parseFloat(quantity) !== currentItem.quantity) {
      await supabase
        .from('inventory_transactions')
        .insert([{
          item_id: id,
          transaction_type: 'adjustment',
          quantity: parseFloat(quantity) - currentItem.quantity,
          previous_quantity: currentItem.quantity,
          new_quantity: parseFloat(quantity),
          reason: 'Stock adjustment',
          notes: 'Updated via edit',
          created_by: userId
        }]);
    }

    console.log('✅ Item updated successfully:', data.id);

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

    const { error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', id);

    if (error) throw error;

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

    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('is_archived')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const { data, error } = await supabase
      .from('inventory_items')
      .update({
        is_archived: !currentItem.is_archived,
        updated_by: userId
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Item archived successfully:', id);
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
    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('is_archived')
      .eq('id', id)
      .single();

    const { data, error } = await supabase
      .from('inventory_items')
      .update({
        is_archived: false,
        updated_by: userId
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Item restored successfully:', id);
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

    if (!quantity || parseFloat(quantity) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid quantity is required'
      });
    }

    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    const userId = getUserIdFromAuth(req);
    console.log('👤 User ID:', userId);
    
    const newQuantity = currentItem.quantity + parseFloat(quantity);

    const { data, error } = await supabase
      .from('inventory_items')
      .update({
        quantity: newQuantity,
        updated_by: userId
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from('inventory_transactions')
      .insert([{
        item_id: id,
        transaction_type: 'restock',
        quantity: parseFloat(quantity),
        previous_quantity: currentItem.quantity,
        new_quantity: newQuantity,
        reason: reason || 'Restock',
        notes: notes || null,
        created_by: userId
      }]);

    console.log('✅ Item restocked successfully:', { id, newQuantity });
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

    const { data, error, count } = await supabase
      .from('inventory_transactions')
      .select('*', { count: 'exact' })
      .eq('item_id', id)
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