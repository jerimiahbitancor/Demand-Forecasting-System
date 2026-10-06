// components/DashboardStateKit.jsx
//
// Shared building blocks for the setup / in-progress dashboard states
// (NoData, UploadedInsufficient, ReadyToTrain, TrainingInProgress,
// ForecastsReady, DataNeedsAttention).
//
// Everything here renders through state-kit.css, which reuses the landing
// page's design language (burgundy + cream, pill buttons, hairline borders,
// soft elevation, uppercase eyebrows) so the dashboard states read as the
// same product as the public site.
//
// These components are presentational only. Every state keeps its own data
// fetching and handlers; the kit only owns the layout and the look.
import { useState } from "react";
import Navbar from "../../components/Navbar/Navbar";
import "../states/statescss/state-kit.css";

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const DAYS = [
  "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
];

const formatDate = (date) =>
  `${MONTHS[date.getMonth()]}-${String(date.getDate()).padStart(2, "0")}-${date.getFullYear()}`;

const formatTime = (date) => {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
};

/* -------------------------------------------------------------------------
   StateShell — page frame: nav, page head, live progress, status banner.
   progress: { value, label, tone, caption, indeterminate }
   clockSlot: optional node rendered inside the clock strip (date picker, …)
   selectedDate: optional Date that replaces "today" in the clock strip, so a
     clockSlot date picker actually changes what the strip reports instead of
     being a decorative control.
   ---------------------------------------------------------------------- */
export const StateShell = ({
  eyebrow,
  eyebrowTone = "",
  title,
  lede,
  progress,
  status,
  clockSlot,
  selectedDate,
  children,
}) => {
  const now = new Date();
  const stamp = selectedDate instanceof Date ? selectedDate : now;

  return (
    <div className="sk-root">
      <Navbar />
      <main className="sk-main">
        <header className="sk-pagehead">
          <div className="sk-container">
            <div className="sk-pagehead-grid">
              <div>
                <span
                  className={`sk-eyebrow${eyebrowTone ? ` sk-eyebrow--${eyebrowTone}` : ""}`}
                >
                  {eyebrow}
                </span>
                <h1 className="sk-title">{title}</h1>
                {lede ? <p className="sk-lede">{lede}</p> : null}
              </div>

              <div className="sk-headside">
                {progress ? <ProgressMeter {...progress} /> : null}
                <div className="sk-clock">
                  {clockSlot}
                  {clockSlot ? <span className="sk-clock-sep">|</span> : null}
                  <span>{formatDate(stamp)}</span>
                  <span className="sk-clock-sep">|</span>
                  <span>{DAYS[stamp.getDay()]}</span>
                  <span className="sk-clock-sep">|</span>
                  <span>{formatTime(now)}</span>
                </div>
              </div>
            </div>

            {status ? <div style={{ marginTop: 30 }}>{status}</div> : null}
          </div>
        </header>

        <div className="sk-body">
          <div className="sk-container">{children}</div>
        </div>
      </main>
    </div>
  );
};

/* -------------------------------------------------------------------------
   ProgressMeter — the "System Status Progress" bar shared by every state.
   ---------------------------------------------------------------------- */
export const ProgressMeter = ({
  value,
  label = "System Status Progress",
  tone = "",
  caption,
  indeterminate = false,
}) => {
  const pct = Math.max(0, Math.min(value ?? 0, 100));

  return (
    <div className={`sk-progress${tone ? ` sk-progress--${tone}` : ""}`}>
      <div className="sk-progress-top">
        <span className="sk-progress-label">{label}</span>
        <span className="sk-progress-value">{indeterminate ? "…" : `${Math.round(pct)}%`}</span>
      </div>
      <div className="sk-progress-track">
        <div
          className={`sk-progress-fill${indeterminate ? " sk-progress-fill--indeterminate" : ""}`}
          style={{ width: `${indeterminate ? 100 : pct}%` }}
        />
      </div>
      {caption ? <p className="sk-progress-caption">{caption}</p> : null}
    </div>
  );
};

/* -------------------------------------------------------------------------
   StateBanner — status callout under the page head.
   tone: '' | ok | warn | danger | info
   ---------------------------------------------------------------------- */
export const StateBanner = ({ tone = "", icon, title, text, actions }) => (
  <div className={`sk-banner${tone ? ` sk-banner--${tone}` : ""}`}>
    {icon ? <span className="sk-banner-ico">{icon}</span> : null}
    <div style={{ minWidth: 0 }}>
      {title ? <p className="sk-banner-title">{title}</p> : null}
      {text ? <p className="sk-banner-text">{text}</p> : null}
      {actions ? <div className="sk-banner-foot">{actions}</div> : null}
    </div>
  </div>
);

/* -------------------------------------------------------------------------
   SetupStep — numbered step card (mirrors .lk-step on the landing page).
   ---------------------------------------------------------------------- */
export const SetupStep = ({ index, tone = "", icon, title, tag, children, foot }) => (
  <article className={`sk-card sk-card--hover${tone ? ` sk-card--${tone}` : ""}`}>
    <div className="sk-card-head">
      {index != null ? (
        <span className={`sk-step-num${tone === "ok" ? " sk-step-num--ok" : ""}`}>{index}</span>
      ) : (
        icon ? <span className="sk-card-ico">{icon}</span> : null
      )}
      <div style={{ minWidth: 0 }}>
        <h3 className="sk-card-title">{title}</h3>
        {tag ? <div className="sk-tags" style={{ marginTop: 9 }}>{tag}</div> : null}
      </div>
    </div>
    {children}
    {foot ? <div className="sk-card-foot">{foot}</div> : null}
  </article>
);

/* -------------------------------------------------------------------------
   Meter — labelled inline progress used inside cards (history span, etc).
   ---------------------------------------------------------------------- */
export const Meter = ({ label, value, percent, tone = "" }) => (
  <div className={`sk-meter${tone ? ` sk-meter--${tone}` : ""}`}>
    <div className="sk-meter-top">
      <span className="sk-meter-label">{label}</span>
      <span className="sk-meter-value">{value}</span>
    </div>
    <div className="sk-meter-track">
      <div
        className="sk-meter-fill"
        style={{ width: `${Math.max(0, Math.min(percent ?? 0, 100))}%` }}
      />
    </div>
  </div>
);

/* -------------------------------------------------------------------------
   Illustration — copy + artwork split, same rhythm as the landing hero.
   ---------------------------------------------------------------------- */
export const Illustration = ({ src, alt, copy, aside }) => (
  <section className="sk-split">
    <div>{copy}</div>
    <div className="sk-visual">
      <img src={src} alt={alt} />
      {aside}
    </div>
  </section>
);

/* -------------------------------------------------------------------------
   ProductsDetected — shared "products found in your sales data" table used by
   the three states that show it. limit keeps the card short; the remainder is
   summarised on the last row.
   ---------------------------------------------------------------------- */
export const ProductsDetected = ({
  products = [],
  needsRecipe = (p) => !p.product_ingredients?.length,
  onAddRecipe,
  limit = 3,
}) => {
  const missing = products.filter(needsRecipe);
  const visible = missing.slice(0, limit);
  const remainder = missing.length - visible.length;
  const allDone = missing.length === 0;

  // An empty list means the product request hasn't landed yet, not that every
  // product has a recipe. Saying "Complete" here would put a false all-clear on
  // screen for a moment on every visit.
  if (products.length === 0) {
    return (
      <div className="sk-products">
        <div className="sk-products-row sk-products-row--muted">
          <span className="sk-products-name">Checking your products…</span>
          <span />
        </div>
      </div>
    );
  }

  return (
    <div className="sk-products">
      <div className="sk-products-head">
        <span>Product Name</span>
        <span style={{ textAlign: "right" }}>Action</span>
      </div>

      {allDone ? (
        <div className="sk-products-row sk-products-row--done">
          <span className="sk-products-name">All products have recipes added</span>
          <span className="sk-products-done">Complete</span>
        </div>
      ) : (
        visible.map((product, index) => (
          <div
            className="sk-products-row"
            key={product.id || `${product.name}-${index}`}
          >
            <span className="sk-products-name">{product.name}</span>
            <span style={{ textAlign: "right" }}>
              <button
                type="button"
                className="sk-btn sk-btn--secondary sk-btn--sm"
                onClick={() => onAddRecipe?.(product.name)}
              >
                Add Recipe
              </button>
            </span>
          </div>
        ))
      )}

      {remainder > 0 ? (
        <div className="sk-products-row sk-products-row--muted">
          <span className="sk-products-name">+ {remainder} more products needing recipes</span>
          <span />
        </div>
      ) : null}
    </div>
  );
};

/* -------------------------------------------------------------------------
   MonthPicker — small date popover used by the "needs attention" state.
   ---------------------------------------------------------------------- */
export const MonthPicker = ({ onSelect }) => {
  const [viewDate, setViewDate] = useState(new Date());

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const today = new Date();
  const monthName = viewDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="sk-picker">
      <div className="sk-picker-head">
        <button
          type="button"
          className="sk-picker-nav"
          aria-label="Previous month"
          onClick={() =>
            setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))
          }
        >
          &#8249;
        </button>
        <span className="sk-picker-month">{monthName}</span>
        <button
          type="button"
          className="sk-picker-nav"
          aria-label="Next month"
          onClick={() =>
            setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))
          }
        >
          &#8250;
        </button>
      </div>

      <div className="sk-picker-grid">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
          <span className="sk-picker-dow" key={day}>
            {day}
          </span>
        ))}
        {Array.from({ length: firstDayOfMonth }, (_, i) => (
          <span key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const isToday =
            day === today.getDate() &&
            viewDate.getMonth() === today.getMonth() &&
            viewDate.getFullYear() === today.getFullYear();
          return (
            <button
              type="button"
              key={day}
              className={`sk-picker-day${isToday ? " sk-picker-day--today" : ""}`}
              onClick={() =>
                onSelect(new Date(viewDate.getFullYear(), viewDate.getMonth(), day))
              }
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default StateShell;