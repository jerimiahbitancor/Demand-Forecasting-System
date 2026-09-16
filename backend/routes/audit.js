// routes/audit.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

router.use(authenticateToken);

const ACTION_TYPES = [
  'price_recorded',
  'price_updated',
  'price_deleted',
  'category_created',
  'category_updated',
  'category_deleted',
  'unit_created',
  'unit_updated',
  'unit_deleted',
  'product_category_created',
  'product_category_updated',
  'product_category_deleted',
  'item_created',
  'item_updated',
  'item_deleted',
  'item_archived'
];

// GET /api/audit/logs?action=&search=&from=&to=&page=&limit=
// Returns the trail newest-first with exact total for paging.
router.get('/logs', async (req, res) => {
  try {
    const { action, search, from, to, page = 1, limit = 20 } = req.query;
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    let query = supabaseAdmin
      .from('system_actions_log')
      .select('id, action_type, details, performed_at', { count: 'exact' });

    if (action && ACTION_TYPES.includes(action)) {
      query = query.eq('action_type', action);
    }

    if (search) {
      query = query.or(`details.ilike.%${search}%,action_type.ilike.%${search}%`);
    }

    if (from) {
      query = query.gte('performed_at', new Date(from).toISOString());
    }

    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      query = query.lte('performed_at', toDate.toISOString());
    }

    const { data, error, count } = await query
      .order('performed_at', { ascending: false })
      .range((pageNumber - 1) * pageLimit, pageNumber * pageLimit - 1);

    if (error) {
      throw error;
    }

    let distinctQuery = supabaseAdmin
      .from('system_actions_log')
      .select('action_type');

    if (search) {
      distinctQuery = distinctQuery.or(`details.ilike.%${search}%,action_type.ilike.%${search}%`);
    }

    const { data: types, error: typesError } = await distinctQuery;

    if (typesError) {
      throw typesError;
    }

    res.json({
      success: true,
      data: data || [],
      total: count || 0,
      page: pageNumber,
      limit: pageLimit,
      totalPages: Math.ceil((count || 0) / pageLimit),
      distinctActions: [...new Set((types || []).map((t) => t.action_type).filter(Boolean))]
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;