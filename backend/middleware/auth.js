// backend/middleware/auth.js
const { supabaseAdmin } = require('../config/supabase');

// Caches auth_id -> { customUser, customUserId } for CUSTOM_USER_CACHE_TTL_MS.
// Verifying the JWT locally (below) already removes the per-request network
// call to Supabase Auth; this cache removes the second per-request network
// call, the lookup against the custom "user" table.
//
// Single-user system (see CLAUDE.md), so a plain in-memory Map is fine —
// no Redis, no cross-instance invalidation needed. Tradeoff: a profile
// change (name/email/deletion) made through routes that don't call
// invalidateUserCache() below can take up to CUSTOM_USER_CACHE_TTL_MS to be
// reflected in req.user on OTHER in-flight requests. Anywhere the custom
// "user" row is updated or deleted should call
// `authenticate.invalidateUserCache(authId)` right after — see
// routes/users.js PUT/DELETE for the two existing call sites.
const CUSTOM_USER_CACHE_TTL_MS = 5 * 60 * 1000;
const customUserCache = new Map();

const getCachedCustomUser = (authId) => {
  const entry = customUserCache.get(authId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    customUserCache.delete(authId);
    return undefined;
  }
  return entry.value;
};

const setCachedCustomUser = (authId, value) => {
  customUserCache.set(authId, { value, expiresAt: Date.now() + CUSTOM_USER_CACHE_TTL_MS });
};

const invalidateUserCache = (authId) => {
  if (authId) customUserCache.delete(authId);
};

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided. Please login first.'
      });
    }

    const token = authHeader.split(' ')[1];

    // getClaims() verifies the JWT's signature itself instead of a network
    // round trip to supabase.auth.getUser() on every request — that call
    // was hitting Supabase's Auth API on EVERY authenticated endpoint, and
    // concurrent bulk operations (e.g. the 284-file historical sales
    // backfill) fired enough of them at once to get rate-limited/timed
    // out, which is what caused spurious 401s on unrelated endpoints like
    // /api/notifications during that flood.
    //
    // Why getClaims() and not a hand-rolled jsonwebtoken.verify(): this
    // Supabase project signs tokens with an asymmetric algorithm (ES256 —
    // check any access token's header, e.g. via jwt.io), not the legacy
    // HS256 shared-secret scheme. Verifying ES256 requires the project's
    // public signing key (fetched from Supabase's JWKS endpoint and
    // cached — no per-request network call once warm), not a static
    // secret. getClaims() does that automatically, and also transparently
    // falls back to a getUser()-style network call for a project still on
    // the old HS256 secret, so this keeps working if that ever changes.
    //
    // Tradeoff: this means a Supabase Auth user who gets deleted or banned
    // server-side (via the Supabase dashboard or another service) stays
    // "valid" here until their token naturally expires — we no longer ask
    // Supabase per-request whether the user still exists. For this project
    // (single owner account, no admin panel that bans/deletes users
    // out-of-band) that's an acceptable tradeoff. If a future feature adds
    // account suspension/deletion as a live operational concern, the
    // correct fix is a short-lived allow/deny cache refreshed by whatever
    // action does the suspending — not reverting to a per-request Supabase
    // call.
    const { data: claimsData, error: claimsError } = await supabaseAdmin.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      if (/expired/i.test(claimsError?.message || '')) {
        return res.status(401).json({
          success: false,
          error: 'Token expired. Please login again.'
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid token. Please login again.'
      });
    }

    const payload = claimsData.claims;
    const authId = payload.sub;
    if (!authId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token. Please login again.'
      });
    }

    const user = {
      id: authId,
      email: payload.email,
      user_metadata: payload.user_metadata || {},
      app_metadata: payload.app_metadata || {},
      aud: payload.aud,
      role: payload.role
    };

    let cached = getCachedCustomUser(authId);
    let customUser = cached?.customUser ?? null;
    let customUserId = cached?.customUserId ?? null;

    if (!cached) {
      try {
        const { data: userData, error: userError } = await supabaseAdmin
          .from('user')
          .select('*')
          .eq('auth_id', authId)
          .maybeSingle();

        if (!userError && userData) {
          customUser = userData;
          customUserId = userData.id;
          console.log('Custom user found:', customUserId);
        } else {
          console.log('No custom user found for auth_id:', authId);
          // Try to create user if not exists
          try {
            const { data: newUser, error: insertError } = await supabaseAdmin
              .from('user')
              .insert({
                auth_id: authId,
                email: user.email,
                name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User',
                // The JWT doesn't carry email_confirmed_at (that's a
                // Supabase Auth user-object field, not a token claim). By
                // the time a session reaches this app at all, the user
                // already went through this project's own OTP-verified
                // registration flow, so treat that as sufficient rather
                // than re-deriving a confirmation flag that isn't here.
                is_verified: true,
                verified_at: new Date().toISOString()
              })
              .select()
              .single();

            if (!insertError && newUser) {
              customUserId = newUser.id;
              customUser = newUser;
              console.log('Created custom user:', customUserId);
            }
          } catch (createError) {
            console.error('Error creating custom user:', createError);
          }
        }
      } catch (err) {
        console.error('Error fetching custom user:', err);
      }

      setCachedCustomUser(authId, { customUser, customUserId });
    }

    req.user = {
      ...user,
      ...customUser,
      id: customUserId || user.id,
      auth_id: user.id,
      user_id: customUserId
    };
    req.authUser = user;
    // Attach the raw access token so downstream handlers can create
    // a user-scoped Supabase client (so RLS policies run in user context)
    req.accessToken = token;

    console.log('User authenticated:', req.user.email);
    console.log('User ID (auth):', req.user.id);
    console.log('User user_id (custom):', req.user.user_id);
    next();

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

authenticate.invalidateUserCache = invalidateUserCache;

module.exports = authenticate;
