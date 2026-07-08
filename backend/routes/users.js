// routes/users.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

// Get all users
router.get('/', async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(users);

  } catch (error) {
    res.status(500).json({ error: 'Failed to get users: ' + error.message });
  }
});

// Get user by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, created_at')
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

// Search users by email or name
router.get('/search/:query', async (req, res) => {
  const { query } = req.params;

  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .or(`email.ilike.%${query}%,name.ilike.%${query}%`)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(users);

  } catch (error) {
    res.status(500).json({ error: 'Search failed: ' + error.message });
  }
});

// Delete user
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
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