// utils/passwordPolicy.js
//
// Shared by create-password (routes/auth.js) and resetPassword
// (controllers/passwordResetController.js) — was previously just
// `password.length < 8` in both places, which accepts things like
// "aaaaaaaa". Requires at least one lowercase, one uppercase, and one
// digit on top of the 8-character minimum.
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include at least one uppercase letter, one lowercase letter, and one number';
  }
  return null;
}

module.exports = { validatePassword };
