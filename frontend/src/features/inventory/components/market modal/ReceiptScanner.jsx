// components/market modal/ReceiptScanner.jsx
//
// Receipt -> OCR -> review -> confirm. Three stages, and NO database write
// ever happens until staff press "Save confirmed prices" on the review stage
// (the actual save is done by the parent page, which owns apiClient and the
// bulk-upsert call).
//
// Props:
//   source    string   market source key the receipt belongs to (e.g. "sm")
//   onCommit  (entries, receiptFile) => Promise<{ ok, savedIngredientIds, failedIngredientIds }>
//   onClose   () => void
//   apiClient AxiosInstance (already memoised by MarketPriceManagement)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaCamera,
  FaExclamationTriangle,
  FaFilePdf,
  FaPlus,
  FaSave,
  FaTimes,
  FaTrash,
  FaUpload,
} from "react-icons/fa";
import toast from "react-hot-toast";
import Swal from "../../../../utils/swal";
import InventoryModal from "../InventoryModal";
import { recognizeReceipt, isAbortError, isPdfFile } from "./receiptOcr";
import "./ReceiptScanner.css";

const STAGE_CAPTURE = "capture";
const STAGE_SCANNING = "scanning";
const STAGE_REVIEW = "review";

// Below 0.6 the top fuzzy hit is a guess rather than a match: those rows get
// the low-confidence class so staff fix them first instead of trusting the
// dropdown pre-selection.
const LOW_CONFIDENCE = 0.6;

const MAX_FILE_SIZE = 20 * 1024 * 1024;

// tesseract.js and the PDF reader report developer-english status strings;
// show staff text.
const OCR_STATUS_LABELS = {
  "loading tesseract core": "Loading OCR engine…",
  "initializing tesseract": "Starting OCR engine…",
  "loading language traineddata": "Loading language data…",
  "initializing api": "Preparing OCR…",
  "recognizing text": "Reading receipt…",
  "reading pdf": "Reading PDF…",
  "scanning pdf page": "Scanning PDF page…",
};

const toReviewRow = (line, index, ingredients) => {
  const matched = (ingredients || []).find(
    (item) => Number(item.id) === Number(line.ingredientId)
  );
  const price = line.price;
  return {
    key: `line-${index}`,
    raw: String(line.raw || ""),
    price: price === null || price === undefined ? "" : String(price),
    // Unit is connected to the Ingredient Management module, exactly like
    // MarketPriceModal: it comes from the matched ingredient's own unit and
    // is read-only here, so the scanner and manual entry can never disagree.
    // The receipt's own unit (100/k) only read the price; the ingredient
    // decides the unit the price is stored in.
    unit: matched ? matched.unit || "kg" : "",
    ingredientId:
      line.ingredientId === null || line.ingredientId === undefined
        ? ""
        : String(line.ingredientId),
    confidence: Number.isFinite(Number(line.confidence)) ? Number(line.confidence) : 0,
    candidates: Array.isArray(line.candidates) ? line.candidates : [],
  };
};

const rowClassName = (row, lowConfidence, savedIds, failedIds) => {
  const classes = [];
  if (lowConfidence.has(row.key)) classes.push("receipt-low-confidence");
  if (failedIds.has(Number(row.ingredientId))) classes.push("receipt-row-failed");
  if (savedIds.has(Number(row.ingredientId))) classes.push("receipt-row-saved");
  return classes.join(" ");
};

const ReceiptScanner = ({ source, onCommit, onClose, apiClient }) => {
  const [stage, setStage] = useState(STAGE_CAPTURE);
  const [receiptFile, setReceiptFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Preparing OCR…");
  const [rows, setRows] = useState([]);
  const [fallbackIngredients, setFallbackIngredients] = useState([]);
  // Receipt lines the backend refused as non-price text (totals, headers…).
  // Shown in the footer so a dropped ITEM is visible instead of silent —
  // staff can then re-add it with "Add a line OCR missed".
  const [ignoredLines, setIgnoredLines] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedIds, setSavedIds] = useState(() => new Set());
  const [failedIds, setFailedIds] = useState(() => new Set());
  // What OCR actually read on the last attempt. Kept for the capture stage:
  // when a receipt produces zero price lines, staff (and support) need to see
  // the raw text to tell "photo too blurry" apart from "parser missed it".
  const [readText, setReadText] = useState("");

  const fileInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const abortRef = useRef(null);

  // Revoke the previous object URL whenever the preview changes, and the
  // last one on unmount — otherwise every retake leaks a blob URL.
  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Kill the OCR worker and the parse-receipt request if the modal unmounts
  // mid-scan (parent closed it, route change, tab refresh).
  useEffect(
    () => () => {
      if (abortRef.current) abortRef.current.abort();
    },
    []
  );

  const runScan = useCallback(
    async (file) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRows([]);
      setIgnoredLines(0);
      setSavedIds(new Set());
      setFailedIds(new Set());
      setReadText("");
      setProgress(0);
      setStatusText("Preparing OCR…");
      setStage(STAGE_SCANNING);

      try {
        const text = await recognizeReceipt(file, {
          signal: controller.signal,
          onProgress: (message) => {
            if (!message) return;
            if (typeof message.progress === "number") {
              setProgress(Math.round(message.progress * 100));
            }
            if (message.status) {
              setStatusText(OCR_STATUS_LABELS[message.status] || message.status);
            }
          },
        });

        setReadText(text);

        if (!text) {
          toast.error(
            "No text could be read from that file. Try a sharper photo or a text-based PDF, or add the prices manually."
          );
          setStage(STAGE_CAPTURE);
          return;
        }

        setStatusText("Matching ingredients…");
        const response = await apiClient.post(
          "/market-prices/parse-receipt",
          { text, source },
          { signal: controller.signal }
        );

        if (!response.data || !response.data.success) {
          throw new Error(
            (response.data && response.data.error) || "Could not read the receipt"
          );
        }

        const payload = response.data.data || {};
        const lines = Array.isArray(payload.lines) ? payload.lines : [];
        const ingredients = Array.isArray(payload.fallbackIngredients)
          ? payload.fallbackIngredients
          : [];

        if (!lines.length) {
          toast.error(
            "No price lines were recognised on this receipt. Try a sharper photo, or add the prices manually."
          );
          setStage(STAGE_CAPTURE);
          return;
        }

        setFallbackIngredients(ingredients);
        setIgnoredLines(Number(payload.skipped) || 0);
        setRows(lines.map((line, index) => toReviewRow(line, index, ingredients)));
        setStage(STAGE_REVIEW);
      } catch (error) {
        if (isAbortError(error)) return; // user cancelled or the modal closed
        console.error("Receipt scan failed:", error);
        toast.error(
          (error.response && error.response.data && error.response.data.error) ||
            error.message ||
            "Receipt scan failed"
        );
        setStage(STAGE_CAPTURE);
      }
    },
    [apiClient, source]
  );

  const handleFileSelected = useCallback(
    (event) => {
      const file = event.target.files && event.target.files[0];
      // Reset so choosing the same photo again (after a retake) still fires
      // onChange — otherwise the input keeps the old value and nothing happens.
      event.target.value = "";
      if (!file) return;

      if (!file.type || !file.type.startsWith("image/")) {
        if (!isPdfFile(file)) {
          toast.error("Please choose a receipt photo (JPEG, PNG or HEIC) or a PDF file.");
          return;
        }
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error("That file is larger than 20 MB. Please choose a smaller one.");
        return;
      }

      setReceiptFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      runScan(file);
    },
    [runScan]
  );

  const handleStartOver = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setRows([]);
    setIgnoredLines(0);
    setReadText("");
    setProgress(0);
    setStage(STAGE_CAPTURE);
  }, []);

  // OCR dropped a line (it is counted in ignoredLines), or staff spot an item
  // the receipt photo shows but the parser missed: append a blank editable row
  // so the item can still be saved with everything else.
  const handleAddRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        key: `manual-${Date.now()}-${prev.length}`,
        raw: "(added by staff)",
        price: "",
        unit: "",
        ingredientId: "",
        confidence: 1,
        candidates: [],
      },
    ]);
  }, []);

  const handleRemoveRow = useCallback((key) => {
    setRows((prev) => prev.filter((row) => row.key !== key));
  }, []);

  const handleRowChange = useCallback((key, patch) => {
    setRows((prev) =>
      prev.map((row) => (row.key === key ? { ...row, ...patch } : row))
    );
  }, []);

  const handleIngredientChange = useCallback(
    (key, nextValue) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.key !== key) return row;
          const id = nextValue ? Number(nextValue) : null;
          if (!id) return { ...row, ingredientId: "" };
          const pool = [...(row.candidates || []), ...fallbackIngredients];
          const ingredient = pool.find((item) => Number(item.id) === id);
          // Connected to Ingredient Management, exactly like
          // MarketPriceModal: picking an ingredient picks that ingredient's
          // own unit, so a row never keeps a unit from a different
          // ingredient (and clearing the match clears the unit too).
          return {
            ...row,
            ingredientId: String(id),
            unit: ingredient ? ingredient.unit || "kg" : "",
          };
        })
      );
    },
    [fallbackIngredients]
  );

  // Candidate dropdown: the backend's top-5 fuzzy hits first, then every
  // other ingredient, deduplicated.
  const rowOptions = useMemo(
    () =>
      rows.map((row) => {
        const topIds = new Set((row.candidates || []).map((c) => Number(c.id)));
        return {
          top: row.candidates || [],
          rest: fallbackIngredients.filter((item) => !topIds.has(Number(item.id))),
        };
      }),
    [rows, fallbackIngredients]
  );

  const lowConfidenceKeys = useMemo(
    () => new Set(rows.filter((row) => row.confidence < LOW_CONFIDENCE).map((row) => row.key)),
    [rows]
  );

  // A row is committable only when it is matched to an ingredient and has a
  // usable price; everything else is dropped from the payload (and reported).
  const entries = useMemo(
    () =>
      rows
        .filter((row) => Number(row.ingredientId) > 0 && Number(row.price) > 0)
        .map((row) => ({
          ingredientId: Number(row.ingredientId),
          source,
          price: Number(Number(row.price).toFixed(2)),
          // Matched rows always carry their ingredient's unit; the fallback
          // only exists so a malformed row can never send unit: "" and make
          // bulk-upsert reject the whole payload.
          unit: row.unit || "kg",
          is_manual_entry: true,
          scraped_at: new Date().toISOString(),
          ocr_confidence: Number(Number(row.confidence).toFixed(3)),
        })),
    [rows, source]
  );

  const skippedCount = rows.length - entries.length;
  const savedCount = entries.filter((entry) => savedIds.has(entry.ingredientId)).length;
  const pendingCount = entries.length - savedCount;

  const handleSave = useCallback(async () => {
    if (saving) return;
    if (!entries.length) {
      toast.error(
        "Nothing to save yet — match a line to an ingredient and enter its price."
      );
      return;
    }

    setSaving(true);
    try {
      const result = await onCommit(entries, receiptFile);

      if (result && result.ok) {
        // Parent saved everything and closed the scanner.
        return;
      }

      const nextSaved = new Set(
        (result && Array.isArray(result.savedIngredientIds) && result.savedIngredientIds) || []
      );
      const nextFailed = new Set(
        (result && Array.isArray(result.failedIngredientIds) && result.failedIngredientIds) || []
      );
      setSavedIds(nextSaved);
      setFailedIds(nextFailed);

      if (!nextFailed.size) {
        // Parent could not say what failed — fall back to a generic message
        // (when it did report, its own toast already named the ingredients).
        toast.error("Saving failed. Please try again.");
      }
    } catch (error) {
      console.error("Receipt save failed:", error);
      toast.error(
        (error.response && error.response.data && error.response.data.error) ||
          error.message ||
          "Failed to save prices"
      );
    } finally {
      setSaving(false);
    }
  }, [saving, entries, receiptFile, onCommit]);

  const handleCancel = useCallback(async () => {
    if (saving) return;
    try {
      const unsaved = stage === STAGE_REVIEW && entries.length > savedIds.size;
      if (unsaved) {
        const result = await Swal.fire({
          title: "Discard this receipt scan?",
          text: "The prices you reviewed have not been saved yet.",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Yes, discard",
          cancelButtonText: "Keep reviewing",
          confirmButtonColor: "#d33",
          cancelButtonColor: "#6b7280",
        });
        if (!result.isConfirmed) return;
      }
      onClose();
    } catch (error) {
      console.error("Could not close the receipt scanner:", error);
      toast.error("Could not close the scanner");
    }
  }, [saving, stage, entries.length, savedIds, onClose]);

  const sourceLabel = String(source || "").replace(/_/g, " ");

  return (
    <InventoryModal className="modal-lg receipt-scanner" onClose={handleCancel}>
      <div className="modal-header inventory-modal-header">
        <h3 className="modal-title">Scan Receipt</h3>
        <button className="modal-close-btn" onClick={handleCancel} disabled={saving}>
          <FaTimes />
        </button>
      </div>

      <div className="modal-body inventory-modal-body receipt-body">
        {/* ============ STAGE 1: CAPTURE ============ */}
        {stage === STAGE_CAPTURE && (
          <div className="receipt-capture">
            {/* Two inputs on purpose: capture="environment" opens the phone
                camera directly, while the upload input also offers files
                (including PDF price lists) from the gallery/disk. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="receipt-file-input"
              onChange={handleFileSelected}
            />
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="receipt-file-input"
              onChange={handleFileSelected}
            />
            <div className="receipt-capture-actions">
              <button
                type="button"
                className="receipt-capture-btn"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
              >
                <FaCamera /> Take Receipt Photo
              </button>
              <button
                type="button"
                className="receipt-capture-btn receipt-capture-upload"
                onClick={() => uploadInputRef.current && uploadInputRef.current.click()}
              >
                <FaUpload /> Upload Photo or PDF
              </button>
            </div>
            <p className="receipt-capture-tip">
              Lay the receipt flat, use good lighting and avoid shadows. A PDF price list works
              too. Everything is read on this device — nothing is saved until you review and
              confirm every line.
            </p>
            <p className="receipt-capture-source">
              Market source: <strong>{sourceLabel || "not selected"}</strong>
            </p>
            {readText && (
              <div className="receipt-read-text">
                <p>
                  The scanner read this text but found no price lines in it. Check whether the
                  text below shows your prices — if it is gibberish, retake the photo closer and
                  flatter; if the prices are there, copy this text for support.
                </p>
                <pre>{readText}</pre>
              </div>
            )}
          </div>
        )}

        {/* ============ STAGE 2: SCANNING ============ */}
        {stage === STAGE_SCANNING && (
          <div className="receipt-scanning">
            {previewUrl &&
              (isPdfFile(receiptFile) ? (
                <div className="receipt-preview-pdf">
                  <FaFilePdf aria-hidden="true" />
                  <span>{receiptFile && receiptFile.name}</span>
                </div>
              ) : (
                <img className="receipt-preview" src={previewUrl} alt="Receipt being scanned" />
              ))}
            <div className="receipt-progress">
              <div
                className="receipt-progress-bar"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="receipt-status">
              <span className="spin" aria-hidden="true" /> {statusText} {progress}%
            </p>
            <button type="button" className="btn-secondary" onClick={handleStartOver}>
              Cancel scan
            </button>
          </div>
        )}

        {/* ============ STAGE 3: REVIEW ============ */}
        {stage === STAGE_REVIEW && (
          <div className="receipt-review">
            <p className="receipt-hint">
              Check every line before saving. <strong>Price is per unit</strong> — a line like{" "}
              <code>100/k</code> means 100 per kilo.{" "}
              <strong>Unit follows the matched ingredient</strong> from Ingredient Management
              (change it there, not here).
            </p>

            <div className="receipt-review-scroll">
              <table className="receipt-review-table">
                <thead>
                  <tr>
                    <th>Receipt line (raw)</th>
                    <th>Matched ingredient</th>
                    <th>Price</th>
                    <th>Unit</th>
                    <th aria-label="Remove row" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const options = rowOptions[index] || { top: [], rest: [] };
                    const locked = savedIds.has(Number(row.ingredientId));
                    return (
                      <tr
                        key={row.key}
                        className={rowClassName(row, lowConfidenceKeys, savedIds, failedIds)}
                      >
                        <td className="receipt-row-raw">
                          {row.raw}
                          {lowConfidenceKeys.has(row.key) && (
                            <span className="receipt-confidence-flag">
                              <FaExclamationTriangle /> low match
                            </span>
                          )}
                          {locked && <span className="receipt-saved-flag">saved</span>}
                        </td>
                        <td>
                          <select
                            className="receipt-match-select"
                            value={row.ingredientId}
                            disabled={locked}
                            onChange={(event) =>
                              handleIngredientChange(row.key, event.target.value)
                            }
                          >
                            <option value="">— no match —</option>
                            {options.top.length > 0 && (
                              <optgroup label="Top matches">
                                {options.top.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="All ingredients">
                              {options.rest.map((ingredient) => (
                                <option key={ingredient.id} value={ingredient.id}>
                                  {ingredient.name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </td>
                        <td>
                          <input
                            className="receipt-num-input receipt-price-input"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            value={row.price}
                            disabled={locked}
                            onChange={(event) =>
                              handleRowChange(row.key, { price: event.target.value })
                            }
                          />
                        </td>
                        {/* Read-only: the unit belongs to the matched
                            ingredient (Ingredient Management module), the
                            same behaviour as MarketPriceModal's unit field. */}
                        <td className="receipt-unit-cell">
                          {row.unit || <span className="receipt-unit-empty">—</span>}
                        </td>
                        <td className="receipt-remove-cell">
                          <button
                            type="button"
                            className="receipt-remove-btn"
                            title="Remove this line"
                            onClick={() => handleRemoveRow(row.key)}
                          >
                            <FaTrash />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button type="button" className="btn-secondary receipt-add-row" onClick={handleAddRow}>
              <FaPlus /> Add a line OCR missed
            </button>

            {pendingCount === 0 && rows.length > 0 && (
              <p className="receipt-save-error receipt-save-done">
                All lines on this receipt are already saved.
              </p>
            )}
            {failedIds.size > 0 && pendingCount > 0 && (
              <p className="receipt-save-error">
                {failedIds.size} ingredient(s) could not be saved — they are highlighted below.
                Fix or remove them, then press save again.
              </p>
            )}
          </div>
        )}
      </div>

      {stage === STAGE_REVIEW && (
        <div className="modal-footer inventory-modal-footer receipt-footer">
          <span className="receipt-footer-info">
            {entries.length} line(s) ready
            {skippedCount > 0 ? ` · ${skippedCount} skipped (no ingredient or price)` : ""}
            {savedCount > 0 ? ` · ${savedCount} already saved` : ""}
            {ignoredLines > 0
              ? ` · ${ignoredLines} receipt line(s) ignored as totals/headers — add them below if an item is missing`
              : ""}
          </span>
          <div className="receipt-footer-actions">
            <button type="button" className="btn-secondary" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSave}
              disabled={saving || entries.length === 0}
            >
              {saving ? (
                <>
                  <span className="spin" aria-hidden="true" /> Saving…
                </>
              ) : (
                <>
                  <FaSave /> Save confirmed prices
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </InventoryModal>
  );
};

export default ReceiptScanner;
