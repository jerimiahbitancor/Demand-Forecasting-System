// frontend/src/services/reportService.js
// Architecture: a handful of small "draw a thing at this Y, return the next
// Y" helpers, reused by three report builders (one per Analytics tab) plus
// one generic Excel builder. Adding a fourth report type later means writing
// one more builder function, not duplicating the header/footer/table logic.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { getStoredBusinessLogo } from '../context/BusinessProfileContext';
import { formatStockQty } from '../utils/formatStockQty.js';
import { formatItemsSold } from '../utils/formatItemsSold.js';

// ---------------------------------------------------------------------
// Palette — pulled directly from the app's CSS variables so the PDF
// matches the live dashboard instead of drifting into its own colors.
// ---------------------------------------------------------------------
const COLOR = {
  redPrimary: [122, 1, 1],      // --color-red-primary
  bgPrimary: [237, 233, 222],   // --color-bg-primary / card fill
  borderLight: [232, 224, 221], // --color-border-light
  textPrimary: [28, 38, 50],    // --color-text-primary
  textLight: [108, 117, 125],   // --color-text-light
  success: [15, 153, 24],       // --color-success
  pillHighBg: [253, 226, 226], pillHighText: [180, 35, 24],   // pill--high
  pillMedBg: [253, 240, 213], pillMedText: [154, 107, 10],    // pill--medium
  pillLowBg: [220, 245, 223], pillLowText: [15, 122, 22],     // pill--low
  // Demand level: one neutral hue, light -> dark (ProductPerformance.css pill--*).
  demandHighBg: [55, 48, 163], demandHighText: [255, 255, 255],
  demandMedBg: [199, 210, 254], demandMedText: [49, 46, 129],
  demandLowBg: [238, 242, 255], demandLowText: [67, 56, 202],
};

const PAGE_MARGIN = 15; // mm
const PAGE_WIDTH = 210; // A4 portrait
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// ---------------------------------------------------------------------
// Logo — pass a base64 data URL (e.g. loaded from /logo.png) if you have
// one; otherwise a plain initials circle is drawn so the report still
// looks intentional with zero setup.
// ---------------------------------------------------------------------
export async function loadLogoBase64(url = getStoredBusinessLogo()) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Peso sign - jsPDF's built-in fonts have no glyph for the Philippine
// peso sign (U+20B1), so it renders as a wrong character. We embed a tiny
// subset font (ASCII + U+20B1 only, generated with pyftsubset) on demand
// and use it for currency text only, leaving everything else as-is.
// ---------------------------------------------------------------------
const PESO = '\u20B1';
const PESO_FONT = 'PesoFont';
const PESO_FONT_FILE = 'Roboto-Regular.ttf';
const PESO_FONT_URL = `${(import.meta.env && import.meta.env.BASE_URL) || '/'}fonts/${PESO_FONT_FILE}`;
let pesoFontBase64Promise = null;

function loadPesoFontBase64() {
  if (!pesoFontBase64Promise) {
    pesoFontBase64Promise = fetch(PESO_FONT_URL)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error('peso font unavailable'))))
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
      })
      .catch(() => null);
  }
  return pesoFontBase64Promise;
}

function registerPesoFont(doc, base64) {
  if (!base64) return false;
  try {
    doc.addFileToVFS(PESO_FONT_FILE, base64);
    doc.addFont(PESO_FONT_FILE, PESO_FONT, 'normal');
    return true;
  } catch {
    return false;
  }
}

function drawHeader(doc, { reportTitle, dateRangeLabel, generatedLabel, business, logoDataUrl }) {
  const y = PAGE_MARGIN;

  // Logo (image if provided, else an initials circle)
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', PAGE_MARGIN, y, 14, 14, undefined, 'FAST');
  } else {
    doc.setFillColor(...COLOR.textPrimary);
    doc.circle(PAGE_MARGIN + 7, y + 7, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('CD', PAGE_MARGIN + 7, y + 9, { align: 'center' });
  }

  const textX = PAGE_MARGIN + 18;
  doc.setTextColor(...COLOR.redPrimary);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(business?.name || 'ChefDuo', textX, y + 6);

  doc.setTextColor(...COLOR.textLight);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(business?.address || 'Address not set in Settings', textX, y + 11);
  doc.text(
    [business?.email, business?.contact].filter(Boolean).join(' \u00b7 ') || 'Contact not set in Settings',
    textX, y + 15.5
  );

  // Title block, right-aligned
  doc.setTextColor(...COLOR.redPrimary);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(reportTitle, PAGE_MARGIN + CONTENT_WIDTH, y + 6, { align: 'right' });

  doc.setTextColor(...COLOR.textLight);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(dateRangeLabel, PAGE_MARGIN + CONTENT_WIDTH, y + 11, { align: 'right' });
  doc.text(generatedLabel, PAGE_MARGIN + CONTENT_WIDTH, y + 15.5, { align: 'right' });

  doc.setDrawColor(...COLOR.redPrimary);
  doc.setLineWidth(0.6);
  doc.line(PAGE_MARGIN, y + 20, PAGE_MARGIN + CONTENT_WIDTH, y + 20);

  return y + 28;
}

function addFooterToAllPages(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const y = 287;
    doc.setDrawColor(...COLOR.borderLight);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, y, PAGE_MARGIN + CONTENT_WIDTH, y);
    doc.setTextColor(...COLOR.textLight);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('ChefDuo Forecast System', PAGE_MARGIN, y + 5);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_MARGIN + CONTENT_WIDTH, y + 5, { align: 'right' });
  }
}

// Metric cards — 2 or 4 across, cream background, bold monospace value.
function drawMetricCards(doc, y, cards) {
  const gap = 6;
  const cardWidth = (CONTENT_WIDTH - gap * (cards.length - 1)) / cards.length;
  const cardHeight = 22;

  cards.forEach((card, i) => {
    const x = PAGE_MARGIN + i * (cardWidth + gap);
    doc.setFillColor(...COLOR.bgPrimary);
    doc.setDrawColor(...COLOR.borderLight);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, 'FD');

    doc.setTextColor(...COLOR.textLight);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(card.label, x + cardWidth / 2, y + 6, { align: 'center' });

    doc.setTextColor(...(card.valueColor || COLOR.textPrimary));
    // valueFont: a registered font for values courier cannot draw (₱).
    doc.setFont(card.valueFont || 'courier', card.valueFont ? 'normal' : 'bold');
    doc.setFontSize(14);
    doc.text(String(card.value), x + cardWidth / 2, y + 14, { align: 'center' });

    if (card.caption) {
      doc.setTextColor(...COLOR.textLight);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(card.caption, x + cardWidth / 2, y + 19, { align: 'center' });
    }
  });

  return y + cardHeight + 8;
}

// Bordered cream box with wrapped paragraph text — used for the
// narrative insight box and the disclaimer box.
function drawTextBox(doc, y, text, { fontSize = 9, italic = false, padding = 5 } = {}) {
  doc.setFont('helvetica', italic ? 'italic' : 'normal');
  doc.setFontSize(fontSize);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - padding * 2);
  const boxHeight = lines.length * (fontSize * 0.42) + padding * 2;

  doc.setFillColor(...COLOR.bgPrimary);
  doc.setDrawColor(...COLOR.borderLight);
  doc.setLineWidth(0.2);
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, boxHeight, 2, 2, 'FD');

  doc.setTextColor(...COLOR.textPrimary);
  doc.text(lines, PAGE_MARGIN + CONTENT_WIDTH / 2, y + padding + 3, { align: 'center' });

  return y + boxHeight + 8;
}

function drawSectionTitle(doc, y, text) {
  doc.setTextColor(...COLOR.textPrimary);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(text, PAGE_MARGIN, y);
  return y + 6;
}

function drawTable(doc, y, { head, body, columnStyles, didParseCell, tableStyles = {} }) {
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: {
      fontSize: 8,
      textColor: COLOR.textPrimary,
      lineColor: COLOR.borderLight,
      lineWidth: 0.15,
      overflow: 'linebreak',
      ...tableStyles,
    },
    headStyles: { fillColor: COLOR.bgPrimary, textColor: COLOR.textPrimary, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles,
    didParseCell,
  });
  return doc.lastAutoTable.finalY + 8;
}

function formatDateRangeLabel(dateRange) {
  if (!Array.isArray(dateRange) || !dateRange[0] || !dateRange[1]) return '';
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${dateRange[0].toLocaleDateString('en-US', opts)} \u2013 ${dateRange[1].toLocaleDateString('en-US', opts)}`;
}

function generatedLabelNow() {
  const now = new Date();
  return `Generated ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

// ---------------------------------------------------------------------
// Report 1: Sales & Demand Forecast
// ---------------------------------------------------------------------
// metrics: [{ label, value, caption }] (a value may contain ₱).
// salesTable: { body: string[][], totals: string[] } or null (not selected)
//   columns: Date | Product | Expected items | Expected sales | Est. cost | Est. gross profit
// demandTable: { body: string[][] } or null (not selected)
//   columns: Date | Product | Actual items | Expected items
export async function buildSalesForecastPDF({
  dateRange, business, metrics, summaryText, salesTable = null, demandTable = null, disclaimer,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const [logoDataUrl, pesoFontBase64] = await Promise.all([loadLogoBase64(), loadPesoFontBase64()]);
  // ₱ needs a font that has it; without the font file, print "PHP " instead.
  const pesoFontReady = registerPesoFont(doc, pesoFontBase64);
  const money = (value) => (pesoFontReady ? String(value) : String(value).split(PESO).join('PHP '));
  const pesoCell = (data) => {
    if (pesoFontReady && typeof data.cell.raw === 'string' && data.cell.raw.includes(PESO)) {
      data.cell.styles.font = PESO_FONT;
      data.cell.styles.fontStyle = 'normal';
    }
  };

  let y = drawHeader(doc, {
    reportTitle: 'Sales & Demand Forecast Report',
    dateRangeLabel: formatDateRangeLabel(dateRange),
    generatedLabel: generatedLabelNow(),
    business,
    logoDataUrl,
  });

  y = drawMetricCards(doc, y, metrics.map((card) => {
    const value = money(card.value);
    return { ...card, value, valueFont: pesoFontReady && value.includes(PESO) ? PESO_FONT : undefined };
  }));
  if (summaryText) y = drawTextBox(doc, y, summaryText);

  if (salesTable) {
    y = drawSectionTitle(doc, y, 'Expected sales');
    y = drawTable(doc, y, {
      head: ['Date', 'Product', 'Expected items', 'Expected sales', 'Est. cost', 'Est. gross profit'],
      body: [...salesTable.body, salesTable.totals].map((row) => row.map(money)),
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      didParseCell: (data) => {
        pesoCell(data);
        // Totals row (last body row) in bold.
        if (data.section === 'body' && data.row.index === salesTable.body.length) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = COLOR.bgPrimary;
        }
      },
    });
  }

  if (demandTable) {
    y = drawSectionTitle(doc, y, 'Expected items sold');
    y = drawTable(doc, y, {
      head: ['Date', 'Product', 'Actual items (if known)', 'Expected items'],
      body: demandTable.body,
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
  }

  // At the running y (never a fixed spot a long table could run into); a
  // new page when there is no room left above the footer.
  if (y > doc.internal.pageSize.getHeight() - 35) {
    doc.addPage();
    y = 20;
  }
  drawTextBox(doc, y, disclaimer, { fontSize: 8, italic: false });

  addFooterToAllPages(doc);
  return doc;
}

// ---------------------------------------------------------------------
// Report 2: Product Performance
// ---------------------------------------------------------------------
export async function buildProductPerformancePDF({
  dateRange, business, metrics, statusBullets, narrativeText,
  topPerformers, needsReview, demandRows, disclaimer,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logoDataUrl = await loadLogoBase64();

  let y = drawHeader(doc, {
    reportTitle: 'Product Performance Report',
    dateRangeLabel: formatDateRangeLabel(dateRange),
    generatedLabel: generatedLabelNow(),
    business,
    logoDataUrl,
  });

  y = drawMetricCards(doc, y, metrics);

  // Two side-by-side boxes: bulleted status (left), narrative (right)
  const boxY = y;
  const halfWidth = (CONTENT_WIDTH - 6) / 2;
  const bulletText = statusBullets.map((b) => `\u2022 ${b}`).join('\n');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const leftLines = doc.splitTextToSize(bulletText, halfWidth - 10);
  const rightLines = doc.splitTextToSize(narrativeText, halfWidth - 10);
  const boxHeight = Math.max(leftLines.length + 2, rightLines.length) * 4.2 + 10;

  doc.setFillColor(...COLOR.bgPrimary);
  doc.setDrawColor(...COLOR.borderLight);
  doc.setLineWidth(0.2);
  doc.roundedRect(PAGE_MARGIN, boxY, halfWidth, boxHeight, 2, 2, 'FD');
  doc.roundedRect(PAGE_MARGIN + halfWidth + 6, boxY, halfWidth, boxHeight, 2, 2, 'FD');

  doc.setTextColor(...COLOR.textPrimary);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Product Status', PAGE_MARGIN + 5, boxY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(leftLines, PAGE_MARGIN + 5, boxY + 14);

  doc.text(rightLines, PAGE_MARGIN + halfWidth + 11, boxY + 7);

  y = boxY + boxHeight + 8;

  // Ranked ratios with each product's action signal. A table (not free
  // text) so long "What to do" lines wrap instead of running off the page.
  y = drawSectionTitle(doc, y, 'Performance ratio — ranked');
  const ratioBody = [
    ...topPerformers.map((row) => ['Top performer', row.product, row.ratio == null ? '—' : Number(row.ratio).toFixed(2), row.actionSignal || '—']),
    ...needsReview.map((row) => ['Needs review', row.product, row.ratio == null ? '—' : Number(row.ratio).toFixed(2), row.actionSignal || '—']),
  ];
  y = drawTable(doc, y, {
    head: ['', 'Product', 'Performance vs Average', 'What to do'],
    body: ratioBody.length ? ratioBody : [['—', 'No products with a ratio in this range', '—', '—']],
    columnStyles: { 0: { cellWidth: 26 }, 2: { cellWidth: 26, halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        if (data.cell.raw === 'Top performer') data.cell.styles.textColor = COLOR.success;
        else if (data.cell.raw === 'Needs review') data.cell.styles.textColor = COLOR.pillHighText;
      }
    },
  });

  y = drawSectionTitle(doc, y, 'Demand classification');
  y = drawTable(doc, y, {
    head: ['No.', 'Date', 'Product', 'Forecast Qty.', 'Demand Level', 'Compared with its usual', 'What to do'],
    // Forecast = an expected value (decimal); printed as whole items sold.
    // "Compared with its usual" = the page's label under the level pill.
    body: demandRows.map((r, i) => [i + 1, r.date, r.product, formatItemsSold(r.forecastQty, { withUnit: true }), r.demandLevel, r.demandBasis || '—', r.actionSignal]),
    columnStyles: { 0: { cellWidth: 12 } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4) {
        const level = data.cell.raw;
        if (level === 'High Demand') { data.cell.styles.fillColor = COLOR.demandHighBg; data.cell.styles.textColor = COLOR.demandHighText; }
        else if (level === 'Medium Demand') { data.cell.styles.fillColor = COLOR.demandMedBg; data.cell.styles.textColor = COLOR.demandMedText; }
        else if (level === 'Low Demand') { data.cell.styles.fillColor = COLOR.demandLowBg; data.cell.styles.textColor = COLOR.demandLowText; }
      }
    },
  });

  // Long tables can end near the bottom: start the disclaimer on a new page
  // rather than drawing it into the footer.
  if (y > doc.internal.pageSize.getHeight() - 35) {
    doc.addPage();
    y = 20;
  }
  drawTextBox(doc, y, disclaimer, { fontSize: 8 });
  addFooterToAllPages(doc);
  return doc;
}

// ---------------------------------------------------------------------
// Report 3: Ingredient Demand
// ---------------------------------------------------------------------
// shoppingDateLabel: the day the shopping list is for ("Oct 18, 2026"), from
// the API's own daily.date.
export async function buildIngredientDemandPDF({
  dateRange, business, metrics, insightText, shoppingListRows, highDemandRows, disclaimer, shoppingDateLabel,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logoDataUrl = await loadLogoBase64();

  let y = drawHeader(doc, {
    reportTitle: 'Ingredient Demand Report',
    dateRangeLabel: formatDateRangeLabel(dateRange),
    generatedLabel: generatedLabelNow(),
    business,
    logoDataUrl,
  });

  y = drawMetricCards(doc, y, metrics);
  y = drawTextBox(doc, y, insightText);

  y = drawSectionTitle(doc, y, `Shopping list \u2014 ${shoppingDateLabel || 'selected day'}`);
  y = drawTable(doc, y, {
    head: ['No.', 'Ingredient', 'Used in', 'Base Qty Needed', '+ Buffer', 'Total to Buy', 'Unit'],
    body: shoppingListRows.map((r, i) => [
      i + 1, r.ingredient, r.linkedDishes, r.baseQty, `+ ${r.buffer}`, r.total, r.unit,
    ]),
    columnStyles: { 0: { cellWidth: 10 } },
  });

  y = drawSectionTitle(doc, y, 'High-demand day alert');
  y = drawTable(doc, y, {
    head: ['Day', 'Reason', 'Most Affected Ingredients'],
    body: highDemandRows.map((r) => [r.day, r.reason, r.affected]),
  });

  drawTextBox(doc, y, disclaimer, { fontSize: 8 });
  addFooterToAllPages(doc);
  return doc;
}

// ---------------------------------------------------------------------
// Excel — generic: one sheet per selected table, no design dependency.
// sheets: [{ sheetName, rows: [{...}, ...] }]
// ---------------------------------------------------------------------
export function generateExcel(sheets, filename) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(({ sheetName, rows }) => {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31)); // Excel's 31-char sheet name limit
  });
  XLSX.writeFile(workbook, filename);
}

// ---------------------------------------------------------------------
// Report 4: Grocery List — A5, two-sided
// Front: system-generated categorized list
// Back:  blank write-in table for additional items
// ---------------------------------------------------------------------
export async function buildGroceryListPDF({
  dateLabel,
  business,
  groceryMode,
  itemsToDownload,
  GROCERY_CATEGORIES,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'portrait' });
  const [logoDataUrl, pesoFontBase64] = await Promise.all([
    loadLogoBase64(),
    loadPesoFontBase64(),
  ]);
  const pesoFontReady = registerPesoFont(doc, pesoFontBase64);
  const peso = pesoFontReady ? PESO : 'PHP ';

  const PAGE_W = 148;
  const PAGE_H = 210;
  const MARGIN = 12;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const headY = MARGIN;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', MARGIN, headY, 12, 12, undefined, 'FAST');
  } else {
    doc.setFillColor(122, 1, 1);
    doc.circle(MARGIN + 6, headY + 6, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text('CD', MARGIN + 6, headY + 7.5, { align: 'center' });
  }

  const bizNameX = MARGIN + 16;
  doc.setTextColor(122, 1, 1);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(business?.name || 'ChefDuo', bizNameX, headY + 5);
  doc.setTextColor(108, 117, 125);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(business?.address || '', bizNameX, headY + 9.5);
  doc.text([business?.email, business?.contact].filter(Boolean).join(' · ') || '', bizNameX, headY + 13.5);

  const rightX = MARGIN + CONTENT_W;
  doc.setTextColor(28, 38, 50);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(groceryMode === 'weekly' ? 'Grocery List (Weekly)' : 'Grocery List (Daily)', rightX, headY + 5, { align: 'right' });
  doc.setTextColor(108, 117, 125);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(dateLabel, rightX, headY + 9.5, { align: 'right' });
  const now = new Date();
  const generatedLabel = `Generated ${now.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}, ${now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}`;
  doc.text(generatedLabel, rightX, headY + 13.5, { align: 'right' });
  doc.text('Market Price Source: Department of Agriculture, Puregold, etc.', rightX, headY + 17, { align: 'right' });
  doc.setDrawColor(122, 1, 1);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, headY + 20, MARGIN + CONTENT_W, headY + 20);

  let y = headY + 26;
  const totalCost = itemsToDownload.reduce((sum, i) => sum + (i.estCost || 0), 0);
  const cardW = (CONTENT_W - 6) / 2;
  const cardH = 18;

  doc.setFillColor(237, 233, 222);
  doc.setDrawColor(232, 224, 221);
  doc.setLineWidth(0.2);
  doc.roundedRect(MARGIN, y, cardW, cardH, 2, 2, 'FD');
  doc.setTextColor(108, 117, 125);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Est. Total Cost', MARGIN + cardW / 2, y + 5, { align: 'center' });
  doc.setTextColor(28, 38, 50);
  doc.setFont(pesoFontReady ? PESO_FONT : 'courier', pesoFontReady ? 'normal' : 'bold');
  doc.setFontSize(13);
  doc.text(`${peso} ${totalCost.toLocaleString()}`, MARGIN + cardW / 2, y + 13, { align: 'center' });

  const card2X = MARGIN + cardW + 6;
  doc.setFillColor(237, 233, 222);
  doc.roundedRect(card2X, y, cardW, cardH, 2, 2, 'FD');
  doc.setTextColor(108, 117, 125);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Items to buy', card2X + cardW / 2, y + 5, { align: 'center' });
  doc.setTextColor(28, 38, 50);
  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.text(String(itemsToDownload.length), card2X + cardW / 2, y + 13, { align: 'center' });
  y += cardH + 8;

  const CAT_COLORS = {
    'Meat & Poultry': { bg: [251, 234, 234], text: [122, 1, 1] },
    Seafood: { bg: [234, 242, 250], text: [20, 70, 140] },
    'Vegetables & Fruits': { bg: [234, 245, 238], text: [15, 90, 34] },
    'Grains & Starches': { bg: [253, 240, 213], text: [154, 107, 10] },
    'Dairy & Milk Products': { bg: [234, 245, 238], text: [15, 90, 34] },
    'Condiments & Sauces': { bg: [242, 238, 250], text: [75, 30, 110] },
    'Herbs & Spices': { bg: [234, 245, 238], text: [15, 90, 34] },
    'Beverages & Syrups': { bg: [234, 242, 250], text: [20, 70, 140] },
    'Baking & Dry Goods': { bg: [253, 240, 213], text: [154, 107, 10] },
    'Packaging & Supplies': { bg: [240, 240, 240], text: [80, 80, 80] },
  };
  const filledCats = GROCERY_CATEGORIES
    .map((cat) => ({ cat, items: itemsToDownload.filter((i) => i.category === cat) }))
    .filter(({ items }) => items.length > 0);
  const TABLE_HEAD = [['', 'Item', 'Qty', 'Unit', 'Market Price', 'Notes']];
  const COLUMN_STYLES = {
    0: { cellWidth: 8, halign: 'center' },
    1: { cellWidth: 'auto' },
    2: { cellWidth: 14, halign: 'right' },
    3: { cellWidth: 14 },
    4: { cellWidth: 34, halign: 'right' },
    5: { cellWidth: 24 },
  };
  const drawCheckbox = (data) => {
    if (data.section === 'body' && data.column.index === 0) {
      const cx = data.cell.x + (data.cell.width - 3) / 2;
      const cy = data.cell.y + (data.cell.height - 3) / 2;
      doc.setDrawColor(153, 153, 153);
      doc.setLineWidth(0.3);
      doc.rect(cx, cy, 3, 3);
    }
  };
  const usePesoFontForCurrency = (data) => {
    if (pesoFontReady && typeof data.cell.raw === 'string' && data.cell.raw.includes(PESO)) {
      data.cell.styles.font = PESO_FONT;
    }
  };

  for (const { cat, items } of filledCats) {
    const colors = CAT_COLORS[cat] || { bg: [240, 240, 240], text: [28, 38, 50] };
    const itemCount = `${items.length} item${items.length !== 1 ? 's' : ''}`;
    const headerH = 8;
    const estimatedHeight = headerH + 7 + items.length * 6;
    if (y + estimatedHeight > PAGE_H - 16 && y > MARGIN + 1) {
      doc.addPage('a5', 'portrait');
      y = MARGIN;
    }

    doc.setFillColor(...colors.bg);
    doc.setDrawColor(232, 224, 221);
    doc.setLineWidth(0.2);
    doc.roundedRect(MARGIN, y, CONTENT_W, headerH, 1, 1, 'FD');
    doc.setTextColor(...colors.text);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(cat, MARGIN + 4, y + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(108, 117, 125);
    doc.text(itemCount, MARGIN + CONTENT_W - 4, y + 5.5, { align: 'right' });

    autoTable(doc, {
      startY: y + headerH,
      head: TABLE_HEAD,
      body: items.map((item) => [
        '',
        item.name,
        // Stock amounts: 3 decimals (whole number for count units).
        formatStockQty(item.toBuy, item.unit),
        item.unit,
        `${peso}${item.marketPrice}/${item.unit}`,
        '',
      ]),
      margin: { left: MARGIN, right: MARGIN },
      tableWidth: CONTENT_W,
      theme: 'grid',
      styles: { fontSize: 7.5, textColor: [28, 38, 50], lineColor: [232, 224, 221], lineWidth: 0.15, cellPadding: 1.4 },
      headStyles: { fillColor: [244, 244, 242], textColor: [28, 38, 50], fontStyle: 'bold', fontSize: 7 },
      columnStyles: COLUMN_STYLES,
      didParseCell: usePesoFontForCurrency,
      didDrawCell: drawCheckbox,
    });
    y = doc.lastAutoTable.finalY + 7;
  }

  const blankRowCount = 15;
  const additionalNeeded = 14 + 7 + blankRowCount * 7.5;
  if (y + additionalNeeded > PAGE_H - 16) {
    doc.addPage('a5', 'portrait');
    y = MARGIN;
  }
  doc.setTextColor(122, 1, 1);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Additional Items', MARGIN, y + 6);
  doc.setDrawColor(122, 1, 1);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y + 8, MARGIN + CONTENT_W, y + 8);

  autoTable(doc, {
    startY: y + 14,
    head: TABLE_HEAD,
    body: Array(blankRowCount).fill(['', '', '', '', '', '']),
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: CONTENT_W,
    theme: 'grid',
    styles: { fontSize: 7.5, textColor: [28, 38, 50], lineColor: [200, 200, 200], lineWidth: 0.15, cellPadding: 1.4, minCellHeight: 7.5 },
    headStyles: { fillColor: [244, 244, 242], textColor: [28, 38, 50], fontStyle: 'bold', fontSize: 7 },
    columnStyles: COLUMN_STYLES,
    didDrawCell: drawCheckbox,
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const footerY = PAGE_H - 10;
    doc.setDrawColor(232, 224, 221);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, footerY - 2, MARGIN + CONTENT_W, footerY - 2);
    doc.setTextColor(108, 117, 125);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${business?.name || 'ChefDuo'} Forecast System`, MARGIN, footerY + 2);
    doc.text(`Page ${i} of ${pageCount}`, MARGIN + CONTENT_W, footerY + 2, { align: 'right' });
  }
  doc.setPage(1);

  return doc;
}

// ---------------------------------------------------------------------
// Audit Logs report — reuses the same header/footer/table template as the
// Analytics reports. `rows` is already human-readable from the page:
//   { date, action, performedBy, details }
// ---------------------------------------------------------------------

// Display-only cleanup for audit details so cells stay short and line up in
// the PDF. Ingredient names sometimes carry the unit in parentheses, e.g.
// "hi (Grams (g))" — that suffix is dropped when it precedes a colon. Each
// item after the colon is then put on its own line so an extra source/market
// always lands on a fresh, aligned row instead of widening the cell.
function tidyAuditDetails(text) {
  return String(text || '')
    .replace(/\(([^()]*)\)(?=\s*:)/g, (match, inner) =>
      inner.trim().length > 1 ? '' : match
    )
    .replace(/\s+:/g, ':')
    .replace(/:\s*/, ':\n')
    .replace(/,\s*/g, ',\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function buildAuditLogsPDF({ dateRangeLabel, business, rows }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logoDataUrl = await loadLogoBase64();

  let y = drawHeader(doc, {
    reportTitle: 'Audit Logs Report',
    dateRangeLabel: dateRangeLabel || 'All time',
    generatedLabel: generatedLabelNow(),
    business,
    logoDataUrl,
  });

  y = drawSectionTitle(doc, y, `Audit entries \u2014 ${rows.length} total`);

  drawTable(doc, y, {
    head: ['No.', 'Date & Time', 'Action', 'Performed By', 'Details'],
    body: rows.map((r, i) => [i + 1, r.date, r.action, r.performedBy, tidyAuditDetails(r.details)]),
    columnStyles: {
      0: { cellWidth: 9, halign: 'center', valign: 'middle' },
      1: { cellWidth: 32, halign: 'left', valign: 'middle' },
      2: { cellWidth: 32, halign: 'left', valign: 'middle' },
      3: { cellWidth: 27, halign: 'left', valign: 'middle' },
      4: { cellWidth: 180 - 9 - 32 - 32 - 27, halign: 'left', valign: 'middle' },
    },
    tableStyles: {
      fontSize: 6.8,
      cellPadding: { top: 1.8, right: 2.5, bottom: 1.8, left: 2.5 },
      lineHeight: 1.3,
    },
  });

  addFooterToAllPages(doc);
  return doc;
}