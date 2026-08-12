// backend/controllers/businessProfile.js
const { supabaseAdmin } = require('../config/supabase');

const SUPABASE_URL = process.env.SUPABASE_URL;
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

class BusinessProfileController {
  // GET /api/settings/business-profile
  static async get(req, res) {
    try {
      const token = req.accessToken;
      if (!token) {
        return res.status(401).json({ success: false, error: 'Missing access token' });
      }

      const { data, error } = await supabaseAdmin
        .from('business_profile')
        .select('*')
        .limit(1)
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

      const { data: existingRow, error: existingError } = await supabaseAdmin
        .from('business_profile')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      const row = {
        ...toDbRow(req.body),
        updated_at: new Date(),
      };

      let result;
      if (existingRow?.id) {
        const { data, error } = await supabaseAdmin
          .from('business_profile')
          .update(row)
          .eq('id', existingRow.id)
          .select()
          .single();
        result = { data, error };
      } else {
        const { data, error } = await supabaseAdmin
          .from('business_profile')
          .insert(row)
          .select()
          .single();
        result = { data, error };
      }

      const { data, error } = result;

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

      const { data: userRow, error: userRowError } = await supabaseAdmin
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

      const { data, error } = await supabaseAdmin
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