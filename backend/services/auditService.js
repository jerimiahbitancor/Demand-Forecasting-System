// services/auditService.js
// Writes a human-readable audit trail to the `system_actions_log` table.
// `action_type` is a short machine label (e.g. "price_recorded"); `details`
// carries the free-text human description including who performed the action.
// Logging failures are never fatal — the caller's action still succeeds.
const { supabaseAdmin } = require('../config/supabase');

const logAction = async (actionType, details = null, actor = null) => {
  try {
    const detail = actor
      ? `${details ? details + ' ' : ''}[by: ${actor}]`
      : details;

    const { error } = await supabaseAdmin
      .from('system_actions_log')
      .insert({
        action_type: String(actionType).slice(0, 100),
        details: detail ? String(detail).slice(0, 2000) : null
      });

    if (error) {
      console.error('Audit log insert error:', error.message);
    }
  } catch (err) {
    console.error('Audit logging failed:', err.message);
  }
};

module.exports = { logAction };