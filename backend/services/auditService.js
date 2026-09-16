// services/auditService.js
// Writes a human-readable audit trail to the `audit_logs` table.
// `action_type` is a short machine label (e.g. "price_recorded");
// `details` is the free-text human description, and `actor` is stored in
// its own `performed_by` column.
// Logging failures are never fatal — the caller's action still succeeds.
const { supabaseAdmin } = require('../config/supabase');

const logAction = async (actionType, details = null, actor = null) => {
  try {
    const { error } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        action_type: String(actionType).slice(0, 100),
        details: details ? String(details).slice(0, 2000) : null,
        performed_by: actor ? String(actor).slice(0, 255) : null
      });

    if (error) {
      console.error('Audit log insert error:', error.message);
    }
  } catch (err) {
    console.error('Audit logging failed:', err.message);
  }
};

module.exports = { logAction };