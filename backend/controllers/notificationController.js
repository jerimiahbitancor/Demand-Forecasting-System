const { supabaseAdmin } = require('../config/supabase');

class NotificationController {
  static async list(req, res) {
    try {
      const userId = req.user?.user_id;
      if (!userId) return res.status(400).json({ success: false, error: 'User not resolved' });

      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
      const read = req.query.read; // 'all' | 'unread' | 'read' | undefined

      let dataQuery = supabaseAdmin
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      let countQuery = supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (read === 'unread') {
        dataQuery = dataQuery.eq('read', false);
        countQuery = countQuery.eq('read', false);
      } else if (read === 'read') {
        dataQuery = dataQuery.eq('read', true);
        countQuery = countQuery.eq('read', true);
      }

      const from = (page - 1) * limit;
      dataQuery = dataQuery.range(from, from + limit - 1);

      const [dataResult, countResult, unreadResult] = await Promise.all([
        dataQuery,
        countQuery,
        supabaseAdmin
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('read', false)
      ]);

      const { data, error } = dataResult;
      if (error) throw error;

      const { count, error: countError } = countResult;
      if (countError) throw countError;

      const { count: unreadCount, error: unreadError } = unreadResult;
      if (unreadError) throw unreadError;

      const total = count || 0;
      const totalPages = Math.max(Math.ceil(total / limit), 1);

      res.json({
        success: true,
        data: data || [],
        total,
        page,
        limit,
        totalPages,
        unreadCount: unreadCount || 0
      });
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
