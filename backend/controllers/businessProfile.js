// backend/controllers/businessProfile.js
const { supabase } = require('../config/supabase');

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
  // Only touch logo_url if a logo was actually sent — otherwise an
  // upsert would null out an existing logo on every unrelated edit.
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
      const { data, error } = await supabase
        .from('business_profile')
        .select('*')
        .eq('user_id', req.user.id)
        .maybeSingle();

      if (error) throw error;

      // No row yet isn't an error — a brand-new user just hasn't saved a
      // profile. data: null tells the frontend to render an empty form.
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
      const row = {
        ...toDbRow(req.body),
        user_id: req.user.id,
        updated_at: new Date(),
      };

      const { data, error } = await supabase
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
}

module.exports = BusinessProfileController;