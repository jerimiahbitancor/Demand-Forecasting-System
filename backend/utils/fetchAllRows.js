// PAGING HELPER — reads every matching row, one page at a time.
//
// Supabase returns at most 1,000 rows per request (the project's
// "Max rows" setting, kept on purpose as a safety limit). A plain query
// that matches more rows than that does NOT fail — it silently returns
// only the first 1,000. This helper asks for rows 0-999, then
// 1000-1999, and so on, until a page comes back EMPTY.
//
// Stopping on an empty page (not on "page shorter than 1,000") keeps it
// correct even if Max rows is later lowered (e.g. to 500).
//
// Usage — pass a function that builds a FRESH query each call, with a
// fixed ORDER BY (so pages never overlap or skip rows):
//
//   const { data, error } = await fetchAllRows(() =>
//     supabaseAdmin.from('daily_sales')
//       .select('product_id, sale_date')
//       .order('sale_date')
//       .order('product_id'));
//
// Returns { data, error } — the same shape as a normal Supabase call,
// so existing code that destructures the result keeps working.
async function fetchAllRows(buildQuery, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) return { data: null, error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    offset += data.length;
  }
  return { data: rows, error: null };
}

module.exports = { fetchAllRows };
