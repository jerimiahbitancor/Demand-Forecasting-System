const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/supabase');
const { 
  storeOTP,
  storeOTPWithPassword,
  verifyOTP, 
  resendOTP, 
  sendOTPEmail,
  generateOTP,
  nowPH,
  toPH
} = require('../services/otpService');
const authenticate = require('../middleware/auth');

// ============================================
// REGISTER
// ============================================
router.post('/register', async (req, res) => {
  const { email, password, fullName } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, email, is_verified')
      .eq('email', normalizedEmail)
      .single();

    if (existingUser) {
      if (existingUser.is_verified) {
        return res.status(400).json({ 
          error: 'User with this email already exists and is verified' 
        });
      }
    }

    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert({
        email: normalizedEmail,
        name: fullName.trim(),
        is_verified: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    const otp = generateOTP();
    
    await storeOTPWithPassword(user.id, normalizedEmail, otp, password);

    await sendOTPEmail(normalizedEmail, otp, 'verification');

    res.status(201).json({
      success: true,
      message: 'OTP sent to your email',
      requiresVerification: true,
      email: normalizedEmail
    });

  } catch (error) {
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

// ============================================
// VERIFY EMAIL
// ============================================
router.post('/verify-email', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedOtp = String(otp).trim();

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { data: otpRecords, error: otpError } = await supabaseAdmin
      .from('email_verifications')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_used', false)
      .order('created_at', { ascending: false });

    if (otpError) {
      return res.status(500).json({ error: 'Failed to fetch OTP' });
    }

    if (!otpRecords || otpRecords.length === 0) {
      return res.status(400).json({ 
        error: 'No verification code found. Please request a new one.' 
      });
    }

    let matchedOTP = null;
    for (const record of otpRecords) {
      if (String(record.verification_code).trim() === trimmedOtp) {
        matchedOTP = record;
        break;
      }
    }

    if (!matchedOTP) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    if (!matchedOTP.expires_at) {
      return res.status(400).json({ 
        error: 'Invalid OTP. Please request a new one.' 
      });
    }

    const currentTime = nowPH();
    const expiresTime = toPH(matchedOTP.expires_at);
    const timeDiff = expiresTime.diff(currentTime);

    if (timeDiff <= 0) {
      return res.status(400).json({ error: 'Verification code has expired' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Account is already verified' });
    }

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: user.email,
      password: matchedOTP.password,
      email_confirm: true,
      user_metadata: { name: user.name || null }
    });

    if (authError) {
      if (authError.message.includes('already exists')) {
        const { data: existingAuth } = await supabaseAdmin.auth.admin.getUserByEmail(user.email);
        if (existingAuth) {
          await supabaseAdmin
            .from('users')
            .update({
              auth_id: existingAuth.user.id,
              is_verified: true,
              verified_at: new Date().toISOString()
            })
            .eq('id', user.id);

          await supabaseAdmin
            .from('email_verifications')
            .update({
              is_used: true,
              used_at: new Date().toISOString(),
              password: null
            })
            .eq('id', matchedOTP.id);

          const { data: loginData } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: matchedOTP.password
          });

          return res.json({
            success: true,
            message: 'Email verified!',
            user: user,
            session: loginData.session
          });
        }
      }
      throw authError;
    }

    await supabaseAdmin
      .from('users')
      .update({
        auth_id: authUser.user.id,
        is_verified: true,
        verified_at: new Date().toISOString()
      })
      .eq('id', user.id);

    await supabaseAdmin
      .from('email_verifications')
      .update({
        is_used: true,
        used_at: new Date().toISOString(),
        password: null
      })
      .eq('id', matchedOTP.id);

    const { data: loginData } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: matchedOTP.password
    });

    res.json({
      success: true,
      message: 'Email verified successfully!',
      user: user,
      session: loginData.session
    });

  } catch (error) {
    res.status(500).json({ error: 'Verification failed: ' + error.message });
  }
});

// ============================================
// RESEND OTP
// ============================================
router.post('/resend-otp', async (req, res) => {
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
    res.status(500).json({ error: 'Failed to resend OTP: ' + error.message });
  }
});

// ============================================
// LOGIN
// ============================================
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ 
      error: 'Email and password are required' 
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        const { data: user } = await supabase
          .from('users')
          .select('*')
          .eq('email', normalizedEmail)
          .single();

        if (user && user.is_verified && !user.auth_id) {
          return res.status(403).json({
            error: 'Please verify your email first',
            requiresVerification: true,
            email: normalizedEmail
          });
        }
        throw error;
      }

      if (error.message.includes('Email not confirmed')) {
        return res.status(403).json({
          error: 'Please verify your email before logging in',
          requiresVerification: true,
          email: normalizedEmail
        });
      }

      throw error;
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', data.user.id)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      console.error('Error fetching user data:', userError);
    }

    res.json({
      success: true,
      message: 'Login successful',
      user: user || data.user,
      session: data.session
    });

  } catch (error) {
    res.status(401).json({ 
      error: 'Invalid email or password' 
    });
  }
});

// ============================================
// FORGOT PASSWORD
// ============================================
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
      .eq('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists, a reset code will be sent'
      });
    }

    const otp = generateOTP();
    await storeOTP(user.id, normalizedEmail, otp, 'reset');
    await sendOTPEmail(normalizedEmail, otp, 'reset');

    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email'
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to send verification code: ' + error.message });
  }
});

router.post('/forgot-password/verify-code', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  try {
    const result = await verifyOTP(email, code, 'reset', false);
    
    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

    res.status(200).json({
      success: true,
      message: 'Code verified successfully',
      recordId: result.record.id
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to verify code: ' + error.message });
  }
});

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
    const result = await verifyOTP(normalizedEmail, code, 'reset', true);
    
    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', result.userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.auth_id) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        user.auth_id,
        { password: password }
      );

      if (authError) throw authError;
    } else {
      return res.status(400).json({ 
        error: 'User account not properly set up. Please contact support.' 
      });
    }

    res.status(200).json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to reset password: ' + error.message });
  }
});

// ============================================
// GET CURRENT USER
// ============================================
router.get('/me', authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user data' });
  }
});

// ============================================
// LOGOUT
// ============================================
router.post('/logout', authenticate, async (req, res) => {
  try {
    await supabase.auth.signOut();
    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed: ' + error.message });
  }
});

// ============================================
// SETUP CHECK
// ============================================
router.get('/setup', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .limit(1);

    if (error) throw error;

    const hasUser = Array.isArray(data) && data.length > 0;
    res.json({ success: true, hasUser });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check setup: ' + error.message });
  }
});

module.exports = router;