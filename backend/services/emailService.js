// services/emailService.js
//
// One way to send email: the Brevo HTTP API. Moved out of otpService.js
// (Oct 14 2026) so OTP emails and reminder emails share it.
//
//   sendEmail({ to, subject, html, text }) -> { messageId }
//
// Needs BREVO_API_KEY and BREVO_SENDER_EMAIL (BREVO_SENDER_NAME optional,
// default "ChefDuo"). Gives up after 10 s, so a slow Brevo can never hang a
// request. Never logs the API key, the body or the full address.

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const EMAIL_TIMEOUT_MS = 10000;

class EmailNotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

function isEmailConfigured(env = process.env) {
  return Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL);
}

// A plain sanity check, not full RFC 5322: one @, a dot in the domain, no spaces.
function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// "noreply@gmail.com" -> "n***@gmail.com". For logs and API responses.
function maskEmail(value) {
  if (!isValidEmail(value)) return '(invalid)';
  const [local, domain] = value.trim().split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.BREVO_API_KEY) {
    throw new EmailNotConfiguredError('BREVO_API_KEY is not set');
  }
  if (!process.env.BREVO_SENDER_EMAIL) {
    throw new EmailNotConfiguredError('BREVO_SENDER_EMAIL is not set');
  }

  const body = {
    sender: {
      name: process.env.BREVO_SENDER_NAME || 'ChefDuo',
      email: process.env.BREVO_SENDER_EMAIL,
    },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (text) body.textContent = text;

  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
  });

  if (!response.ok) {
    let errorBody = {};
    try {
      errorBody = await response.json();
    } catch (_) {
      // ignore parse failure, fall back to status text below
    }
    // Do not log the API key or the request body here.
    throw new Error(
      `Brevo send failed (${response.status} ${response.statusText}): ${JSON.stringify(errorBody)}`
    );
  }

  return response.json(); // { messageId: "..." }
}

module.exports = {
  sendEmail,
  isEmailConfigured,
  isValidEmail,
  maskEmail,
  EmailNotConfiguredError,
  EMAIL_TIMEOUT_MS,
  BREVO_API_URL,
};
