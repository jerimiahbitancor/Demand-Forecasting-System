// backend/controllers/businessProfile.js
const { supabase } = require('../config/supabase');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const LOGO_BUCKET = 'business-logo';

// The DB schema now matches the frontend's field names exactly
// (business_name, business_address, business_email,
// business_contact_number) — so the only real translation left is
// logo (frontend/API) <-> logo_url (DB column).
function toDbRow(payload) {
  const row = {
    business_name: payload.business_name,
    business_address: payload.business_address,
    business_email: payload.business_email || null,
    business_contact_number: payload.business_contact_number || null,
  };
  if (payload.logo !== undefined) {
    row.logo_url = payload.logo;
  }
  return row;
}

function toApiShape(row) {
  if (!row) return null;
  return {
    business_name: row.business_name,
    business_address: row.business_address,
    business_email: row.business_email,
    business_contact_number: row.business_contact_number,
    logo: row.logo_url,
    updated_at: row.updated_at,
  };
}

// Used for business_profile reads/writes — PostgREST reliably forwards
// this client's global Authorization header, so this pattern is fine here.
function userScopedClient(req) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${req.accessToken}` } },
  });
}

class BusinessProfileController {
  // GET /api/settings/business-profile
  static async get(req, res) {
    try {
      const token = req.accessToken;
      if (!token) {
        return res.status(401).json({ success: false, error: 'Missing access token' });
      }

      const numericUserId = req.user?.user_id;
      if (!numericUserId) {
        return res.json({ success: true, data: null });
      }

      const userClient = userScopedClient(req);
      const { data, error } = await userClient
        .from('business_profile')
        .select('*')
        .eq('user_id', numericUserId)
        .maybeSingle();

      if (error) throw error;

      res.json({ success: true, data: toApiShape(data) });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to load business profile: ' + error.message,
      });
    }
  }

  // POST /api/settings/business-profile (upsert on user_id)
  static async save(req, res) {
    const { business_name, business_address } = req.body;

    if (!business_name || !business_address) {
      return res.status(400).json({
        success: false,
        error: 'Business name and address are required',
      });
    }

    try {
      const token = req.accessToken;
      if (!token) {
        return res.status(401).json({ success: false, error: 'Missing access token' });
      }

      const numericUserId = req.user?.user_id;
      if (!numericUserId) {
        return res.status(400).json({ success: false, error: 'User not found in users table' });
      }

      const userClient = userScopedClient(req);
      const row = {
        ...toDbRow(req.body),
        user_id: numericUserId,
        updated_at: new Date(),
      };

      const { data, error } = await userClient
        .from('business_profile')
        .upsert(row, { onConflict: 'user_id' })
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        message: 'Business profile saved.',
        data: toApiShape(data),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to save business profile: ' + error.message,
      });
    }
  }

  // POST /api/settings/business-profile/logo  (multipart, field name "logo")
  //
  // Uses the Supabase Storage client with the user's JWT so Storage RLS
  // policies run in the authenticated user context instead of via service role.
  static async uploadLogo(req, res) {
    try {
      const token = req.accessToken;
      if (!token) {
        return res.status(401).json({ success: false, error: 'Missing access token' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' });
      }

      const userClient = userScopedClient(req);

      const { data: userRow, error: userRowError } = await userClient
        .from('user')
        .select('id')
        .eq('auth_id', req.user?.auth_id || req.user?.id)
        .maybeSingle();

      if (userRowError) {
        throw userRowError;
      }

      const numericUserId = userRow?.id;
      if (!numericUserId) {
        return res.status(400).json({ success: false, error: 'User record not found for authenticated user' });
      }

      const ext = req.file.originalname.split('.').pop().toLowerCase();
      const objectPath = `${numericUserId}/logo.${ext}`;
      console.log('Uploading logo to path:', objectPath, 'for auth_id:', req.user?.auth_id);

      const { data, error } = await userClient
        .storage
        .from(LOGO_BUCKET)
        .upload(objectPath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (error) {
        throw new Error(`Storage upload failed: ${error.message}`);
      }

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${objectPath}`;
      res.json({ success: true, url: publicUrl, data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to upload logo: ' + error.message,
      });
    }
  }
}

module.exports = BusinessProfileController;