// services/businessDayService.js
//
// Owns all reads/writes to business_days. Three states per date:
// UNCONFIRMED (default — no row at all), CONFIRMED_OPEN (a valid sales
// upload landed on that date), CONFIRMED_CLOSED (the owner explicitly
// marked the store closed for that date). Never write a row for
// 'unconfirmed' as a matter of course — its absence IS the state.
//
// A closed day is recorded here and nowhere else. Never fill a closed day
// with sales or zeros in daily_sales.
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { fetchAllRows } = require('../utils/fetchAllRows');
const { supabaseAdmin, isConfigured } = require('../config/supabase');
const { logAction } = require('./auditService');
const {
  evaluateHistoryGate,
  validateClosableDates,
  weekdayOf,
} = require('../utils/historyGate');

dayjs.extend(utc);
dayjs.extend(timezone);
const PH_TZ = 'Asia/Manila';

// .in() puts every value in the request URL. Keep each call well under
// URL length limits (a full year of dates is ~4 KB of URL).
const IN_CHUNK = 200;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

class BusinessDayService {
  // client/audit are injectable so tests can run against an in-memory fake
  // instead of the live database. Production uses the defaults.
  constructor({ client = supabaseAdmin, configured = isConfigured, audit = logAction } = {}) {
    this.client = client;
    this.configured = configured;
    this.audit = audit;
  }

  isReady() {
    return Boolean(this.configured && this.client && typeof this.client.from === 'function');
  }

  // The business's calendar date right now (Asia/Manila), 'YYYY-MM-DD'.
  today() {
    return dayjs().tz(PH_TZ).format('YYYY-MM-DD');
  }

  // Marks each date in `saleDates` as confirmed_open. Called after a
  // successful sales upload — every distinct sale_date present in that
  // upload genuinely means the store was open that day.
  //
  // An upload always wins over a closed mark: if a date was confirmed
  // closed and a sales file for it arrives later, it becomes
  // confirmed_open. That flip is logged, because it usually means the
  // owner marked a day closed that actually had sales.
  async confirmOpenDates(saleDates = []) {
    if (!this.isReady()) return { updated: 0, reopened: [] };

    const uniqueDates = [...new Set(saleDates.filter(Boolean))];
    if (uniqueDates.length === 0) return { updated: 0, reopened: [] };

    const reopened = [];
    for (const part of chunk(uniqueDates, IN_CHUNK)) {
      const { data, error } = await this.client
        .from('business_days')
        .select('business_date')
        .eq('status', 'confirmed_closed')
        .in('business_date', part);
      if (error) {
        console.error('Error checking business_days for closed dates before reopening:', error);
        throw error;
      }
      for (const row of data || []) reopened.push(row.business_date);
    }

    const nowIso = new Date().toISOString();
    const rows = uniqueDates.map((business_date) => ({
      business_date,
      is_open: true,
      status: 'confirmed_open',
      source: 'sales_upload',
      confirmed_at: nowIso
    }));

    const { error } = await this.client
      .from('business_days')
      .upsert(rows, { onConflict: 'business_date' });

    if (error) {
      console.error('Error upserting business_days (confirmed_open):', error);
      throw error;
    }

    if (reopened.length > 0) {
      reopened.sort();
      console.warn(`[business_days] ${reopened.length} date(s) were marked closed but a sales upload has them — now open:`, reopened);
      await this.audit(
        'business_day_reopened_by_upload',
        `${reopened.length} date(s) marked closed had sales in an upload and were changed to open: ${reopened.slice(0, 20).join(', ')}${reopened.length > 20 ? ', …' : ''}`,
        null
      );
    }

    return { updated: rows.length, reopened };
  }

  // Same as confirmOpenDates, but derives the date list from an
  // upload_id instead of requiring the caller to already have the
  // distinct sale dates on hand.
  async confirmOpenDatesForUpload(uploadId) {
    if (!this.isReady() || !uploadId) return { updated: 0, reopened: [] };

    // Paged: a first-time history upload can hold thousands of rows.
    const { data, error } = await fetchAllRows(() => this.client
      .from('daily_sales')
      .select('sale_date')
      .eq('upload_id', uploadId)
      .order('sale_date')
      .order('product_id'));

    if (error) {
      console.error('Error reading daily_sales to confirm business_days:', error);
      throw error;
    }

    return this.confirmOpenDates((data || []).map((row) => row.sale_date));
  }

  // Everything the first-use history rule needs, read from ALL of
  // daily_sales and business_days — the same data ml-service's /train
  // reads (data_loader.get_history_gate_inputs), so the dashboard and a
  // real training call always decide the same way.
  async getHistoryCoverage() {
    if (!this.isReady()) {
      return { saleDates: [], closedDates: [], gate: evaluateHistoryGate({}) };
    }

    const [sales, closed] = await Promise.all([
      fetchAllRows(() => this.client
        .from('daily_sales')
        .select('sale_date')
        .order('sale_date')
        .order('product_id')),
      fetchAllRows(() => this.client
        .from('business_days')
        .select('business_date')
        .eq('status', 'confirmed_closed')
        .order('business_date')),
    ]);
    if (sales.error) throw sales.error;
    if (closed.error) throw closed.error;

    const saleDates = [...new Set((sales.data || []).map((r) => r.sale_date).filter(Boolean))].sort();
    const closedDates = [...new Set((closed.data || []).map((r) => r.business_date).filter(Boolean))].sort();
    return { saleDates, closedDates, gate: evaluateHistoryGate({ saleDates, closedDates }) };
  }

  // Dates inside the sales history with no sales and no closed mark — the
  // list the owner reviews in the one-time "mark as closed" step.
  async getGapDates() {
    const { gate } = await this.getHistoryCoverage();
    return {
      firstSaleDate: gate.firstSaleDate,
      lastSaleDate: gate.lastSaleDate,
      spanDays: gate.spanDays,
      openDays: gate.openDays,
      closedDays: gate.closedDays,
      unconfirmedDays: gate.unconfirmedDays,
      gapDates: gate.unconfirmedDates.map((date) => ({ date, weekday: weekdayOf(date) })),
    };
  }

  // The owner marks a list of past dates closed. All-or-nothing: if any
  // date fails validation, nothing is saved and every problem is returned.
  // Idempotent: marking an already-closed date closed again is a no-op
  // that still succeeds.
  //
  // Refused: dates with sales, future dates, dates outside the sales
  // history, malformed dates, and batches over MAX_CLOSE_BATCH.
  async bulkConfirmClosed(dates, { today = this.today() } = {}) {
    if (!this.isReady()) throw new Error('Supabase is not configured');

    const { saleDates, closedDates } = await this.getHistoryCoverage();
    const check = validateClosableDates(dates, { saleDates, today });
    if (!check.ok) {
      return { ok: false, errors: check.errors, closed: [], alreadyClosed: [] };
    }

    const closedSet = new Set(closedDates);
    const alreadyClosed = check.dates.filter((d) => closedSet.has(d));
    const toClose = check.dates.filter((d) => !closedSet.has(d));

    if (toClose.length > 0) {
      const nowIso = new Date().toISOString();
      const rows = toClose.map((business_date) => ({
        business_date,
        is_open: false,
        status: 'confirmed_closed',
        source: 'manual_confirmation',
        confirmed_at: nowIso
      }));
      const { error } = await this.client
        .from('business_days')
        .upsert(rows, { onConflict: 'business_date' });
      if (error) {
        console.error('Error upserting business_days (bulk confirmed_closed):', error);
        throw error;
      }
    }

    return { ok: true, errors: [], closed: toClose, alreadyClosed };
  }

  // The single-date "Mark Store as Closed" action. Goes through the same
  // checks as the bulk path so neither door can mark a sales day closed.
  async confirmClosedDate(businessDate, { today = this.today() } = {}) {
    return this.bulkConfirmClosed([businessDate], { today });
  }

  // business_days rows in [fromDate, toDate]. Dates with no row are
  // implicitly unconfirmed — callers must treat a missing date as
  // unconfirmed themselves; this only returns rows that actually exist.
  // Paged: one row per calendar day, so this passes 1,000 rows after
  // about 2.7 years of history.
  async getRange(fromDate, toDate) {
    if (!this.isReady()) return [];

    const { data, error } = await fetchAllRows(() => {
      let query = this.client
        .from('business_days')
        .select('*')
        .order('business_date', { ascending: true });
      if (fromDate) query = query.gte('business_date', fromDate);
      if (toDate) query = query.lte('business_date', toDate);
      return query;
    });
    if (error) {
      console.error('Error fetching business_days range:', error);
      throw error;
    }
    return data || [];
  }
}

module.exports = new BusinessDayService();
module.exports.BusinessDayService = BusinessDayService;
