// backend/routes/auth.js
const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../config/supabase');
const { generateOTP, sendOTPEmail, storeOTP, toPH, nowPH, toSafeISOString, getOtpExpiryTime, OTP_EXPIRATION_MINUTES } = require('../services/otpService');
const passwordResetController = require('../controllers/passwordResetController');
const authenticate = require('../middleware/auth');

// ============================================
// STEP 1: REGISTER (NO PASSWORD!)
// ============================================
router.post('/register', async (req, res) => {
  const { email, fullName, terms } = req.body;

  if (!email || !fullName) {
    return res.status(400).json({ error: 'Email and full name are required' });
  }

  if (!terms) {
    return res.status(400).json({ error: 'You must agree to the terms and conditions' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, email, is_verified')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      if (existingUser.is_verified) {
        return res.status(400).json({ error: 'User with this email already exists and is verified' });
      }

      await supabase.from('email_verifications').delete().eq('user_id', existingUser.id);
      await supabase.from('users').delete().eq('id', existingUser.id);
    }

    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert({
        email: normalizedEmail,
        name: fullName.trim(),
        is_verified: false,
      })
      .select()
      .single();

    if (insertError) throw new Error(insertError.message);

    const otp = generateOTP();
    const expiresAt = nowPH().add(OTP_EXPIRATION_MINUTES, 'minute');

    await storeOTP(user.id, normalizedEmail, otp, 'verification');

    await sendOTPEmail(normalizedEmail, otp, 'verification');

    res.status(201).json({
      success: true,
      message: 'OTP sent to your email',
      requiresVerification: true,
      userId: user.id,
      email: normalizedEmail
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

// ============================================
// STEP 2: VERIFY OTP
// ============================================
router.post('/verify-otp', async (req, res) => {
  const { email, otp, userId } = req.body;

  if (!email || !otp || !userId) {
    return res.status(400).json({ error: 'Email, OTP, and user ID are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const trimmedOtp = String(otp).trim();

  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email, is_verified')
      .eq('id', userId)
      .eq('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Account is already verified' });
    }

    const { data: verification, error: otpError } = await supabase
      .from('email_verifications')
      .select('*')
      .eq('user_id', userId)
      .eq('email', normalizedEmail)
      .eq('verification_code', trimmedOtp)
      .eq('is_used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (otpError || !verification) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const currentTime = nowPH();
    const expiresAt = toPH(verification.expires_at);

    if (expiresAt.isBefore(currentTime)) {
      return res.status(400).json({ error: 'Verification code has expired' });
    }

    // ✅ ONLY mark OTP as used (NOT verified_at - that doesn't exist!)
    const { error: updateError } = await supabase
      .from('email_verifications')
      .update({ 
        is_used: true,
        used_at: nowPH().toISOString()
      })
      .eq('id', verification.id);

    if (updateError) {
      console.error('❌ Update error:', updateError);
      return res.status(500).json({ error: 'Failed to verify OTP' });
    }

    console.log('✅ OTP verified for user:', userId);

    res.json({
      success: true,
      message: 'OTP verified successfully',
      userId: userId,
      email: normalizedEmail
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({ error: 'Verification failed: ' + error.message });
  }
});

// ============================================
// STEP 3: CREATE PASSWORD
// ============================================
router.post('/create-password', async (req, res) => {
  const { userId, email, password } = req.body;

  if (!userId || !email || !password) {
    return res.status(400).json({ error: 'User ID, email, and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .eq('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Account is already verified' });
    }

    // ✅ Check OTP was used (is_used = true)
    const { data: verification, error: verifyError } = await supabase
      .from('email_verifications')
      .select('*')
      .eq('user_id', userId)
      .eq('email', normalizedEmail)
      .eq('is_used', true)  // ✅ Check is_used = true
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    console.log('🔍 OTP used check:', verification);

    if (verifyError || !verification) {
      return res.status(400).json({ 
        error: 'Email not verified. Please verify your OTP first.' 
      });
    }

    const usedAt = toPH(verification.used_at);
    const now = nowPH();
    const timeDiff = now.diff(usedAt, 'minute');

    if (timeDiff > OTP_EXPIRATION_MINUTES) {
      return res.status(400).json({
        error: 'OTP verification expired. Please request a new OTP.'
      });
    }

    // ✅ CREATE SUPABASE AUTH USER
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: user.email,
      password: password,
      email_confirm: true,
      user_metadata: { 
        name: user.name || null,
        full_name: user.name || null
      }
    });

    if (authError) {
      console.error('Auth user creation error:', authError);
      
      if (authError.message.includes('already exists')) {
        const { data: existingAuth } = await supabaseAdmin.auth.admin.getUserByEmail(user.email);
        if (existingAuth) {
          await supabaseAdmin.auth.admin.updateUserById(
            existingAuth.user.id,
            { password: password }
          );
          
          await supabase
            .from('users')
            .update({
              auth_id: existingAuth.user.id,
              is_verified: true,
              verified_at: new Date().toISOString(),
            })
            .eq('id', userId);

          const { data: loginData } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: password
          });

          return res.json({
            success: true,
            message: 'Account created successfully',
            session: loginData.session,
            user: user
          });
        }
      }
      
      throw authError;
    }

    // ✅ Update user with auth_id and is_verified = true
    await supabase
      .from('users')
      .update({
        auth_id: authUser.user.id,
        is_verified: true,
        verified_at: new Date().toISOString(),
      })
      .eq('id', userId);

    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: password
    });

    if (loginError) {
      console.error('Auto-login error:', loginError);
      return res.json({
        success: true,
        accountCreated: true,
        requiresLogin: true,
        message: 'Account created successfully. Please log in.',
        user: user
        // no session key — frontend must not pretend one exists
      });
    }

    res.json({
      success: true,
      message: 'Account created successfully',
      session: loginData.session,
      user: user
    });

  } catch (error) {
    console.error('Create password error:', error);
    res.status(500).json({ error: 'Failed to create account: ' + error.message });
  }
});

// ============================================
// RESEND OTP
// ============================================
router.post('/resend-otp', async (req, res) => {
  const { email, userId } = req.body;

  if (!email || !userId) {
    return res.status(400).json({ error: 'Email and user ID are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .eq('email', normalizedEmail)
      .eq('is_verified', false)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found or already verified' });
    }

    const otp = generateOTP();
    
    // ✅ Use a proper future expiration timestamp
    const expiresAt = getOtpExpiryTime();

    console.log('📧 New OTP:', otp);
    console.log('⏰ Expires at (PH):', expiresAt.format());

    const { error: upsertError } = await supabase
      .from('email_verifications')
      .upsert({
        user_id: userId,
        email: normalizedEmail,
        verification_code: otp,
        expires_at: toSafeISOString(expiresAt),
        is_used: false,
        used_at: null,
        created_at: toSafeISOString(nowPH())
      }, {
        onConflict: 'user_id'
      });

    if (upsertError) {
      console.error('❌ OTP upsert error:', upsertError);
      return res.status(500).json({ error: 'Failed to update OTP' });
    }

    await sendOTPEmail(normalizedEmail, otp, 'verification');

    res.json({
      success: true,
      message: 'New OTP sent to your email'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ error: 'Failed to resend OTP: ' + error.message });
  }
});

// ============================================
// PASSWORD RESET
// ============================================
router.post('/forgot-password/send-code', passwordResetController.sendCode);
router.post('/forgot-password/verify-code', passwordResetController.verifyCode);
router.post('/forgot-password/reset-password', passwordResetController.resetPassword);

// ============================================
// SYNC USER
// ============================================
router.post('/sync-user', authenticate, async (req, res) => {
  try {
    // ✅ User already authenticated + enriched by middleware!
    const authUser = req.authUser;  // Original Supabase Auth user
    const customUser = req.user;     // Enriched with custom user data

    console.log('🔄 Syncing user:', customUser.email);
    console.log('📋 Custom user exists?', !!customUser.id);

    // If custom user already exists, return it
    if (customUser.id && customUser.auth_id === authUser.id) {
      return res.json({
        success: true,
        message: 'User already exists',
        user: customUser
      });
    }

    // ✅ User exists in Auth but NOT in custom users table
    // Create custom user record
    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        auth_id: authUser.id,
        email: authUser.email,
        name: authUser.user_metadata?.full_name || 
              authUser.user_metadata?.name || 
              authUser.email.split('@')[0] || 
              'User',
        is_verified: authUser.email_confirmed_at ? true : false,
        verified_at: authUser.email_confirmed_at || null
      })
      .select()
      .single();

    if (insertError) {
      console.error('❌ Error creating user:', insertError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to sync user: ' + insertError.message 
      });
    }

    console.log('✅ New custom user created:', newUser.id);

    res.json({
      success: true,
      message: 'User synced successfully',
      user: newUser
    });

  } catch (error) {
    console.error('❌ Sync user error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to sync user: ' + error.message 
    });
  }
});

// ============================================
// SETUP CHECK
// ============================================
router.get('/setup', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('is_verified', true)
      .limit(1);

    if (error) {
      console.error('❌ Setup check error (custom users):', error);
      return res.status(500).json({ error: 'Failed to check setup' });
    }

    const hasUser = Array.isArray(data) && data.length > 0;

    console.log('🔍 Setup check - hasUser:', hasUser);
    res.json({ success: true, hasUser });
  } catch (error) {
    console.error('Setup check failed:', error);
    res.status(500).json({ error: 'Failed to check setup' });
  }
});


module.exports = router;