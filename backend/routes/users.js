const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const authenticate = require('../middleware/auth');

// ============================================
// GET ALL USERS (Protected)
// ============================================
router.get('/', authenticate, async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name, created_at, is_verified')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(users);

  } catch (error) {
    res.status(500).json({ error: 'Failed to get users: ' + error.message });
  }
});

// ============================================
// GET USER BY ID (Protected)
// ============================================
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, created_at, is_verified')
      .eq('id', parseInt(id))
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);

  } catch (error) {
    res.status(500).json({ error: 'Failed to get user: ' + error.message });
  }
});

// ============================================
// UPDATE USER (Protected)
// ============================================
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body;

  try {
    // Check if user is updating their own data
    if (req.user.id !== parseInt(id) && req.user.auth_id !== req.user.id) {
      return res.status(403).json({ error: 'Cannot update other users' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (email) {
      updates.email = email.trim().toLowerCase();
      // Also update in Supabase Auth
      const { error: authError } = await supabase.auth.updateUser({
        email: updates.email
      });
      if (authError) throw authError;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', parseInt(id))
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      user: data
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to update user: ' + error.message });
  }
});

// ============================================
// DELETE USER (Protected)
// ============================================
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if user is deleting their own data
    if (req.user.id !== parseInt(id) && req.user.auth_id !== req.user.id) {
      return res.status(403).json({ error: 'Cannot delete other users' });
    }

    // Get user to get auth_id
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('auth_id')
      .eq('id', parseInt(id))
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete from Supabase Auth (if exists)
    if (user.auth_id) {
      const { error: authError } = await supabase.auth.admin.deleteUser(user.auth_id);
      if (authError) {
        // Log but don't expose to client
      }
    }

    // Delete from custom users table (cascade will handle related tables)
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', parseInt(id));

    if (error) throw error;

    res.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    res.status(500).json({ error: 'Delete failed: ' + error.message });
  }
});

module.exports = router;