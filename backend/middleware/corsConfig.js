// middleware/corsConfig.js
//
// CORS options for the API. Moved out of server.js unchanged (same origin
// list, same Vercel preview pattern, same credentials/methods) so the real
// config can be tested without starting the whole server.

// ALLOWED_ORIGINS is a comma-separated list of exact origins (the prod
// domain, local dev). Falls back to the local Vite dev server.
function parseAllowedOrigins(value = process.env.ALLOWED_ORIGINS) {
  return (value || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// Vercel gives every preview deployment its own unique hashed subdomain
// (e.g. demand-forecasting-system-<hash>-<team>.vercel.app), so a static
// ALLOWED_ORIGINS entry can never match them. Allow any preview URL for
// THIS project specifically, rather than any *.vercel.app site.
const vercelPreviewPattern = /^https:\/\/demand-forecasting-system-[a-z0-9]+-[a-z0-9]+\.vercel\.app$/;

function createCorsOptions({ allowedOrigins = parseAllowedOrigins() } = {}) {
  return {
    origin: (origin, callback) => {
      // Same-origin / non-browser requests (curl, server-to-server) send no origin.
      if (!origin || allowedOrigins.includes(origin) || vercelPreviewPattern.test(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Not allowed by CORS: ${origin}`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    // Lets the browser app read these response headers: the request ID for
    // error reports, and Retry-After on a 429.
    exposedHeaders: ['X-Request-ID', 'Retry-After'],
  };
}

module.exports = { createCorsOptions, parseAllowedOrigins, vercelPreviewPattern };
