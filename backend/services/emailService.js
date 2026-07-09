const nodemailer = require('nodemailer');

const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const createTransporter = () => {
  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
  return transporter;
};

const sendVerificationCode = async (email, verificationCode) => {
  try {
    const transporter = createTransporter();
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'ChefDuo - Password Reset Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #bb0114 0%, #8b0010 100%); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0;">ChefDuo</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Password Reset</p>
          </div>
          <div style="background: #f9f9f9; padding: 40px 20px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <p style="color: #333; font-size: 16px; margin-bottom: 20px;">
              Hi there! We received a request to reset your password.
            </p>
            <p style="color: #666; font-size: 14px; margin-bottom: 30px;">
              Use the verification code below to proceed:
            </p>
            <div style="background: white; border: 2px solid #bb0114; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
              <p style="color: #bb0114; font-size: 14px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 2px;">
                Verification Code
              </p>
              <p style="color: #333; font-size: 32px; font-weight: bold; margin: 0; letter-spacing: 4px;">
                ${verificationCode}
              </p>
            </div>
            <p style="color: #bb0114; font-size: 14px; font-weight: bold; margin: 30px 0 10px 0;">
              ⏱️ This code expires in 15 minutes
            </p>
            <p style="color: #666; font-size: 13px; line-height: 1.6; margin-bottom: 20px;">
              If you didn't request a password reset, you can safely ignore this email or contact our support team.
            </p>
            <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              This is an automated message, please do not reply to this email.
            </p>
          </div>
        </div>
      `,
    };
    const info = await transporter.sendMail(mailOptions);
    console.log('Verification email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    throw new Error('Failed to send verification email');
  }
};

module.exports = {
  generateVerificationCode,
  sendVerificationCode,
};