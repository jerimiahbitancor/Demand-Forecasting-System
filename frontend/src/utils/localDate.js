// utils/localDate.js
//
// Calendar dates picked in the browser, as "YYYY-MM-DD", in the browser's
// own (Manila) calendar. Never use date.toISOString().slice(0, 10) for this:
// a local-midnight Date in UTC+8 is the PREVIOUS day in UTC.

// Date (or anything new Date() accepts) -> "YYYY-MM-DD" in local time.
export function toYmd(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "YYYY-MM-DD" -> local-midnight Date (new Date("YYYY-MM-DD") alone is read
// as UTC midnight). Empty -> null.
export function fromYmd(ymd) {
  return ymd ? new Date(`${ymd}T00:00:00`) : null;
}

// "YYYY-MM-DD" -> the Monday of its Mon–Sun week, as "YYYY-MM-DD"
// (calendar math in UTC, so the browser's zone cannot shift it).
export function mondayOf(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const back = (t.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  t.setUTCDate(t.getUTCDate() - back);
  return t.toISOString().slice(0, 10);
}
