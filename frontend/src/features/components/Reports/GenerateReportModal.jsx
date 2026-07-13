// frontend/src/components/Reports/GenerateReportModal.jsx
//
// One modal, reused by Forecasting, Product Performance, and Ingredient
// Demand. Each page passes its own reportTitle and availableTables list;
// the modal itself has no report-specific logic — onGenerate hands back
// { format, dateRange, selectedTableIds } and the page decides what to
// build with reportService.

import { useState } from "react";
import { FiX, FiFileText, FiGrid } from "react-icons/fi";
import DatePicker from "../../Analytics/components/shared/DatePicker.jsx";
import "./GenerateReportModal.css";

const GenerateReportModal = ({ reportTitle, availableTables, onCancel, onGenerate }) => {
  const [format, setFormat] = useState("pdf");
  const [dateRange, setDateRange] = useState([
    new Date(new Date().setDate(new Date().getDate() - 6)),
    new Date(),
  ]);
  const [selectedTableIds, setSelectedTableIds] = useState(availableTables.map((t) => t.id));
  const [isGenerating, setIsGenerating] = useState(false);

  const toggleTable = (id) => {
    setSelectedTableIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (format === "excel" && selectedTableIds.length === 0) return;
    setIsGenerating(true);
    try {
      await onGenerate({ format, dateRange, selectedTableIds });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="report-modal-overlay">
      <div className="report-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="report-modal-header">
          <h3>Generate report</h3>
          <button className="report-modal-close" onClick={onCancel} disabled={isGenerating}>
            <FiX size={22} />
          </button>
        </div>

        <div className="report-modal-body">
          <p className="report-modal-subtitle">{reportTitle}</p>

          <div className="report-format-toggle">
            <button
              type="button"
              className={`report-format-btn ${format === "pdf" ? "active" : ""}`}
              onClick={() => setFormat("pdf")}
            >
              <FiFileText size={16} /> PDF
            </button>
            <button
              type="button"
              className={`report-format-btn ${format === "excel" ? "active" : ""}`}
              onClick={() => setFormat("excel")}
            >
              <FiGrid size={16} /> Excel
            </button>
          </div>

          <div className="report-field">
            <label>Date range</label>
            <DatePicker value={dateRange} onChange={setDateRange} mode="range" />
          </div>

          {format === "pdf" && (
            <p className="report-hint">
              Downloads the full {reportTitle.toLowerCase()} for the selected date range.
            </p>
          )}

          {format === "excel" && (
            <div className="report-field">
              <label>Include tables</label>
              <div className="report-table-list">
                {availableTables.map((table) => (
                  <label key={table.id} className="report-table-item">
                    <input
                      type="checkbox"
                      checked={selectedTableIds.includes(table.id)}
                      onChange={() => toggleTable(table.id)}
                    />
                    {table.label}
                  </label>
                ))}
              </div>
              {selectedTableIds.length === 0 && (
                <p className="report-error-text">Select at least one table.</p>
              )}
            </div>
          )}
        </div>

        <div className="report-modal-footer">
          <button className="btn-secondary" onClick={onCancel} disabled={isGenerating}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={isGenerating || (format === "excel" && selectedTableIds.length === 0)}
          >
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GenerateReportModal;