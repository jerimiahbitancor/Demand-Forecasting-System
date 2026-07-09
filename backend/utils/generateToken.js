// utils/generateToken.js
const jwt = require('jsonwebtoken');

const generateToken = (user) => {
  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  const expires_at = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  return { access_token: token, expires_at };
};

module.exports = generateToken;