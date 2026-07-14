const { supabase, supabaseAdmin } = require('../config/supabase');
const { verifyOTP } = require('../services/otpService');
const passwordResetController = require('./passwordResetController');

// Send OTP to the account email (when user is logged in in Account Settings)
const sendChangePasswordCode = async (req, res) => {
  try {
    const email = (req.user && req.user.email) || (req.body && req.body.email);

    if (!email) {
      return res.status(400).json({ error: 'Email not found for account' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    req.body = req.body || {};
    req.body.email = normalizedEmail;
    return passwordResetController.sendCode(req, res);
  } catch (error) {
    console.error('sendChangePasswordCode error:', error);
    return res.status(500).json({ error: 'Failed to send verification code: ' + error.message });
  }
};

// Verify code submitted by user (account settings)
const verifyChangePasswordCode = async (req, res) => {
  try {
    const code = req.body && req.body.code;
    const email = (req.user && req.user.email) || (req.body && req.body.email);

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const result = await verifyOTP(normalizedEmail, code, 'reset', false);

    if (!result.valid) {
      return res.status(401).json({ error: result.error || 'Invalid code' });
    }

    return res.status(200).json({ success: true, message: 'Code verified successfully' });
  } catch (error) {
    console.error('verifyChangePasswordCode error:', error);
    return res.status(500).json({ error: 'Failed to verify code: ' + error.message });
  }
};

// Change password after code verification
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

    const verifyResult = await verifyOTP(normalizedEmail, code, 'reset', true);
    if (!verifyResult.valid) {
      return res.status(401).json({ error: verifyResult.error || 'Invalid code' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, auth_id')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let authId = user.auth_id;

    if (!authId) {
      const { data: existingAuth, error: existingAuthError } = await supabaseAdmin.auth.admin.getUserByEmail(normalizedEmail);
      if (existingAuthError) {
        throw existingAuthError;
      }

      if (existingAuth && existingAuth.user) {
        authId = existingAuth.user.id;
        const { error: syncError } = await supabase
          .from('users')
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
        const { error: syncError } = await supabase
          .from('users')
          .update({ auth_id: authId })
          .eq('id', user.id);
        if (syncError) throw syncError;
      }
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authId, { password });
    if (updateError) throw updateError;

    const now = new Date().toISOString();
    const { error: timestampError } = await supabase
      .from('users')
      .update({ last_password_change: now })
      .eq('id', user.id);

    if (timestampError) {
      console.warn('Could not update last_password_change field, falling back to updated_at:', timestampError.message);
      const { error: fallbackError } = await supabase
        .from('users')
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
