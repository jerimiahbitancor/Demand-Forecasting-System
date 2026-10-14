// components/UploadSummaryReport.jsx
//
// Shown after a sales upload finishes (owner's v3 flowchart, page 2,
// "Output (upload summary)"), and stays until the owner closes it:
//   - problems found in rejected files (row, column, message)
//   - stock shortfalls
//   - new products, and new products whose name looks like an existing one
//   - item names that matched no product
//   - names matched through an alias ("OG Tapsilog -> Original Tapsilog")
//   - products sold with modifiers (plates per modifier)
//   - products with a size word (information only)
// The report data comes from utils/uploadSummary.js.
import { Link } from "react-router-dom";
import { FiX } from "react-icons/fi";
import { formatPlates, hasSummaryContent } from "../utils/uploadSummary";
import "./UploadSummaryReport.css";

const MAX_CELL_ERRORS = 50;
const PRODUCT_MANAGEMENT = "/inventory-management?tab=product";

const Section = ({ title, count, tone = "info", children }) => (
  <section className={`upload-report__section upload-report__section--${tone}`}>
    <h4 className="upload-report__heading">
      {title} <span className="upload-report__count">({count})</span>
    </h4>
    {children}
  </section>
);

const UploadSummaryReport = ({ report, onClose }) => {
  if (!report) return null;
  const { summary, cellErrors = [], filesUploaded = 0, totalFiles = 0 } = report;
  const hasContent = hasSummaryContent(summary);
  if (!hasContent && cellErrors.length === 0) return null;

  return (
    <div className="upload-report" role="region" aria-label="Upload summary">
      <div className="upload-report__top">
        <div>
          <h3 className="upload-report__title">Upload summary</h3>
          <p className="upload-report__sub">{filesUploaded} of {totalFiles} file(s) uploaded.</p>
        </div>
        <button type="button" className="upload-report__close" onClick={onClose} aria-label="Close upload summary">
          <FiX />
        </button>
      </div>

      {cellErrors.length > 0 && (
        <Section title="Problems found (these files were not uploaded)" count={cellErrors.length} tone="error">
          <div className="upload-report__table-wrap">
            <table className="upload-report__table">
              <thead><tr><th>File</th><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
              <tbody>
                {cellErrors.slice(0, MAX_CELL_ERRORS).map((e, i) => (
                  <tr key={`${e.file}-${e.row}-${e.column}-${i}`}>
                    <td>{e.file}</td><td>{e.row ?? "—"}</td><td>{e.column ?? "—"}</td><td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cellErrors.length > MAX_CELL_ERRORS && (
            <p className="upload-report__note">…and {cellErrors.length - MAX_CELL_ERRORS} more. Fix the file and upload it again.</p>
          )}
        </Section>
      )}

      {summary.shortfalls.length > 0 && (
        <Section title="Stock shortfalls" count={summary.shortfalls.length} tone="warning">
          <ul className="upload-report__list">
            {summary.shortfalls.map((s) => (
              <li key={s.ingredientId}>
                {s.message}{s.files > 1 ? ` (${s.files} files ran short)` : ""}
              </li>
            ))}
          </ul>
          <p className="upload-report__note">Stock stays at 0. Count the real stock and update it in Ingredient Management.</p>
        </Section>
      )}

      {summary.newProducts.length > 0 && (
        <Section title="New products created" count={summary.newProducts.length}>
          <ul className="upload-report__list">
            {summary.newProducts.map((p) => <li key={p.name}>{p.name}</li>)}
          </ul>
          {summary.possibleDuplicates.length > 0 && (
            <>
              <p className="upload-report__note"><strong>Possible duplicates</strong></p>
              <ul className="upload-report__list">
                {summary.possibleDuplicates.map((d) => (
                  <li key={`${d.newProduct.id}-${d.looksLike.id}`}>
                    &quot;{d.newProduct.name}&quot; looks like &quot;{d.looksLike.name}&quot;
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="upload-report__note">
            Add a price and a recipe for new products in <Link to={PRODUCT_MANAGEMENT}>Product Management</Link>.
          </p>
        </Section>
      )}

      {summary.unmatchedNames.length > 0 && (
        <Section title="Item names not matched (plates not counted)" count={summary.unmatchedNames.length} tone="warning">
          <ul className="upload-report__list">
            {summary.unmatchedNames.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </Section>
      )}

      {summary.aliasMatches.length > 0 && (
        <Section title="Names matched through an alias" count={summary.aliasMatches.length}>
          <ul className="upload-report__list">
            {summary.aliasMatches.map((a) => <li key={a.alias}>{a.alias} → {a.productName}</li>)}
          </ul>
        </Section>
      )}

      {summary.modifierProducts.length > 0 && (
        <Section title="Products with modifiers" count={summary.modifierProducts.length}>
          <ul className="upload-report__list">
            {summary.modifierProducts.map((m) => <li key={m.productId}>{m.name}: {formatPlates(m.plates)} plate(s)</li>)}
          </ul>
        </Section>
      )}

      {summary.sizeProducts.length > 0 && (
        <Section title="Products with a size in the name" count={summary.sizeProducts.length}>
          <ul className="upload-report__list">
            {summary.sizeProducts.map((p) => <li key={p.productId}>{p.name}</li>)}
          </ul>
          <p className="upload-report__note">For information only. Sizes will be grouped later.</p>
        </Section>
      )}
    </div>
  );
};

export default UploadSummaryReport;
