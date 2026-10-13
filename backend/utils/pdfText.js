// backend/utils/pdfText.js
//
// PDF text extraction for the DA "Daily Price Index" importer
// (services/daPriceImportService.js). The sheets published on
// https://www.da.gov.ph/price-monitoring/ carry a real text layer, so they
// extract cleanly through pdf.js without OCR.
//
// The browser-side upload flow has its own copy of this logic (frontend
// src/features/inventory/components/market modal/pdfLines.mjs + pdfText.js);
// that one is ESM and worker-backed. This CommonJS edition serves the backend
// cron job, which must not spin up a worker per run.
'use strict';

const { pathToFileURL } = require('url');

// The legacy build is ESM. Node loads it lazily on first import so requiring
// this module can never crash a process that never calls extractPdfText
// (e.g. the test for the DA parser, which fakes the download step).
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    const legacyDir = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
    // On Windows require.resolve returns a "D:\\...\\pdf.mjs" path; the ESM
    // loader rejects that as an unsupported URL scheme, so translate to a
    // file:// URL (a no-op on POSIX). Kept lazy: requiring this module must
    // never crash a process that never calls extractPdfText.
    pdfjsPromise = import(pathToFileURL(legacyDir).href).then((mod) => mod && mod.default ? mod.default : mod);
  }
  return pdfjsPromise;
}

// Vertical drift (points) still read as the same visual line. See
// pdfLines.mjs in the frontend for the full reasoning behind these values.
const SAME_LINE_TOLERANCE = 2.5;
const SPACE_GAP = 1.5;

// Pure geometry -> text: turns pdf.js text items into one string per visual
// line. Items arrive as { str, x, y, width } in PDF user-space points (y
// grows upward). Ported byte-for-byte from the frontend's pdfLines.mjs so
// both sides produce identical text from identical PDFs.
const groupPdfLines = (items) => {
  const usable = (items || []).filter(
    (item) => item && typeof item.str === 'string' && item.str.trim().length > 0
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

    const apart = x - current.xEnd > SPACE_GAP;
    const prevHadSpace = /\s$/.test(current.lastRaw);
    const thisHadSpace = /^\s/.test(item.str);
    current.text += `${apart || prevHadSpace || thisHadSpace ? ' ' : ''}${text}`;
    current.lastY = y;
    current.xEnd = x + width;
    current.lastRaw = item.str;
  }

  if (current) lines.push(current.text);
  return lines;
};

const MAX_PDF_PAGES = 30;

/**
 * Extract all readable text from a PDF buffer, one visual line per item.
 *
 * @param {Buffer|Uint8Array} buffer  PDF file bytes
 * @returns {Promise<string>}  page text joined with blank lines
 */
async function extractPdfText(buffer) {
  const pdfjs = await loadPdfjs();

  const loadingTask = pdfjs.getDocument({
    // pdf.js refuses Buffer (a Uint8Array subclass) in v4; copy to a plain
    // Uint8Array so node:crypto-less payloads parse the same everywhere.
    data: buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : Uint8Array.from(buffer),
    // Word-level extraction only; never rasterize, never need fonts.
    isEvalSupported: false,
    disableFontFace: true,
  });

  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    if (error && error.name === 'PasswordException') {
      throw new Error('The DA price index PDF is password-protected.');
    }
    // Unknown exVar/other load errors bubble up to the importer as-is.
    throw error;
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`The DA price index PDF has ${pdf.numPages} pages (limit ${MAX_PDF_PAGES}).`);
    }

    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = groupPdfLines(
        (content.items || []).map((item) => ({
          str: item.str,
          x: item.transform && item.transform[4],
          y: item.transform && item.transform[5],
          width: item.width,
        }))
      );
      const text = lines.join('\n');
      // A scanned page contributes nothing; the NCR sheets are never scanned.
      if (text.trim()) pageTexts.push(text);
    }

    return pageTexts.join('\n\n').trim();
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

module.exports = { groupPdfLines, extractPdfText };