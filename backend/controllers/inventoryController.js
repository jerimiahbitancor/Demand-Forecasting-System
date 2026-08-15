// controllers/inventoryController.js
const { supabase } = require('../config/supabase');

// Helper function to get user ID from auth_id
const getUserIdFromAuth = async (authId) => {
  const { data: userData, error: userError } = await supabase
    .from('user')
    .select('id')
    .eq('auth_id', authId)
    .single();

  if (userError || !userData) {
    throw new Error('User not found');
  }

  return userData.id;
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
      showArchived = false
    } = req.query;

    console.log('📦 Fetching inventory items...');
    console.log('Query params:', req.query);

    let summaryQuery = supabase
      .from('inventory_items')
      .select('quantity, price, min_stock, category, is_archived');

    let query = supabase
      .from('inventory_items')
      .select(`
        *,
        created_by_user:created_by(id, name, email),
        updated_by_user:updated_by(id, name, email)
      `, { count: 'exact' });

    // Filter archived
    if (showArchived === 'true') {
      query = query.eq('is_archived', true);
      summaryQuery = summaryQuery.eq('is_archived', true);
    } else {
      query = query.eq('is_archived', false);
      summaryQuery = summaryQuery.eq('is_archived', false);
    }

    // Search
    if (search) {
      query = query.or(`name.ilike.%${search}%,category.ilike.%${search}%,batch.ilike.%${search}%`);
      summaryQuery = summaryQuery.or(`name.ilike.%${search}%,category.ilike.%${search}%,batch.ilike.%${search}%`);
    }

    // Filter by category
    if (category && category !== 'All') {
      query = query.eq('category', category);
      summaryQuery = summaryQuery.eq('category', category);
    }

    const { data: summaryData, error: summaryError } = await summaryQuery;
    if (summaryError) {
      console.error('❌ Supabase summary error:', summaryError);
      throw summaryError;
    }

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

    // Sorting
    const validSortFields = ['created_at', 'name', 'category', 'quantity', 'price', 'batch'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;

    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }

    console.log(`✅ Found ${data?.length || 0} items, Total: ${count || 0}`);

    res.json({
      success: true,
      data,
      total: count || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((count || 0) / limit),
      summary: {
        totalItems,
        totalStockValue,
        lowStockAlerts,
        outOfStockItems
      }
    });
  } catch (error) {
    console.error('❌ Error fetching inventory:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single inventory item with user info
const getInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('inventory_items')
      .select(`
        *,
        created_by_user:created_by(id, name, email),
        updated_by_user:updated_by(id, name, email)
      `)
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

// Create inventory item (WITHOUT supplier, location, notes)
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

    // Validate required fields
    if (!name || !category || quantity === undefined || price === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Name, category, quantity, and price are required'
      });
    }

    // Get user ID from auth_id
    const userId = await getUserIdFromAuth(req.user.id);

    const { data, error } = await supabase
      .from('inventory_items')
      .insert([{
        name: name.trim(),
        category: category.trim(),
        unit: unit || 'pcs',
        quantity: parseFloat(quantity),
        price: parseFloat(price),
        min_stock: min_stock ? parseFloat(min_stock) : 0,
        batch: batch || null,
        created_by: userId,
        updated_by: userId
      }])
      .select(`
        *,
        created_by_user:created_by(id, name, email)
      `)
      .single();

    if (error) throw error;

    // Log transaction
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

    res.json({ success: true, data, message: 'Item added successfully' });
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update inventory item (WITHOUT supplier, location, notes)
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

    // Get current item
    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Get user ID from auth_id
    const userId = await getUserIdFromAuth(req.user.id);

    // Update item
    const { data, error } = await supabase
      .from('inventory_items')
      .update({
        name: name?.trim(),
        category: category?.trim(),
        unit: unit || 'pcs',
        quantity: parseFloat(quantity),
        price: parseFloat(price),
        min_stock: min_stock ? parseFloat(min_stock) : 0,
        batch: batch || null,
        updated_by: userId
      })
      .eq('id', id)
      .select(`
        *,
        created_by_user:created_by(id, name, email),
        updated_by_user:updated_by(id, name, email)
      `)
      .single();

    if (error) throw error;

    // Log transaction if quantity changed
    if (parseFloat(quantity) !== currentItem.quantity) {
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

    res.json({ success: true, data, message: 'Item updated successfully' });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete inventory item
const deleteInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('inventory_items')
      .delete()
      .eq('id', id);

    if (error) throw error;

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

    // Get user ID from auth_id
    const userId = await getUserIdFromAuth(req.user.id);

    // Get current item to check archive status
    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('is_archived')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Toggle archive status
    const { data, error } = await supabase
      .from('inventory_items')
      .update({
        is_archived: !currentItem.is_archived,
        updated_by: userId
      })
      .eq('id', id)
      .select(`
        *,
        created_by_user:created_by(id, name, email),
        updated_by_user:updated_by(id, name, email)
      `)
      .single();

    if (error) throw error;

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

// Restock inventory item
const restockInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, reason, notes } = req.body;

    if (!quantity || parseFloat(quantity) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid quantity is required'
      });
    }

    // Get current item
    const { data: currentItem, error: fetchError } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ success: false, error: 'Item not found' });
    }

    // Get user ID from auth_id
    const userId = await getUserIdFromAuth(req.user.id);
    const newQuantity = currentItem.quantity + parseFloat(quantity);

    // Update quantity
    const { data, error } = await supabase
      .from('inventory_items')
      .update({
        quantity: newQuantity,
        updated_by: userId
      })
      .eq('id', id)
      .select(`
        *,
        created_by_user:created_by(id, name, email),
        updated_by_user:updated_by(id, name, email)
      `)
      .single();

    if (error) throw error;

    // Log transaction
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

// Get transaction history with user info
const getItemTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;

    const { data, error } = await supabase
      .from('inventory_transactions')
      .select(`
        *,
        created_by_user:created_by(id, name, email)
      `)
      .eq('item_id', id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) throw error;

    res.json({ success: true, data });
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
  restockInventoryItem,
  getItemTransactions
};