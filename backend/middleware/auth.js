// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { supabase } = require('../config/supabase');
const generateToken = require('../utils/generateToken');
const requireAuth = require('../middleware/authMiddleware');

// ============ REGISTER ============
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password are required' 
    });
  }

  if (password.length < 6) {
    return res.status(400).json({ 
      error: 'Password must be at least 6 characters' 
    });
  }

  try {
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json({ 
        error: 'User with this email already exists' 
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        email: email,
        hashed_password: hashedPassword,
        name: name || null,
        created_at: new Date()
      })
      .select('id, email, name, created_at');

    if (insertError) {
      throw insertError;
    }

    const session = generateToken(newUser[0]);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: newUser[0],
      session,
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

// ============ SETUP CHECK ============
router.get('/setup', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);

    if (error) {
      throw error;
    }

    const hasUser = Array.isArray(data) && data.length > 0;
    res.json({ success: true, hasUser });
  } catch (error) {
    console.error('Setup check error:', error);
    res.status(500).json({ error: 'Failed to check setup: ' + error.message });
  }
});

// ============ LOGIN ============
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password are required' 
    });
  }

  try {
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (findError || !user) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.hashed_password);
    
    if (!passwordMatch) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }

    delete user.hashed_password;

    console.log('🔥🔥🔥 LOGIN ROUTE HIT - generating token now');
    const session = generateToken(user);
    console.log('🔥🔥🔥 SESSION RESULT:', session);

    res.json({
      success: true,
      message: 'Login successful',
      user: user,
      session,
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed: ' + error.message });
  }
});

// ============ GET CURRENT USER (from token) ============
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .eq('id', req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user: ' + error.message });
  }
});

// ============ LOGOUT ============
router.post('/logout', requireAuth, async (req, res) => {
  // JWTs are stateless — nothing to invalidate server-side unless
  // you add a token blocklist. Frontend clears sessionStorage itself.
  res.json({ success: true, message: 'Logged out successfully' });
});

// ============ GET USER BY ID ============
router.get('/user/:id', requireAuth, async (req, res) => {
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

// ============ UPDATE PROFILE ============
router.put('/update/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { name, email } = req.body;

  try {
    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    updates.updated_at = new Date();

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', parseInt(id))
      .select('id, email, name, created_at');

    if (error) {
      throw error;
    }

    if (!updatedUser || updatedUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser[0]
    });

  } catch (error) {
    res.status(500).json({ error: 'Update failed: ' + error.message });
  }
});

// ============ CHANGE PASSWORD ============
router.put('/change-password/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ 
      error: 'Current password and new password are required' 
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ 
      error: 'New password must be at least 6 characters' 
    });
  }

  try {
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('id', parseInt(id))
      .single();

    if (findError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.hashed_password);
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    const { error: updateError } = await supabase
      .from('users')
      .update({ 
        hashed_password: hashedPassword,
        updated_at: new Date()
      })
      .eq('id', parseInt(id));

    if (updateError) {
      throw updateError;
    }

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to change password: ' + error.message });
  }
});

module.exports = router;