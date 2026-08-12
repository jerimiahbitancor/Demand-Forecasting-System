// services/otpService.js
const { supabase, supabaseAdmin } = require('../config/supabase');
const nodemailer = require('nodemailer');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TZ = 'Asia/Manila';
const OTP_EXPIRATION_MINUTES = 3;

const nowPH = () => dayjs().tz(PH_TZ);
const toPH = (dbTimestamp) => {
  if (!dbTimestamp) return dayjs();
  const hasOffset = /Z|[+-]\d{2}:\d{2}$/.test(dbTimestamp);
  const safe = hasOffset ? dbTimestamp : `${dbTimestamp}Z`;
  return dayjs(safe).tz(PH_TZ);
};

const toSafeISOString = (value) => {
  if (!value) return nowPH().toISOString();

  try {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return nowPH().toISOString();
    }
    return parsed.toISOString();
  } catch (error) {
    return nowPH().toISOString();
  }
};

const getOtpExpiryTime = () => nowPH().add(OTP_EXPIRATION_MINUTES, 'minute');

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

// Send OTP Email
const sendOTPEmail = async (email, otp, type) => {
  try {
    const transporter = createTransporter();
    
    const templates = {
      verification: {
        subject: 'Verify Your ChefDuo Account',
        title: 'Welcome to ChefDuo!',
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
      from: process.env.EMAIL_FROM,
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
              <h1>ChefDuo Demand Forecasting</h1>
            </div>
            <div class="content">
              <h2>${template.title}</h2>
              <p>${template.message}</p>
              <div class="otp-box">${otp}</div>
              <p><strong>This code will expire in ${OTP_EXPIRATION_MINUTES} minutes.</strong></p>
              <p>${template.footer}</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} ChefDuo Demand Forecasting. All rights reserved.</p>
              <p>This is an automated message, please do not reply.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    return { success: true };

  } catch (error) {
    throw new Error('Failed to send email: ' + error.message);
  }
};

// ✅ Store OTP (NO PASSWORD!)
const storeOTP = async (userId, email, otp, type) => {
  const expiresAt = toSafeISOString(getOtpExpiryTime());
  const table = type === 'verification' ? 'email_verifications' : 'password_resets';
  
  // ✅ First, mark ALL old OTPs as used (use admin client for writes)
  const { error: updateError } = await supabaseAdmin
    .from(table)
    .update({ 
      is_used: true,
      used_at: nowPH().toISOString()
    })
    .eq('user_id', userId)
    .eq('is_used', false);

  if (updateError) {
    console.error('Error marking old OTPs:', updateError);
  }

  // ✅ Then insert or upsert the NEW OTP (avoid unique constraint on user_id)
  const { data: upsertData, error: upsertError } = await supabaseAdmin
    .from(table)
    .upsert(
      {
        user_id: userId,
        email: email.trim().toLowerCase(),
        verification_code: otp,
        expires_at: expiresAt,
        is_used: false,
        used_at: null,
        created_at: nowPH().toISOString()
      },
      { onConflict: 'user_id' }
    );

  if (upsertError) {
    console.error('Error storing new OTP (upsert):', upsertError);
    throw upsertError;
  }

  console.log('Upsert result:', { table, upsertData });

  console.log('✅ New OTP stored for user:', userId, 'OTP:', otp);
  return { success: true };
};

// ✅ Verify OTP
const verifyOTP = async (email, otp, type, markAsUsed = false) => {
  const normalizedEmail = email.trim().toLowerCase();
  const trimmedOtp = String(otp).trim();

  const table = type === 'verification' ? 'email_verifications' : 'password_resets';

  const { data: otpRecord, error: otpError } = await supabaseAdmin
    .from(table)
    .select('*')
    .eq('email', normalizedEmail)
    .eq('is_used', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (otpError || !otpRecord) {
    return { valid: false, error: 'No verification code found. Please request a new one.' };
  }

  // Check if expires_at exists
  if (!otpRecord.expires_at) {
    return { valid: false, error: 'Invalid OTP record. Please request a new one.' };
  }

  const currentTime = nowPH();
  const expiresTime = toPH(otpRecord.expires_at);
  
  if (expiresTime.isBefore(currentTime)) {
    return { valid: false, error: 'Verification code has expired' };
  }

  const dbCode = String(otpRecord.verification_code).trim();

  if (dbCode !== trimmedOtp) {
    return { valid: false, error: 'Invalid verification code' };
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from('user')
    .select('id, is_verified')
    .eq('id', otpRecord.user_id)
    .single();

  if (userError || !user) {
    return { valid: false, error: 'User not found' };
  }

  if (type === 'verification' && user.is_verified) {
    return { valid: false, error: 'Account is already verified' };
  }

  if (markAsUsed) {
    const { error: markError } = await supabaseAdmin
      .from(table)
      .update({ 
        is_used: true, 
        used_at: nowPH().toISOString() 
      })
      .eq('id', otpRecord.id);

    if (markError) {
      throw markError;
    }
  }

  return { 
    valid: true, 
    userId: user.id,
    record: otpRecord
  };
};

// ✅ Resend OTP
const resendOTP = async (email, userId, type) => {
  const normalizedEmail = email.trim().toLowerCase();

  const { data: user, error: userError } = await supabaseAdmin
    .from('user')
    .select('id, is_verified')
    .eq('id', userId)
    .eq('email', normalizedEmail)
    .single();

  if (userError || !user) {
    return { success: false, error: 'User not found' };
  }

  if (type === 'verification' && user.is_verified) {
    return { success: false, error: 'Account is already verified' };
  }

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
  toPH,
  toSafeISOString,
  getOtpExpiryTime
};