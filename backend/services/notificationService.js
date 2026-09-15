// services/notificationService.js
const { supabaseAdmin } = require('../config/supabase');

// Insert a row into the `notifications` table for a specific user.
// Returns the created row, or null if the user is unknown / the insert failed.
const createNotification = async ({ userId, type = 'info', title, message, link = null, metadata = null }) => {
  if (!userId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .insert([{ user_id: userId, type, title, message, link, metadata }])
      .select()
      .single();
    if (error) {
      console.error('Error creating notification:', error);
      return null;
    }
    return data;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
};

// Reconcile low-stock / out-of-stock alerts for every user, based on the
// ingredients table (quantity vs min_stock). This is "dynamic" in both
// directions:
//   - new alerts are created for ingredients that just went low,
//   - alerts for ingredients that recovered are automatically marked read,
//   - ingredients that are still low are NOT re-notified (no duplicates).
const refreshLowStockNotifications = async () => {
  try {
    const { data: ingredients, error: ingError } = await supabaseAdmin
      .from('ingredients')
      .select('id, name, quantity, min_stock, unit')
      .eq('is_archived', false);

    if (ingError) throw ingError;

    // Desired alerts: key = `low_<id>` or `out_<id>` (stored in metadata.key so
    // recovered alerts can be matched and retired).
    const desired = {};
    const setDesired = (ingredient, key, title, message) => {
      if (!desired[key]) {
        desired[key] = { ingredientId: ingredient.id, title, message };
      }
    };

    for (const ingredient of ingredients || []) {
      const quantity = Number(ingredient.quantity) || 0;
      const minStock = Number(ingredient.min_stock) || 0;
      const name = ingredient.name || `ingredient #${ingredient.id}`;
      const unit = ingredient.unit || '';

      if (quantity === 0) {
        setDesired(
          ingredient,
          `out_${ingredient.id}`,
          `Out of stock: ${name}`,
          `${name} has 0 units left and needs to be restocked.`
        );
      } else if (quantity <= minStock) {
        setDesired(
          ingredient,
          `low_${ingredient.id}`,
          `Low stock: ${name}`,
          `${name} is down to ${quantity} ${unit} (minimum ${minStock}). Consider restocking soon.`
        );
      }
    }

    const { data: users, error: userError } = await supabaseAdmin
      .from('user')
      .select('id');

    if (userError) throw userError;

    for (const user of users || []) {
      // All of this user's current unread inventory alerts.
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('notifications')
        .select('id, metadata')
        .eq('user_id', user.id)
        .eq('type', 'warning')
        .eq('read', false)
        .limit(500);

      if (existingError) throw existingError;

      const missing = new Set(Object.keys(desired));

      for (const notification of existing || []) {
        const key = notification.metadata?.key;
        const kind = notification.metadata?.kind;

        if (kind === 'restock_summary') {
          // Retire the previous aggregate reminder so there is always exactly
          // one fresh "restock alert for N ingredients" per user.
          await supabaseAdmin
            .from('notifications')
            .update({ read: true, updated_at: new Date() })
            .eq('id', notification.id);
          continue;
        }

        if (key && desired[key]) {
          // Still low — leave it unread, don't notify again.
          missing.delete(key);
        } else if (key && (key.startsWith('low_') || key.startsWith('out_'))) {
          // No longer low — retire the alert.
          await supabaseAdmin
            .from('notifications')
            .update({ read: true, updated_at: new Date() })
            .eq('id', notification.id);
        }
      }

      for (const key of missing) {
        const item = desired[key];
        await createNotification({
          userId: user.id,
          type: 'warning',
          title: item.title,
          message: item.message,
          link: '/ingredient-management',
          metadata: { kind: 'low_stock', key, ingredient_id: item.ingredientId },
        });
      }

      // Aggregate "Restock reminder for N ingredients" alert.
      const alertCount = Object.keys(desired).length;
      if (alertCount > 0) {
        await createNotification({
          userId: user.id,
          type: 'warning',
          title: `Restock reminder: ${alertCount} ingredient${alertCount > 1 ? 's' : ''} need attention`,
          message: `${alertCount} ingredient(s) are low or out of stock. Open Ingredient Management to restock them.`,
          link: '/ingredient-management',
          metadata: { kind: 'restock_summary' },
        });
      }
    }
  } catch (error) {
    console.error('Error refreshing low-stock notifications:', error);
  }
};

module.exports = { createNotification, refreshLowStockNotifications };