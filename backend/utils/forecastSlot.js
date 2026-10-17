// utils/forecastSlot.js
//
// "Today's 9:00 AM forecast" in one place, shared by the forecast
// scheduler (jobs/forecastScheduler.js: external trigger + boot catch-up)
// and the restock email (services/notificationService.js: the first email
// of the day waits for today's 9:00 run).
//
// forecast_runs is the record (ml-service writes a row after a successful
// /forecast): a run_at at/after today's 9:00 AM Manila means today's slot
// has run. An earlier manual run does not count.

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const PH_TZ = 'Asia/Manila';
const FORECAST_HOUR = 9;

// Monday runs the weekly 7-day forecast; every other day the daily one.
function forecastSlotFor(now = new Date()) {
  const manila = dayjs(now).tz(PH_TZ);
  const isMonday = manila.day() === 1;
  const today = manila.format('YYYY-MM-DD');
  return {
    today,
    runType: isMonday ? 'weekly' : 'daily',
    horizonDays: isMonday ? 7 : 1,
    // Today's 9:00 AM Manila as an ISO instant (UTC).
    slotStart: dayjs.tz(`${today} 0${FORECAST_HOUR}:00`, PH_TZ).toISOString(),
    pastSlot: manila.hour() >= FORECAST_HOUR,
  };
}

// The newest forecast_runs row at/after slotStart, or null.
async function forecastRanSince(client, slotStart) {
  const { data, error } = await client
    .from('forecast_runs')
    .select('id, run_at, run_type')
    .gte('run_at', slotStart)
    .order('run_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

module.exports = { forecastSlotFor, forecastRanSince, FORECAST_HOUR, PH_TZ };
