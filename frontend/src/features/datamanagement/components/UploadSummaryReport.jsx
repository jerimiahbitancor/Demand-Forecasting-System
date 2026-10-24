// components/UploadSummaryReport.jsx
//
// Shown after a sales upload finishes (owner's v3 flowchart, page 2,
// "Output (upload summary)"), and stays until the owner closes it:
//   - files NOT saved because an ingredient did not have enough stock
//   - problems found in rejected files (row, column, message)
//   - new products, and new products whose name looks like an existing one
//   - item names that matched no product
//   - names matched through an alias ("OG Tapsilog -> Original Tapsilog")
//   - products sold with modifiers (plates per modifier)
//   - products with a size word (information only)
// The report data comes from utils/uploadSummary.js.
import { Link } from "react-router-dom";
import { FiX } from "react-icons/fi";
import { formatPlates, hasSummaryContent } from "../utils/uploadSummary";
import { formatStockQty } from "../../../utils/formatStockQty";
import "./UploadSummaryReport.css";

const MAX_CELL_ERRORS = 50;
const PRODUCT_MANAGEMENT = "/inventory-management?tab=product";
const INGREDIENT_MANAGEMENT = "/ingredient-management";

// "Kilograms (kg)" -> "kg"
const unitLabel = (unit) => {
  const text = String(unit || "").trim();
  const inner = /\(([^)]+)\)\s*$/.exec(text);
  return inner ? inner[1].trim() : text;
};
const amount = (value, unit) => `${formatStockQty(value, unit)}${unit ? ` ${unitLabel(unit)}` : ""}`;

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
  const { summary, cellErrors = [], stockRefusals = [], filesUploaded = 0, totalFiles = 0 } = report;
  const hasContent = hasSummaryContent(summary);
  if (!hasContent && cellErrors.length === 0 && stockRefusals.length === 0) return null;
  const refusedFiles = new Set(stockRefusals.map((r) => r.file)).size;

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

      {stockRefusals.length > 0 && (
        <Section
          title={`Not saved: not enough stock (${refusedFiles} file${refusedFiles === 1 ? "" : "s"})`}
          count={stockRefusals.length}
          tone="error"
        >
          <div className="upload-report__table-wrap">
            <table className="upload-report__table">
              <thead><tr><th>File</th><th>Ingredient</th><th>Needed</th><th>In stock</th><th>Short by</th></tr></thead>
              <tbody>
                {stockRefusals.map((r, i) => (
                  <tr key={`${r.file}-${r.ingredientId}-${i}`}>
                    <td>{r.file}</td>
                    <td>{r.ingredient}</td>
                    <td>{amount(r.required, r.unit)}</td>
                    <td>{amount(r.available, r.unit)}</td>
                    <td>{amount(r.shortfall, r.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="upload-report__note">
            Nothing from these files was saved: no sales and no stock deducted. Restock the ingredients
            or correct the count in <Link to={INGREDIENT_MANAGEMENT}>Ingredient Management</Link>, then
            upload the same files again.
          </p>
        </Section>
      )}

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

      {summary.followUpErrors.length > 0 && (
        <Section title="Follow-up update did not finish" count={summary.followUpErrors.length} tone="error">
          <ul className="upload-report__list">
            {summary.followUpErrors.map((m) => <li key={m}>{m}</li>)}
          </ul>
          <p className="upload-report__note">The sales and stock were saved; only the product category/status update after them failed. Check the backend logs.</p>
        </Section>
      )}

      {summary.stockNotDeducted.length > 0 && (
        <Section title="Ingredients not deducted" count={summary.stockNotDeducted.length} tone="warning">
          <ul className="upload-report__list">
            {summary.stockNotDeducted.map((s) => <li key={`${s.ingredientId}-${s.reason}`}>{s.message}</li>)}
          </ul>
          <p className="upload-report__note">
            Editing an ingredient&apos;s quantity counts as a stock count, so sales from days that ended before
            that edit are not deducted again. Use Restock to add deliveries instead.
          </p>
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
