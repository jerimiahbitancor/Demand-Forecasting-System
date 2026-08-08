const { supabase, supabaseAdmin } = require('../config/supabase');
const { generateOTP, sendOTPEmail, toPH, nowPH, toSafeISOString, getOtpExpiryTime, OTP_EXPIRATION_MINUTES } = require('../services/otpService');

// ============ SEND VERIFICATION CODE ============
const sendCode = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, email')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'No account found with that email' });
    }

    const verificationCode = generateOTP();
    const expiresAt = toSafeISOString(getOtpExpiryTime());

    const { error: upsertError } = await supabase
      .from('password_resets')
      .upsert(
        {
          user_id: user.id,
          email: normalizedEmail,
          verification_code: verificationCode,
          expires_at: expiresAt,
          is_used: false,
        },
        { onConflict: 'user_id' }
      );

    if (upsertError) {
      throw upsertError;
    }

    // respond immediately, send email in background to avoid blocking
    res.status(200).json({
      success: true,
      message: 'Verification code sent to your email',
    });

    sendOTPEmail(normalizedEmail, verificationCode, 'reset').catch((err) => {
      console.error('Background sendOTPEmail error (forgot-password):', err);
    });
  } catch (error) {
    console.error('Send code error:', error);
    res.status(500).json({ error: 'Failed to send verification code: ' + error.message });
  }
};

// ============ VERIFY CODE ============
const verifyCode = async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: user, error: userError } = await supabase
      .from('user')
      .select('id')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid email or code' });
    }

    const { data: resetRecord, error: resetError } = await supabase
      .from('password_resets')
      .select('id, verification_code, expires_at, is_used')
      .eq('user_id', user.id)
      .single();

    if (resetError || !resetRecord) {
      console.log('Reset record not found for user:', user.id, normalizedEmail);
      return res.status(401).json({ error: 'Invalid email or code' });
    }

    if (resetRecord.is_used) {
      console.log('Code already used:', resetRecord.id);
      return res.status(401).json({ error: 'This code has already been used' });
    }

    const currentTime = nowPH();
    const expiresTime = toPH(resetRecord.expires_at);
    const timeDiff = expiresTime.diff(currentTime);

    console.log('Code validation:', {
      currentTimePH: currentTime.format(),
      expiresAtPH: expiresTime.format(),
      secondsRemaining: Math.round(timeDiff / 1000),
      isExpired: timeDiff <= 0,
    });

    if (timeDiff <= 0) {
      return res.status(401).json({ error: 'Verification code has expired' });
    }

    const dbCode = String(resetRecord.verification_code).trim();
    const userCode = String(code).trim();

    if (dbCode !== userCode) {
      console.log('Code mismatch:', { expected: dbCode, received: userCode });
      return res.status(401).json({ error: 'Invalid code' });
    }

    res.status(200).json({
        success: true,
        message: 'Code verified successfully',
    });
  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ error: 'Failed to verify code: ' + error.message });
  }
};

// ============ RESET PASSWORD ============
const resetPassword = async (req, res) => {
  const { email, code, password } = req.body;

  if (!email || !code || !password) {
    return res.status(400).json({ error: 'Email, code, and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, auth_id')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid request' });
    }

    const { data: resetRecord, error: resetError } = await supabase
      .from('password_resets')
      .select('id, verification_code, expires_at, is_used')
      .eq('user_id', user.id)
      .single();

    if (resetError || !resetRecord) {
      return res.status(401).json({ error: 'Invalid request' });
    }

    if (resetRecord.is_used) {
      return res.status(401).json({ error: 'This code has already been used' });
    }

    const currentTime = nowPH();
    const expiresTime = toPH(resetRecord.expires_at);
    const timeDiff = expiresTime.diff(currentTime);

    if (timeDiff <= 0) {
      return res.status(401).json({ error: 'Verification code has expired' });
    }

    const dbCode = String(resetRecord.verification_code).trim();
    const userCode = String(code).trim();

    if (dbCode !== userCode) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    if (!user.auth_id) {
      const { data: existingAuth, error: existingAuthError } = await supabaseAdmin.auth.admin.getUserByEmail(normalizedEmail);
      if (existingAuthError) {
        throw existingAuthError;
      }

      if (existingAuth && existingAuth.user) {
        user.auth_id = existingAuth.user.id;
        const { error: syncError } = await supabase
          .from('user')
          .update({ auth_id: user.auth_id })
          .eq('id', user.id);

        if (syncError) {
          throw syncError;
        }
      } else {
        const { data: authUser, error: authUserError } = await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true,
        });

        if (authUserError) {
          throw authUserError;
        }

        user.auth_id = authUser.user.id;
        const { error: syncError } = await supabase
          .from('user')
          .update({ auth_id: user.auth_id })
          .eq('id', user.id);

        if (syncError) {
          throw syncError;
        }
      }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.auth_id, {
      password,
    });

    if (updateError) {
      throw updateError;
    }

    const { error: markError } = await supabase
      .from('password_resets')
      .update({ is_used: true })
      .eq('id', resetRecord.id);

    if (markError) {
      throw markError;
    }

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password: ' + error.message });
  }
};

module.exports = {
  sendCode,
  verifyCode,
  resetPassword,
};