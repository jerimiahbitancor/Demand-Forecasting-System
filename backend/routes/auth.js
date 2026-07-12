// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { supabase } = require('../config/supabase');
const generateToken = require('../utils/generateToken');
const requireAuth = require('../middleware/authMiddleware');
const { 
  generateOTP,
  sendOTPEmail,
  storeOTP,
  verifyOTP,
  resendOTP,
  nowPH
} = require('../services/otpService');

// ============ REGISTER WITH EMAIL VERIFICATION ============
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  // Validate input
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

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email, is_verified')
      .ilike('email', normalizedEmail)
      .single();

    if (existingUser) {
      // If user exists and is verified
      if (existingUser.is_verified) {
        return res.status(400).json({ 
          error: 'User with this email already exists and is verified' 
        });
      }
      
      // If user exists but not verified - resend OTP
      const otp = generateOTP();
      await storeOTP(existingUser.id, normalizedEmail, otp, 'verification');
      await sendOTPEmail(normalizedEmail, otp, 'verification');

      return res.status(200).json({
        success: true,
        message: 'OTP resent to your email',
        requiresVerification: true,
        email: normalizedEmail
      });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user with is_verified = false
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        email: normalizedEmail,
        hashed_password: hashedPassword,
        name: name || null,
        is_verified: false,
        created_at: nowPH().toISOString(),
      })
      .select('id, email, name, created_at, is_verified');

    if (insertError) {
      throw insertError;
    }

    // Generate OTP and store
    const otp = generateOTP();
    await storeOTP(newUser[0].id, normalizedEmail, otp, 'verification');
    
    // Send OTP to email
    await sendOTPEmail(normalizedEmail, otp, 'verification');

    res.status(201).json({
      success: true,
      message: 'User registered successfully. Please verify your email.',
      user: newUser[0],
      requiresVerification: true,
      email: normalizedEmail
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

// ============ VERIFY EMAIL OTP ============
  router.post('/verify-email', async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    try {
      // ✅ Pass true - DO mark as used (email verification is one-time)
      const result = await verifyOTP(email, otp, 'verification', true);
      
      if (!result.valid) {
        return res.status(400).json({ error: result.error });
      }

      // Update user as verified
      const { data: verifiedUser, error: updateError } = await supabase
        .from('users')
        .update({
          is_verified: true,
          verified_at: nowPH().toISOString()
        })
        .eq('id', result.userId)
        .select('id, email, name, created_at, is_verified');

      if (updateError) throw updateError;

      // Generate JWT token for auto-login
      const session = generateToken(verifiedUser[0]);

      res.json({
        success: true,
        message: 'Email verified successfully!',
        user: verifiedUser[0],
        session
      });

    } catch (error) {
      console.error('Email verification error:', error);
      res.status(500).json({ error: 'Verification failed: ' + error.message });
    }
  });

// ============ RESEND EMAIL OTP ============
router.post('/resend-email-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const result = await resendOTP(email, 'verification');
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      success: true,
      message: 'New verification code sent to your email'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP: ' + error.message });
  }
});

// ============ UPDATE LOGIN TO CHECK VERIFICATION ============
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password are required' 
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // Get user by email
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('*')
      .ilike('email', normalizedEmail)
      .single();

    if (findError || !user) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }

    // Check if user is verified
    if (!user.is_verified) {
      return res.status(403).json({ 
        error: 'Please verify your email before logging in',
        requiresVerification: true,
        email: normalizedEmail
      });
    }

    // Check if password matches
    const passwordMatch = await bcrypt.compare(password, user.hashed_password);
    
    if (!passwordMatch) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }

    // Remove password from response
    delete user.hashed_password;

    const session = generateToken(user);

    res.json({
      success: true,
      message: 'Login successful',
      user,
      session
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed: ' + error.message });
  }
});

  // ============ FORGOT PASSWORD - SEND CODE ============
  router.post('/forgot-password/send-code', async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email')
        .ilike('email', normalizedEmail)
        .single();

      if (userError || !user) {
        return res.status(404).json({ error: 'No account found with that email' });
      }

      // Generate and store OTP using otpService
      const otp = generateOTP();
      await storeOTP(user.id, normalizedEmail, otp, 'reset');
      await sendOTPEmail(normalizedEmail, otp, 'reset');

      res.status(200).json({
        success: true,
        message: 'Verification code sent to your email',
      });
    } catch (error) {
      console.error('Send code error:', error);
      res.status(500).json({ error: 'Failed to send verification code: ' + error.message });
    }
  });

  // ============ FORGOT PASSWORD - VERIFY CODE ============
    router.post('/forgot-password/verify-code', async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    try {
      //  Pass false lang sha - DON'T mark as used sa db
      const result = await verifyOTP(email, code, 'reset', false);
      
      if (!result.valid) {
        return res.status(401).json({ error: result.error });
      }

      res.status(200).json({
        success: true,
        message: 'Code verified successfully',
      });
    } catch (error) {
      console.error('Verify code error:', error);
      res.status(500).json({ error: 'Failed to verify code: ' + error.message });
    }
  });

  // ============ FORGOT PASSWORD - RESET PASSWORD ============
  router.post('/forgot-password/reset-password', async (req, res) => {
    const { email, code, password } = req.body;

    if (!email || !code || !password) {
      return res.status(400).json({ error: 'Email, code, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
      // ✅ Pass true - DO mark as used
      const result = await verifyOTP(email, code, 'reset', true);
      
      if (!result.valid) {
        return res.status(401).json({ error: result.error });
      }

      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const { error: updateError } = await supabase
        .from('users')
        .update({ hashed_password: hashedPassword })
        .eq('id', result.userId);

      if (updateError) throw updateError;

      res.status(200).json({
        success: true,
        message: 'Password reset successfully',
      });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Failed to reset password: ' + error.message });
    }
  });

// ============ SETUP CHECK (Unchanged) ============
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

module.exports = router;