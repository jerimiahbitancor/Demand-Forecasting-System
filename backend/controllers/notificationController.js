const { supabaseAdmin } = require('../config/supabase');

class NotificationController {
  static async list(req, res) {
    try {
      const userId = req.user?.user_id;
      if (!userId) return res.status(400).json({ success: false, error: 'User not resolved' });

      const limit = parseInt(req.query.limit, 10) || 10;

      const { data, error } = await supabaseAdmin
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      const { count, error: countError } = await supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

      if (countError) throw countError;

      res.json({ success: true, data: data || [], unreadCount: count || 0 });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to load notifications: ' + error.message });
    }
  }

  static async unreadCount(req, res) {
    try {
      const userId = req.user?.user_id;
      if (!userId) return res.status(400).json({ success: false, error: 'User not resolved' });

      const { count, error } = await supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) throw error;

      res.json({ success: true, count: count || 0 });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get unread count: ' + error.message });
    }
  }

  static async markAsRead(req, res) {
    try {
      const userId = req.user?.user_id;
      const { id } = req.params;
      if (!userId) return res.status(400).json({ success: false, error: 'User not resolved' });

      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ read: true, updated_at: new Date() })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to mark as read: ' + error.message });
    }
  }

  static async markAllAsRead(req, res) {
    try {
      const userId = req.user?.user_id;
      if (!userId) return res.status(400).json({ success: false, error: 'User not resolved' });

      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ read: true, updated_at: new Date() })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) throw error;

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to mark all as read: ' + error.message });
    }
  }

  static async clearAll(req, res) {
    try {
      const userId = req.user?.user_id;
      if (!userId) return res.status(400).json({ success: false, error: 'User not resolved' });

      const { error } = await supabaseAdmin
        .from('notifications')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to clear notifications: ' + error.message });
    }
  }
}

module.exports = NotificationController;
