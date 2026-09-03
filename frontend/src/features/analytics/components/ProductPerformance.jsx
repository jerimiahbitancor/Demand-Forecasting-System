// components/ProductPerformance.jsx
import { useState } from "react";
import { FiChevronDown, FiSearch, FiCalendar, FiInfo, FiExternalLink } from "react-icons/fi";
import GenerateReportModal from "../../components/Reports/GenerateReportModal.jsx";
import { buildProductPerformancePDF, generateExcel } from "./../../../services/reportService.js";
import DatePicker from "./shared/DatePicker.jsx";
import ExpandableModal from "./shared/ExpandableModal.jsx";
import Pagination from "./shared/Pagination.jsx";
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/scale.css';
import InfoBanner from "./shared/InfoBanner.jsx";
import "./shared/InfoBanner.css";
import "./ProductPerformance.css";

// ---------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------
const demandRows = [
  { product: "Poppers & Rice", forecastQty: 52, zone: "high", demandLevel: "High Demand", actionSignal: "Prepare Extra Stock" },
  { product: "Breaded Tonkatsu", forecastQty: 38, zone: "high", demandLevel: "Medium Demand", actionSignal: "Standard Preparation" },
  { product: "Chick & Fries", forecastQty: 44, zone: "medium", demandLevel: "High Demand", actionSignal: "Prepare Extra Stock" },
  { product: "Cheesy Tapa", forecastQty: 18, zone: "low", demandLevel: "Low Demand", actionSignal: "Prepare Less" },
];

const performanceRows = [
  { rank: 1, product: "Poppers & Rice", qtySold: 48, revenue: "₱6,750", ratio: 1.55, actionSignal: "Keep on Menu — top performer" },
  { rank: 2, product: "Breaded Tonkatsu", qtySold: 37, revenue: "₱5,700", ratio: 1.19, actionSignal: "Above average — maintain" },
  { rank: 3, product: "Chick & Fries", qtySold: 29, revenue: "₱4,800", ratio: 0.94, actionSignal: "Near average — monitor" },
  { rank: 4, product: "Cheesy Tapa", qtySold: 18, revenue: "₱1,800", ratio: 0.58, actionSignal: "Below average — consider promo or review" },
];

const activeProducts = [
  { product: "Breaded Tonkatsu", daysOnMenu: "6 months", forecastStatus: "Forecast Running" },
  { product: "Poppers & Rice", daysOnMenu: "5 months", forecastStatus: "Forecast Running" },
];

const newProducts = [
  { product: "Ice Sago", daysOnMenu: "12 days", forecastStatus: "Forecast in 16 days" },
  { product: "Bulalo", daysOnMenu: "10 days", forecastStatus: "Forecast in 18 days" },
];

const inactiveProducts = [
  { product: "Bicol Express", lastSale: "25 days ago", forecastStatus: "Auto flagged in 3 days" },
  { product: "Kaldereta", lastSale: "20 days ago", forecastStatus: "Auto flagged in 8 days" },
];

const archivedProducts = [
  { product: "Halo Halo", lastSale: "3 months ago", forecastStatus: "Seasonal" },
];

// ---------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------
const tooltips = {
  demandClassification: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Demand Classification
      </strong>
      The system automatically sorts each dish into High, Medium, or Low demand — based on that dish's own sales history, not a fixed number. A dish selling 20 servings might be "High" if it rarely sells that much.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>●</span>
          <span><strong>High Demand</strong> — Prepare extra stock</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>●</span>
          <span><strong>Medium Demand</strong> — Standard preparation</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#22c55e', fontWeight: 'bold' }}>●</span>
          <span><strong>Low Demand</strong> — Reduce preparation</span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        High if Forecast &gt; P80 • Medium if P40 ≤ Forecast ≤ P80 • Low if Forecast &lt; P40
      </span>
    </div>
  ),
  
  performanceRatio: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Performance Ratio Analysis
      </strong>
      This compares each dish's sales to your store's average. The center line is your store average.
      <br/><br/>
      <div style={{ margin: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: '#22c55e', fontWeight: 'bold' }}>→</span>
          <span><strong>Bars to the right</strong> = Selling better than average — keep these on the menu</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#ef4444', fontWeight: 'bold' }}>→</span>
          <span><strong>Bars to the left</strong> = Selling below average — consider a promo or reviewing the dish</span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Performance Ratio = Actual Qty Sold / Rolling Average Qty Sold (all active products)
      </span>
    </div>
  ),
  
  productStatus: (
    <div style={{ padding: '4px 0', fontSize: '13px', lineHeight: '1.6' }}>
      <strong style={{ color: '#FEB161', display: 'block', marginBottom: '6px' }}>
        Product Status
      </strong>
      <div style={{ margin: '8px 0' }}>
        <div style={{ marginBottom: '10px' }}>
          <strong style={{ color: '#22c55e' }}>Active Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            These products have enough sales history and are actively being forecasted.
          </span>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <strong style={{ color: '#fbbf24' }}>New Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Recently added. The system needs at least 4 weeks of sales data before a reliable forecast is possible.
          </span>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <strong style={{ color: '#ef4444' }}>Inactive Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Auto-flagged after 0 sales for 28 consecutive days. Excluded from forecast until sales resume.
          </span>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <strong style={{ color: '#94a3b8' }}>Archived Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            Permanently removed from the menu, or temporarily off the menu and will return (Seasonal).
          </span>
        </div>
        <div>
          <strong style={{ color: '#94a3b8' }}>Unmapped Products</strong>
          <br/>
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>
            No ingredient recipe configured. Forecasting works, but ingredient demand estimation is unavailable until a recipe is added.
          </span>
        </div>
      </div>
      <br/>
      <span style={{ color: '#94a3b8', fontSize: '12px' }}>
        Auto-flags products with 0 sales for 28 consecutive days • New products need 4 weeks of data
      </span>
    </div>
  ),
};

const zoneClass = { high: "bar--high", medium: "bar--medium", low: "bar--low" };
const pillClass = {
  "High Demand": "pill--high",
  "Medium Demand": "pill--medium",
  "Low Demand": "pill--low",
};

// ---------------------------------------------------------------------
// Chart Components
// ---------------------------------------------------------------------
function DemandBar({ label, qty, maxQty, zone }) {
  const widthPct = Math.max((qty / maxQty) * 100, 6);
  return (
    <div className="demand-bar-row">
      <span className="demand-bar-label">{label}</span>
      <div className="demand-bar-track">
        <div className={`demand-bar-fill ${zoneClass[zone]}`} style={{ width: `${widthPct}%` }}>
          <span className="demand-bar-value">{qty} servings</span>
        </div>
      </div>
    </div>
  );
}

function RatioBar({ label, ratio }) {
  const min = 0.2;
  const max = 1.8;
  const center = 50;
  const pct = ((ratio - min) / (max - min)) * 100;
  const isAbove = ratio >= 1.0;
  const barStart = isAbove ? center : pct;
  const barWidth = Math.abs(pct - center);

  return (
    <div className="ratio-bar-row">
      <span className="ratio-bar-label">{label}</span>
      <div className="ratio-bar-track">
        <div className="ratio-bar-center-line" />
        <div
          className={`ratio-bar-fill ${isAbove ? "ratio-bar-fill--above" : "ratio-bar-fill--below"}`}
          style={{ left: `${barStart}%`, width: `${barWidth}%` }}
        />
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------
function ProductPerformance() {
  const maxQty = Math.max(...demandRows.map((r) => r.forecastQty));
  const [selectedRange, setSelectedRange] = useState([new Date(), new Date()]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  // Modal open states
  const [isDemandClassOpen, setIsDemandClassOpen] = useState(false);
  const [isRatioOpen, setIsRatioOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);

  // Pagination — panel (5 rows each)
  const [demandPage, setDemandPage] = useState(1);
  const [ratioPage, setRatioPage] = useState(1);
  const [activeStatusPage, setActiveStatusPage] = useState(1);
  const [newStatusPage, setNewStatusPage] = useState(1);
  const [inactiveStatusPage, setInactiveStatusPage] = useState(1);

  const [modalDemandPage, setModalDemandPage] = useState(1);
  const [modalRatioPage, setModalRatioPage] = useState(1);
  const [modalActiveStatusPage, setModalActiveStatusPage] = useState(1);
  const [modalNewStatusPage, setModalNewStatusPage] = useState(1);
  const [modalInactiveStatusPage, setModalInactiveStatusPage] = useState(1);
  const [modalArchivedStatusPage, setModalArchivedStatusPage] = useState(1);

  const ROWS_PER_PAGE = 5;

  const availableTables = [
    { id: "demand", label: "Demand Classification" },
    { id: "ratio", label: "Performance Ratio Analysis" },
    { id: "status", label: "Product Status (Active/New/Inactive)" },
  ];

  // Note: selectedTableIds must be destructured here — the modal passes it
  // alongside format and dateRange, and the Excel branch below depends on it.
  const handleGenerateReport = async ({ format, dateRange, selectedTableIds }) => {
    const topPerformers = performanceRows.filter((r) => r.ratio >= 1).slice(0, 2);
    const needsReview = performanceRows.filter((r) => r.ratio < 1).slice(0, 2);

    if (format === "pdf") {
      const doc = await buildProductPerformancePDF({
        dateRange,
        business: null, // wire to your business_profile fetch — see prior note
        metrics: [
          { label: "Active Products", value: activeProducts.length, caption: "menu products" },
          { label: "High Demand", value: demandRows.filter(r => r.demandLevel === "High Demand").length, caption: "products" },
          { label: "Below Average", value: performanceRows.filter(r => r.ratio < 1).length, valueColor: [15, 153, 24], caption: "products" },
          { label: "New Products", value: newProducts.length, caption: "product" },
        ],
        statusBullets: [
          `${activeProducts.length} active menu`,
          `${newProducts.length} new (${newProducts[0]?.product}, forecast in ${newProducts[0]?.forecastStatus.match(/\d+/)?.[0]} days)`,
          `${inactiveProducts.length} inactive (${inactiveProducts[0]?.product}, last sale ${inactiveProducts[0]?.lastSale})`,
        ],
        narrativeText: `${topPerformers[0]?.product} was the top performer this week. ${needsReview[0]?.product} underperformed and may need a promo or menu review.`,
        topPerformers, needsReview, demandRows,
        disclaimer: "Disclaimer \u2014 Performance ratio compares each product's sales against the store average across all active products.",
      });
      doc.save("product-performance-report.pdf");
    } else {
      const sheetMap = {
        demand: { sheetName: "Demand Classification", rows: demandRows },
        ratio: { sheetName: "Performance Ratio", rows: performanceRows },
        status: { sheetName: "Product Status", rows: [...activeProducts, ...newProducts, ...inactiveProducts] },
      };
      generateExcel(
        Object.entries(sheetMap).filter(([id]) => selectedTableIds.includes(id)).map(([, v]) => v),
        "product-performance-report.xlsx"
      );
    }
    setIsReportModalOpen(false);
  };



  const totalDemandPages = Math.max(1, Math.ceil(demandRows.length / ROWS_PER_PAGE));
  const paginatedDemandRows = demandRows.slice(
    (demandPage - 1) * ROWS_PER_PAGE, demandPage * ROWS_PER_PAGE
  );

  const totalRatioPages = Math.max(1, Math.ceil(performanceRows.length / ROWS_PER_PAGE));
  const paginatedRatioRows = performanceRows.slice(
    (ratioPage - 1) * ROWS_PER_PAGE, ratioPage * ROWS_PER_PAGE
  );

  const paginatedActiveProducts = activeProducts.slice(
    (activeStatusPage - 1) * ROWS_PER_PAGE, activeStatusPage * ROWS_PER_PAGE
  );
  const paginatedNewProducts = newProducts.slice(
    (newStatusPage - 1) * ROWS_PER_PAGE, newStatusPage * ROWS_PER_PAGE
  );
  const paginatedInactiveProducts = inactiveProducts.slice(
    (inactiveStatusPage - 1) * ROWS_PER_PAGE, inactiveStatusPage * ROWS_PER_PAGE
  );

  const modalDemandRows = demandRows.slice((modalDemandPage - 1) * 10, modalDemandPage * 10);
  const modalRatioRows = performanceRows.slice((modalRatioPage - 1) * 10, modalRatioPage * 10);
  const modalActiveProducts = activeProducts.slice((modalActiveStatusPage - 1) * 10, modalActiveStatusPage * 10);
  const modalNewProducts = newProducts.slice((modalNewStatusPage - 1) * 10, modalNewStatusPage * 10);
  const modalInactiveProducts = inactiveProducts.slice((modalInactiveStatusPage - 1) * 10, modalInactiveStatusPage * 10);
  const modalArchivedProducts = archivedProducts.slice((modalArchivedStatusPage - 1) * 10, modalArchivedStatusPage * 10);

  return (
    <>
      <div className="analytics-col-main">
        {/* Demand Classification */}
        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Demand Classification
              <Tippy
                content={tooltips.demandClassification}
                placement="right"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                maxWidth={380}
                interactive={true}
              >
                <span className="info-icon-wrapper">
                  <FiInfo className="info-icon" />
                </span>
              </Tippy>
            </h2>
            <button type="button" className="btn-expand-panel" onClick={() => setIsDemandClassOpen(true)} aria-label="Expand Demand Classification">
              <FiExternalLink size={16} />
            </button>
          </div>

          <div className="analytics-filter-row">
            <DatePicker value={selectedRange} onChange={setSelectedRange} mode="range" />
            <span className="filter-search">
              <FiSearch size={14} /> Search Product
            </span>
          </div>

          <p className="section-note">
            Demand level per product — tomorrow, Jun 25. Bar shows tomorrow's forecast.
            Colored zones show what's normal vs. above normal for each product.
          </p>

          <div className="demand-bar-chart">
            {demandRows.map((row) => (
              <DemandBar
                key={row.product}
                label={row.product}
                qty={row.forecastQty}
                maxQty={maxQty}
                zone={row.zone}
              />
            ))}
          </div>

          <div className="chart-legend">
            <span className="legend-item"><span className="legend-swatch legend-swatch--low" /> Low Zone</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--medium" /> Medium Zone</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--high" /> High Zone</span>
          </div>

          <table className="analytics-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Product</th>
                <th>Forecast Qty. (Tomorrow)</th>
                <th>Demand Level</th>
                <th>Action Signal</th>
              </tr>
            </thead>
            <tbody>
              {paginatedDemandRows.map((row, i) => (
                <tr key={row.product}>
                  <td>{i + 1}</td>
                  <td>{row.product}</td>
                  <td>{row.forecastQty} servings</td>
                  <td>
                    <span className={`pill ${pillClass[row.demandLevel]}`}>{row.demandLevel}</span>
                  </td>
                  <td className="action-signal">{row.actionSignal}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination currentPage={demandPage} totalPages={totalDemandPages} onPageChange={setDemandPage} />
        </section>

        {/* Product Performance Ratio Analysis */}
        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Product Performance Ratio Analysis
              <Tippy
                content={tooltips.performanceRatio}
                placement="right"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                maxWidth={380}
                interactive={true}
              >
                <span className="info-icon-wrapper">
                  <FiInfo className="info-icon" />
                </span>
              </Tippy>
            </h2>
            <button type="button" className="btn-expand-panel" onClick={() => setIsRatioOpen(true)} aria-label="Expand Product Performance Ratio Analysis">
              <FiExternalLink size={16} />
            </button>
          </div>

          <div className="analytics-filter-row">
            <DatePicker value={selectedRange} onChange={setSelectedRange} mode="range" />
            <span className="filter-search">
              <FiSearch size={14} /> Search Product
            </span>
            <span className="filter-pill">
              Last 7 Days <FiChevronDown size={14} />
            </span>
          </div>

          <p className="section-note">
            How each dish compares to your store average. The center line is your store's
            average. Bars going right = selling better than average. Bars going left =
            selling below average.
          </p>

          <div className="ratio-bar-chart">
            {performanceRows.map((row) => (
              <RatioBar key={row.product} label={row.product} ratio={row.ratio} />
            ))}
            <div className="ratio-bar-axis">
              <span>← Below Average</span>
              <span>Store Average (1.0)</span>
              <span>Above Average →</span>
            </div>
          </div>

          <div className="chart-legend">
            <span className="legend-item"><span className="legend-swatch legend-swatch--above" /> Above Average (ratio &gt; 1.0)</span>
            <span className="legend-item"><span className="legend-swatch legend-swatch--below" /> Below Average (ratio &lt; 1.0)</span>
          </div>

          <table className="analytics-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Product</th>
                <th>Quantity Sold</th>
                <th>Revenue</th>
                <th>Performance Ratio</th>
                <th>Action Signal</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRatioRows.map((row) => (
                <tr key={row.product}>
                  <td>{row.rank}</td>
                  <td>{row.product}</td>
                  <td>{row.qtySold}</td>
                  <td>{row.revenue}</td>
                  <td className={row.ratio >= 1 ? "value--success" : "value--error"}>
                    {row.ratio.toFixed(2)} {row.ratio >= 1 ? "▲" : "▼"}
                  </td>
                  <td className="action-signal">{row.actionSignal}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination currentPage={ratioPage} totalPages={totalRatioPages} onPageChange={setRatioPage} />

          <p className="table-footnote">
            Ratio above 1.0 = outperforming store average · Ratio below 1.0 = underperforming
          </p>
        </section>
      </div>

      <div className="analytics-col-side">
        <button type="button" className="btn-generate-report" onClick={() => setIsReportModalOpen(true)}>
          Generate Report
        </button>

        <section className="analytics-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 className="analytics-card-title" style={{ marginBottom: 0 }}>
              Product Status
              <Tippy
                content={tooltips.productStatus}
                placement="right"
                animation="scale"
                duration={200}
                theme="dark"
                arrow={true}
                maxWidth={380}
                interactive={true}
              >
                <span className="info-icon-wrapper">
                  <FiInfo className="info-icon" />
                </span>
              </Tippy>
            </h2>
            <button type="button" className="btn-expand-panel" onClick={() => setIsStatusOpen(true)} aria-label="Expand Product Status">
              <FiExternalLink size={16} />
            </button>
          </div>

          <InfoBanner variant="info">
            System auto-flags products with 0 sales for 28 consecutive days for Inactive
            products. New products need 4 weeks of data before forecast activates.
          </InfoBanner>

          <div className="status-group">
            <p className="status-group-title">Active Product</p>
            <p className="status-group-subtitle">There are 50 menu items active</p>
            <table className="analytics-table analytics-table--compact">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Product</th>
                  <th>Days on Menu</th>
                  <th>Forecast Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedActiveProducts.map((row, i) => (
                  <tr key={row.product}>
                    <td>{i + 1}</td>
                    <td>{row.product}</td>
                    <td>{row.daysOnMenu}</td>
                    <td className="value--success">{row.forecastStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination currentPage={activeStatusPage} totalPages={Math.max(1, Math.ceil(activeProducts.length / ROWS_PER_PAGE))} onPageChange={setActiveStatusPage} />
          </div>

          <div className="status-group">
            <p className="status-group-title">New Product</p>
            <p className="status-group-subtitle">
              New product needs 4 weeks of data before forecast activates
            </p>
            <table className="analytics-table analytics-table--compact">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Product</th>
                  <th>Days on Menu</th>
                  <th>Forecast Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedNewProducts.map((row, i) => (
                  <tr key={row.product}>
                    <td>{i + 1}</td>
                    <td>{row.product}</td>
                    <td>{row.daysOnMenu}</td>
                    <td className="value--warning">{row.forecastStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination currentPage={newStatusPage} totalPages={Math.max(1, Math.ceil(newProducts.length / ROWS_PER_PAGE))} onPageChange={setNewStatusPage} />
          </div>

          <div className="status-group">
            <p className="status-group-title">Inactive Product</p>
            <p className="status-group-subtitle">
              System auto-flags product inactive with 0 sales for 28 consecutive days
            </p>
            <table className="analytics-table analytics-table--compact">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Product</th>
                  <th>Last Sale</th>
                  <th>Forecast Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedInactiveProducts.map((row, i) => (
                  <tr key={row.product}>
                    <td>{i + 1}</td>
                    <td>{row.product}</td>
                    <td>{row.lastSale}</td>
                    <td className="value--error">{row.forecastStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination currentPage={inactiveStatusPage} totalPages={Math.max(1, Math.ceil(inactiveProducts.length / ROWS_PER_PAGE))} onPageChange={setInactiveStatusPage} />
          </div>

          <div className="status-group">
            <p className="status-group-title">Archived Product</p>
            <p className="status-group-subtitle">
              Permanently removed from the menu, or temporarily off the menu and will return.
            </p>
            <table className="analytics-table analytics-table--compact">
              <thead>
                <tr>
                  <th>No.</th><th>Product</th><th>Last Sale</th><th>Forecast Status</th>
                </tr>
              </thead>
              <tbody>
                {archivedProducts.map((row, i) => (
                  <tr key={row.product}>
                    <td>{i + 1}</td>
                    <td>{row.product}</td>
                    <td>{row.lastSale}</td>
                    <td className="value--error">{row.forecastStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    {isReportModalOpen && (
        <GenerateReportModal
          reportTitle="Product Performance Report"
          availableTables={availableTables}
          onCancel={() => setIsReportModalOpen(false)}
          onGenerate={handleGenerateReport}
        />
      )}

      <ExpandableModal
        isOpen={isDemandClassOpen}
        onClose={() => setIsDemandClassOpen(false)}
        title="Demand Classification — Full View"
      >
        <div className="demand-bar-chart">
          {demandRows.map((row) => (
            <DemandBar key={row.product} label={row.product} qty={row.forecastQty} maxQty={maxQty} zone={row.zone} />
          ))}
        </div>
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-swatch legend-swatch--low" /> Low Zone</span>
          <span className="legend-item"><span className="legend-swatch legend-swatch--medium" /> Medium Zone</span>
          <span className="legend-item"><span className="legend-swatch legend-swatch--high" /> High Zone</span>
        </div>
        <table className="analytics-table">
          <thead>
            <tr>
              <th>No.</th><th>Product</th><th>Forecast Qty. (Tomorrow)</th><th>Demand Level</th><th>Action Signal</th>
            </tr>
          </thead>
          <tbody>
            {modalDemandRows.map((row, i) => (
              <tr key={row.product}>
                <td>{(modalDemandPage - 1) * 10 + i + 1}</td>
                <td>{row.product}</td>
                <td>{row.forecastQty} servings</td>
                <td><span className={`pill ${pillClass[row.demandLevel]}`}>{row.demandLevel}</span></td>
                <td className="action-signal">{row.actionSignal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          currentPage={modalDemandPage}
          totalPages={Math.max(1, Math.ceil(demandRows.length / 10))}
          onPageChange={setModalDemandPage}
        />
      </ExpandableModal>

      <ExpandableModal
        isOpen={isRatioOpen}
        onClose={() => setIsRatioOpen(false)}
        title="Product Performance Ratio Analysis — Full View"
      >
        <div className="ratio-bar-chart">
          {performanceRows.map((row) => (
            <RatioBar key={row.product} label={row.product} ratio={row.ratio} />
          ))}
          <div className="ratio-bar-axis">
            <span>← Below Average</span>
            <span>Store Average (1.0)</span>
            <span>Above Average →</span>
          </div>
        </div>
        <div className="chart-legend">
          <span className="legend-item"><span className="legend-swatch legend-swatch--above" /> Above Average (ratio &gt; 1.0)</span>
          <span className="legend-item"><span className="legend-swatch legend-swatch--below" /> Below Average (ratio &lt; 1.0)</span>
        </div>
        <table className="analytics-table">
          <thead>
            <tr>
              <th>Rank</th><th>Product</th><th>Quantity Sold</th><th>Revenue</th><th>Performance Ratio</th><th>Action Signal</th>
            </tr>
          </thead>
          <tbody>
            {modalRatioRows.map((row) => (
              <tr key={row.product}>
                <td>{row.rank}</td>
                <td>{row.product}</td>
                <td>{row.qtySold}</td>
                <td>{row.revenue}</td>
                <td className={row.ratio >= 1 ? "value--success" : "value--error"}>{row.ratio.toFixed(2)} {row.ratio >= 1 ? "▲" : "▼"}</td>
                <td className="action-signal">{row.actionSignal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          currentPage={modalRatioPage}
          totalPages={Math.max(1, Math.ceil(performanceRows.length / 10))}
          onPageChange={setModalRatioPage}
        />
      </ExpandableModal>

      <ExpandableModal
        isOpen={isStatusOpen}
        onClose={() => setIsStatusOpen(false)}
        title="Product Status — Full View"
      >
        <InfoBanner variant="info">
          System auto-flags products with 0 sales for 28 consecutive days for Inactive
          products. New products need 4 weeks of data before forecast activates.
        </InfoBanner>

        <div className="status-group">
          <p className="status-group-title">Active Product</p>
          <p className="status-group-subtitle">There are 50 menu items active</p>
          <table className="analytics-table analytics-table--compact">
            <thead><tr><th>No.</th><th>Product</th><th>Days on Menu</th><th>Forecast Status</th></tr></thead>
            <tbody>{modalActiveProducts.map((row, i) => (
              <tr key={row.product}><td>{(modalActiveStatusPage - 1) * 10 + i + 1}</td><td>{row.product}</td><td>{row.daysOnMenu}</td><td className="value--success">{row.forecastStatus}</td></tr>
            ))}</tbody>
          </table>
          <Pagination currentPage={modalActiveStatusPage} totalPages={Math.max(1, Math.ceil(activeProducts.length / 10))} onPageChange={setModalActiveStatusPage} />
        </div>

        <div className="status-group">
          <p className="status-group-title">New Product</p>
          <p className="status-group-subtitle">New product needs 4 weeks of data before forecast activates</p>
          <table className="analytics-table analytics-table--compact">
            <thead><tr><th>No.</th><th>Product</th><th>Days on Menu</th><th>Forecast Status</th></tr></thead>
            <tbody>{modalNewProducts.map((row, i) => (
              <tr key={row.product}><td>{(modalNewStatusPage - 1) * 10 + i + 1}</td><td>{row.product}</td><td>{row.daysOnMenu}</td><td className="value--warning">{row.forecastStatus}</td></tr>
            ))}</tbody>
          </table>
          <Pagination currentPage={modalNewStatusPage} totalPages={Math.max(1, Math.ceil(newProducts.length / 10))} onPageChange={setModalNewStatusPage} />
        </div>

        <div className="status-group">
          <p className="status-group-title">Inactive Product</p>
          <p className="status-group-subtitle">System auto-flags product inactive with 0 sales for 28 consecutive days</p>
          <table className="analytics-table analytics-table--compact">
            <thead><tr><th>No.</th><th>Product</th><th>Last Sale</th><th>Forecast Status</th></tr></thead>
            <tbody>{modalInactiveProducts.map((row, i) => (
              <tr key={row.product}><td>{(modalInactiveStatusPage - 1) * 10 + i + 1}</td><td>{row.product}</td><td>{row.lastSale}</td><td className="value--error">{row.forecastStatus}</td></tr>
            ))}</tbody>
          </table>
          <Pagination currentPage={modalInactiveStatusPage} totalPages={Math.max(1, Math.ceil(inactiveProducts.length / 10))} onPageChange={setModalInactiveStatusPage} />
        </div>

        <div className="status-group">
          <p className="status-group-title">Archived Product</p>
          <p className="status-group-subtitle">Permanently removed from the menu, or temporarily off the menu and will return.</p>
          <table className="analytics-table analytics-table--compact">
            <thead><tr><th>No.</th><th>Product</th><th>Last Sale</th><th>Forecast Status</th></tr></thead>
            <tbody>{modalArchivedProducts.map((row, i) => (
              <tr key={row.product}><td>{(modalArchivedStatusPage - 1) * 10 + i + 1}</td><td>{row.product}</td><td>{row.lastSale}</td><td className="value--error">{row.forecastStatus}</td></tr>
            ))}</tbody>
          </table>
          <Pagination currentPage={modalArchivedStatusPage} totalPages={Math.max(1, Math.ceil(archivedProducts.length / 10))} onPageChange={setModalArchivedStatusPage} />
        </div>
      </ExpandableModal>
    </> 
  );
}

export default ProductPerformance;