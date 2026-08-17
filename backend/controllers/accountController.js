const { supabase, supabaseAdmin } = require('../config/supabase');
const { generateOTP, sendOTPEmail, toPH, nowPH, toSafeISOString, getOtpExpiryTime } = require('../services/otpService');

const sendChangePasswordCode = async (req, res) => {
  try {
    const email = (req.user && req.user.email) || (req.body && req.body.email);

    if (!email) {
      return res.status(400).json({ error: 'Email not found for account' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, email')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const verificationCode = generateOTP();
    const expiresAt = toSafeISOString(getOtpExpiryTime());

    const { error: upsertError } = await supabaseAdmin
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
      console.error('Background sendOTPEmail error (change password):', err);
    });
  } catch (error) {
    console.error('sendChangePasswordCode error:', error);
    return res.status(500).json({ error: 'Failed to send verification code: ' + error.message });
  }
};

const verifyChangePasswordCode = async (req, res) => {
  try {
    const code = req.body && req.body.code;
    const email = (req.user && req.user.email) || (req.body && req.body.email);

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid email or code' });
    }

    const { data: resetRecord, error: resetError } = await supabaseAdmin
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
    console.error('verifyChangePasswordCode error:', error);
    return res.status(500).json({ error: 'Failed to verify code: ' + error.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { code, password } = req.body || {};
    const email = (req.user && req.user.email) || (req.body && req.body.email);

    if (!email || !code || !password) {
      return res.status(400).json({ error: 'Email, code and password are required' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, auth_id')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid request' });
    }

    const { data: resetRecord, error: resetError } = await supabaseAdmin
      .from('password_resets')
      .select('id, verification_code, is_used')
      .eq('user_id', user.id)
      .single();

    if (resetError || !resetRecord) {
      return res.status(401).json({ error: 'Invalid request' });
    }

    if (resetRecord.is_used) {
      return res.status(401).json({ error: 'This code has already been used' });
    }

    const dbCode = String(resetRecord.verification_code).trim();
    const userCode = String(code).trim();

    if (dbCode !== userCode) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    let authId = user.auth_id;

    if (!authId) {
      const { data: existingAuth, error: existingAuthError } = await supabaseAdmin.auth.admin.getUserByEmail(normalizedEmail);
      if (existingAuthError) {
        throw existingAuthError;
      }

      if (existingAuth && existingAuth.user) {
        authId = existingAuth.user.id;
        const { error: syncError } = await supabaseAdmin
          .from('user')
          .update({ auth_id: authId })
          .eq('id', user.id);
        if (syncError) throw syncError;
      } else {
        const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password,
          email_confirm: true
        });
        if (createError) throw createError;
        authId = created.user.id;
        const { error: syncError } = await supabaseAdmin
          .from('user')
          .update({ auth_id: authId })
          .eq('id', user.id);
        if (syncError) throw syncError;
      }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authId, { password });
    if (updateError) throw updateError;

    const { error: markError } = await supabaseAdmin
      .from('password_resets')
      .update({ 
        is_used: true,
        used_at: nowPH().toISOString()
      })
      .eq('id', resetRecord.id);

    if (markError) {
      throw markError;
    }

    const now = new Date().toISOString();
    const { error: timestampError } = await supabaseAdmin
      .from('user')
      .update({ last_password_change: now })
      .eq('id', user.id);

    if (timestampError) {
      console.warn('Could not update last_password_change field, falling back to updated_at:', timestampError.message);
      const { error: fallbackError } = await supabaseAdmin
        .from('user')
        .update({ updated_at: now })
        .eq('id', user.id);
      if (fallbackError) {
        console.error('Could not update updated_at fallback field:', fallbackError);
      }
    }

    return res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('changePassword error:', error);
    return res.status(500).json({ error: 'Failed to change password: ' + error.message });
  }
};

module.exports = {
  sendChangePasswordCode,
  verifyChangePasswordCode,
  changePassword,
};