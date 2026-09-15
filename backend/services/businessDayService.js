// services/businessDayService.js
//
// Owns all reads/writes to business_days. Three states per date:
// UNCONFIRMED (default — no row at all), CONFIRMED_OPEN (a valid sales
// upload landed on that date), CONFIRMED_CLOSED (the owner explicitly
// marked the store closed for that date). Never write a row for
// 'unconfirmed' as a matter of course — its absence IS the state.
const { supabaseAdmin, isConfigured } = require('../config/supabase');

class BusinessDayService {
  isReady() {
    return Boolean(isConfigured && supabaseAdmin && typeof supabaseAdmin.from === 'function');
  }

  // Marks each date in `saleDates` as confirmed_open. Called after a
  // successful sales upload — every distinct sale_date present in that
  // upload genuinely means the store was open that day.
  async confirmOpenDates(saleDates = []) {
    if (!this.isReady()) return { updated: 0 };

    const uniqueDates = [...new Set(saleDates.filter(Boolean))];
    if (uniqueDates.length === 0) return { updated: 0 };

    const nowIso = new Date().toISOString();
    const rows = uniqueDates.map((business_date) => ({
      business_date,
      is_open: true,
      status: 'confirmed_open',
      source: 'sales_upload',
      confirmed_at: nowIso
    }));

    const { error } = await supabaseAdmin
      .from('business_days')
      .upsert(rows, { onConflict: 'business_date' });

    if (error) {
      console.error('Error upserting business_days (confirmed_open):', error);
      throw error;
    }
    return { updated: rows.length };
  }

  // Same as confirmOpenDates, but derives the date list from an
  // upload_id instead of requiring the caller to already have the
  // distinct sale dates on hand.
  async confirmOpenDatesForUpload(uploadId) {
    if (!this.isReady() || !uploadId) return { updated: 0 };

    const { data, error } = await supabaseAdmin
      .from('daily_sales')
      .select('sale_date')
      .eq('upload_id', uploadId);

    if (error) {
      console.error('Error reading daily_sales to confirm business_days:', error);
      throw error;
    }

    return this.confirmOpenDates((data || []).map((row) => row.sale_date));
  }

  // The owner's explicit "Mark Store as Closed" action for one date.
  async confirmClosedDate(businessDate) {
    if (!this.isReady()) {
      throw new Error('Supabase is not configured');
    }
    if (!businessDate) {
      throw new Error('businessDate is required');
    }

    const { data, error } = await supabaseAdmin
      .from('business_days')
      .upsert(
        {
          business_date: businessDate,
          is_open: false,
          status: 'confirmed_closed',
          source: 'manual_confirmation',
          confirmed_at: new Date().toISOString()
        },
        { onConflict: 'business_date' }
      )
      .select()
      .single();

    if (error) {
      console.error('Error upserting business_days (confirmed_closed):', error);
      throw error;
    }
    return data;
  }

  // business_days rows in [fromDate, toDate]. Dates with no row are
  // implicitly unconfirmed — callers must treat a missing date as
  // unconfirmed themselves; this only returns rows that actually exist.
  async getRange(fromDate, toDate) {
    if (!this.isReady()) return [];

    let query = supabaseAdmin
      .from('business_days')
      .select('*')
      .order('business_date', { ascending: true });

    if (fromDate) query = query.gte('business_date', fromDate);
    if (toDate) query = query.lte('business_date', toDate);

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching business_days range:', error);
      throw error;
    }
    return data || [];
  }
}

module.exports = new BusinessDayService();
