// utils/otpAttemptLimiter.js
//
// The OTP verify endpoints (registration's /verify-otp, password reset's
// verifyCode) had no limit on how many codes could be guessed against a
// given email — only the blanket 100-req/15min-per-IP global limiter in
// server.js applied, which doesn't stop a script guessing a 6-digit code
// for one specific email address across many IPs (or a proxy pool). This
// is an in-memory per-email lockout, same pattern as the
// processingUploads/trainingInFlight in-memory guards already used
// elsewhere in this codebase — resets on server restart, which is an
// acceptable tradeoff at capstone/single-owner scale, same as those.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new Map(); // normalized email -> { count, windowStart }

function isLockedOut(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(key) {
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: Date.now() });
    return;
  }
  entry.count += 1;
}

function resetAttempts(key) {
  attempts.delete(key);
}

module.exports = { isLockedOut, recordFailedAttempt, resetAttempts, MAX_ATTEMPTS, WINDOW_MS };
