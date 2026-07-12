// services/otpService.js
const { supabase } = require('../config/supabase');
const nodemailer = require('nodemailer');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TZ = 'Asia/Manila';

const nowPH = () => dayjs().tz(PH_TZ);
const toPH = (dbTimestamp) => {
  const hasOffset = /Z|[+-]\d{2}:\d{2}$/.test(dbTimestamp);
  const safe = hasOffset ? dbTimestamp : `${dbTimestamp}Z`;
  return dayjs(safe).tz(PH_TZ);
};

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Configure email transporter
const createTransporter = () => {
  if (process.env.EMAIL_SERVICE === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
  }
  
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  });
};

// Send OTP Email (Unified for both flows)
const sendOTPEmail = async (email, otp, type) => {
  try {
    const transporter = createTransporter();
    
    const templates = {
      verification: {
        subject: 'Verify Your ChefDuo Account',
        title: 'Welcome to ChefDuo! 🎉',
        message: 'Thank you for registering. Please verify your email address by entering the OTP code below:',
        footer: 'If you didn\'t create an account with ChefDuo, please ignore this email.'
      },
      reset: {
        subject: 'Password Reset Code - ChefDuo',
        title: 'Password Reset Request',
        message: 'We received a request to reset your password. Use the code below to proceed:',
        footer: 'If you didn\'t request a password reset, please ignore this email or contact support.'
      }
    };

    const template = templates[type] || templates.verification;

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@chefduo.com',
      to: email,
      subject: template.subject,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #bb0114; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px; background: #f9f9f9; }
            .otp-box { 
              background: white; 
              padding: 20px; 
              text-align: center; 
              font-size: 32px; 
              letter-spacing: 5px; 
              font-weight: bold;
              border-radius: 8px;
              margin: 20px 0;
              border: 2px dashed #bb0114;
            }
            .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>ChefDuo Sales Forecasting</h1>
            </div>
            <div class="content">
              <h2>${template.title}</h2>
              <p>${template.message}</p>
              <div class="otp-box">${otp}</div>
              <p><strong>This code will expire in 10 minutes.</strong></p>
              <p>${template.footer}</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ChefDuo Sales Forecasting. All rights reserved.</p>
              <p>This is an automated message, please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`${type} email sent:`, info.messageId);
    return { success: true };

  } catch (error) {
    console.error('Email sending error:', error);
    throw new Error('Failed to send email: ' + error.message);
  }
};

// Store OTP in database (Unified)
const storeOTP = async (userId, email, otp, type) => {
  const expiresAt = nowPH().add(10, 'minute').toISOString();
  
  // Determine which table to use
  const table = type === 'verification' ? 'email_verifications' : 'password_resets';
  
  const { error } = await supabase
    .from(table)
    .upsert(
      {
        user_id: userId,
        email: email,
        verification_code: otp,
        expires_at: expiresAt,
        is_used: false,
        created_at: nowPH().toISOString()
      },
      { onConflict: 'user_id' }
    );

  if (error) throw error;
  return { success: true };
};

  const verifyOTP = async (email, otp, type, markAsUsed = false) => {
    const normalizedEmail = email.trim().toLowerCase();

    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, is_verified')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return { valid: false, error: 'User not found' };
    }

    // For verification, check if already verified
    if (type === 'verification' && user.is_verified) {
      return { valid: false, error: 'Account is already verified' };
    }

    // Determine which table to use
    const table = type === 'verification' ? 'email_verifications' : 'password_resets';

    // Get OTP record
    const { data: otpRecord, error: otpError } = await supabase
      .from(table)
      .select('id, verification_code, expires_at, is_used')
      .eq('user_id', user.id)
      .single();

    if (otpError || !otpRecord) {
      return { valid: false, error: 'Invalid or expired code' };
    }

    // Check if used
    if (otpRecord.is_used) {
      return { valid: false, error: 'This code has already been used' };
    }

    // Check expiration
    const currentTime = nowPH();
    const expiresTime = toPH(otpRecord.expires_at);
    const timeDiff = expiresTime.diff(currentTime);

    if (timeDiff <= 0) {
      return { valid: false, error: 'Verification code has expired' };
    }

    // Check code match
    const dbCode = String(otpRecord.verification_code).trim();
    const userCode = String(otp).trim();

    if (dbCode !== userCode) {
      return { valid: false, error: 'Invalid code' };
    }

    // ✅ Only mark as used if markAsUsed is true
    if (markAsUsed) {
      const { error: markError } = await supabase
        .from(table)
        .update({ is_used: true, used_at: nowPH().toISOString() })
        .eq('id', otpRecord.id);

      if (markError) throw markError;
    }

    return { valid: true, userId: user.id };
  };

// Resend OTP (Unified)
const resendOTP = async (email, type) => {
  const normalizedEmail = email.trim().toLowerCase();

  // Find user
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, is_verified')
    .ilike('email', normalizedEmail)
    .single();

  if (userError || !user) {
    return { success: false, error: 'User not found' };
  }

  // For verification, check if already verified
  if (type === 'verification' && user.is_verified) {
    return { success: false, error: 'Account is already verified' };
  }

  // Generate new OTP
  const otp = generateOTP();
  await storeOTP(user.id, normalizedEmail, otp, type);
  await sendOTPEmail(normalizedEmail, otp, type);

  return { success: true };
};

module.exports = {
  generateOTP,
  sendOTPEmail,
  storeOTP,
  verifyOTP,
  resendOTP,
  nowPH,
  toPH
};