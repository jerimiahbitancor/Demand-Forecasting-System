// pdfLines.mjs
//
// Pure geometry -> text: turns pdf.js text items into one string per visual
// line. Items arrive as { str, x, y, width } in PDF user-space points (y
// grows upward), which is what pdf.js getTextContent exposes through each
// item's transform[4]/transform[5].
//
// Kept dependency-free and ESM so Node can unit-test the grouping without a
// browser, a worker, or a real PDF file.

// Vertical drift (points) still read as the same visual line. Baselines of
// one row wobble by at most ~2pt across columns; two real lines are 6pt+
// apart at receipt/price-list font sizes.
const SAME_LINE_TOLERANCE = 2.5;

// Horizontal gap (points) that earns a separating space between two
// segments of one line. Glyph runs that split a single word meet with a gap
// of ~0, while separate words/cells are a space- or tab-width apart.
const SPACE_GAP = 1.5;

export const groupPdfLines = (items) => {
  const usable = (items || []).filter(
    (item) => item && typeof item.str === "string" && item.str.trim().length > 0
  );

  // Top-to-bottom (larger y first), left-to-right within a row.
  const sorted = [...usable].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  let current = null;

  for (const item of sorted) {
    const x = Number(item.x) || 0;
    const y = Number(item.y) || 0;
    const width = Number(item.width) || 0;
    const text = item.str.trim();

    if (!current || Math.abs(y - current.lastY) > SAME_LINE_TOLERANCE) {
      if (current) lines.push(current.text);
      current = { text, lastY: y, xEnd: x + width, lastRaw: item.str };
      continue;
    }

    // A separating space is needed when the segments are apart, or when
    // either side carries whitespace the trim() removed (a trailing space
    // usually already sits inside the previous item's width, which would
    // otherwise glue "Onion," and "red" into "Onion,red").
    const apart = x - current.xEnd > SPACE_GAP;
    const prevHadSpace = /\s$/.test(current.lastRaw);
    const thisHadSpace = /^\s/.test(item.str);
    current.text += `${apart || prevHadSpace || thisHadSpace ? " " : ""}${text}`;
    current.lastY = y;
    current.xEnd = x + width;
    current.lastRaw = item.str;
  }

  if (current) lines.push(current.text);
  return lines;
};

export default groupPdfLines;
