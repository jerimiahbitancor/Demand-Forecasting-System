// frontend/src/services/reportService.js
// Architecture: a handful of small "draw a thing at this Y, return the next
// Y" helpers, reused by three report builders (one per Analytics tab) plus
// one generic Excel builder. Adding a fourth report type later means writing
// one more builder function, not duplicating the header/footer/table logic.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

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
};

const PAGE_MARGIN = 15; // mm
const PAGE_WIDTH = 210; // A4 portrait
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

// ---------------------------------------------------------------------
// Logo — pass a base64 data URL (e.g. loaded from /logo.png) if you have
// one; otherwise a plain initials circle is drawn so the report still
// looks intentional with zero setup.
// ---------------------------------------------------------------------
export async function loadLogoBase64(url = '/logo.png') {
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
    doc.setFont('courier', 'bold');
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

function drawTable(doc, y, { head, body, columnStyles, didParseCell }) {
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    styles: { fontSize: 8, textColor: COLOR.textPrimary, lineColor: COLOR.borderLight, lineWidth: 0.15 },
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
export async function buildSalesForecastPDF({ dateRange, business, metrics, insightText, disclaimer }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logoDataUrl = await loadLogoBase64();

  let y = drawHeader(doc, {
    reportTitle: 'Sales & Demand Forecast Report',
    dateRangeLabel: formatDateRangeLabel(dateRange),
    generatedLabel: generatedLabelNow(),
    business,
    logoDataUrl,
  });

  y = drawMetricCards(doc, y, metrics);
  y = drawTextBox(doc, y, insightText);
  drawTextBox(doc, 260, disclaimer, { fontSize: 8, italic: false });

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

  // Ranked lists: Top performers (green) / Needs review (coral), side by side
  y = drawSectionTitle(doc, y, 'Performance ratio \u2014 ranked');
  const listTop = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR.success);
  doc.text('Top performers', PAGE_MARGIN, listTop);
  doc.setTextColor(...COLOR.pillHighText);
  doc.text('Needs review', PAGE_MARGIN + halfWidth + 6, listTop);

  doc.setDrawColor(...COLOR.borderLight);
  doc.line(PAGE_MARGIN, listTop + 2, PAGE_MARGIN + halfWidth, listTop + 2);
  doc.line(PAGE_MARGIN + halfWidth + 6, listTop + 2, PAGE_MARGIN + CONTENT_WIDTH, listTop + 2);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLOR.textPrimary);
  doc.setFontSize(9);
  topPerformers.forEach((row, i) => {
    const rowY = listTop + 8 + i * 6;
    doc.text(row.product, PAGE_MARGIN, rowY);
    doc.text(row.ratio.toFixed(2), PAGE_MARGIN + halfWidth, rowY, { align: 'right' });
  });
  needsReview.forEach((row, i) => {
    const rowY = listTop + 8 + i * 6;
    doc.text(row.product, PAGE_MARGIN + halfWidth + 6, rowY);
    doc.text(row.ratio.toFixed(2), PAGE_MARGIN + CONTENT_WIDTH, rowY, { align: 'right' });
  });

  y = listTop + 8 + Math.max(topPerformers.length, needsReview.length) * 6 + 6;

  y = drawSectionTitle(doc, y, 'Demand classification \u2014 tomorrow');
  y = drawTable(doc, y, {
    head: ['No.', 'Product', 'Forecast Qty. (Tomorrow)', 'Demand Level', 'Action Signal'],
    body: demandRows.map((r, i) => [i + 1, r.product, `${r.forecastQty} orders`, r.demandLevel, r.actionSignal]),
    columnStyles: { 0: { cellWidth: 12 } },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 3) {
        const level = data.cell.raw;
        if (level === 'High Demand') { data.cell.styles.fillColor = COLOR.pillHighBg; data.cell.styles.textColor = COLOR.pillHighText; }
        else if (level === 'Medium Demand') { data.cell.styles.fillColor = COLOR.pillMedBg; data.cell.styles.textColor = COLOR.pillMedText; }
        else if (level === 'Low Demand') { data.cell.styles.fillColor = COLOR.pillLowBg; data.cell.styles.textColor = COLOR.pillLowText; }
      }
    },
  });

  drawTextBox(doc, y, disclaimer, { fontSize: 8 });
  addFooterToAllPages(doc);
  return doc;
}

// ---------------------------------------------------------------------
// Report 3: Ingredient Demand
// ---------------------------------------------------------------------
export async function buildIngredientDemandPDF({
  dateRange, business, metrics, insightText, shoppingListRows, highDemandRows, disclaimer,
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

  y = drawSectionTitle(doc, y, 'Shopping list \u2014 tomorrow');
  y = drawTable(doc, y, {
    head: ['No.', 'Ingredient', 'Link Dishes', 'Base Qty Needed', '+ Buffer', 'Total to Buy', 'Unit'],
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