// components/shared/InfoBanner.jsx
//
// Small reusable "callout" box used everywhere across the Analytics tabs:
// the green info banners, the amber tip banners, etc. Every wireframe
// reuses this exact same shape (icon + text), so instead of copy-pasting
// the markup into Forecasting.jsx, ProductPerformance.jsx, and
// IngredientDemand.jsx three times, it lives here once.
//
// This is the practical React equivalent of encapsulation: one component
// owns the "info banner" concept, and every screen that needs one just
// configures it via props instead of re-implementing it.

import { FiInfo } from "react-icons/fi";

/**
 * @param {"info" | "tip"} variant - controls color (green vs amber)
 * @param {React.ReactNode} icon - optional icon override (defaults to FiInfo)
 * @param {React.ReactNode} children - banner text/content
 */
function InfoBanner({ variant = "info", icon, children }) {
  return (
    <div className={`info-banner info-banner--${variant}`}>
      <span className="info-banner-icon">{icon || <FiInfo size={16} />}</span>
      <p className="info-banner-text">{children}</p>
    </div>
  );
}

export default InfoBanner;