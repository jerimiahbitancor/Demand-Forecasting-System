// Usage: <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

import { useEffect, useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import "./Pagination.css";

// Viewport tiers, checked in order by useWindowTier. Each maps to one CSS tier
// in Pagination.css; they only control how many consecutive pages may be listed
// before the window starts inserting ellipses, since that is the one thing that
// decides how much horizontal room the row needs.
const WINDOW_TIERS = {
  // <= 360px. Controls shrink to 30px in the matching CSS tier, which is what
  // makes a five-slot window affordable at all.
  narrow: 5,
  // 361-640px. Controls shrink to 32px; five slots still fit on a 375px phone.
  compact: 5,
  // Desktop. Room for a seven-slot window.
  wide: 7,
};

const TIER_BREAKPOINTS = [
  { name: "narrow", maxWidth: 360 },
  { name: "compact", maxWidth: 640 },
];

// Pages either side of the current page that stay listed at every tier. The
// current page plus a neighbour on each side is what makes the row usable
// without stepping one page at a time; without it nothing looked selected once
// the list ran past nine pages.
const NEIGHBOURS = 1;

function readWindowTier() {
  if (typeof window === "undefined") return "wide";

  const match = TIER_BREAKPOINTS.find(({ maxWidth }) =>
    window.matchMedia(`(max-width: ${maxWidth}px)`).matches,
  );

  return match ? match.name : "wide";
}

function useWindowTier() {
  // Seed from matchMedia during the first render so the phone never paints a
  // wide desktop window and then reflows into the narrow one.
  const [tier, setTier] = useState(readWindowTier);

  useEffect(() => {
    const queries = TIER_BREAKPOINTS.map(({ maxWidth }) =>
      window.matchMedia(`(max-width: ${maxWidth}px)`),
    );

    // Re-read every query on any change instead of trusting the event target.
    // The tier depends on which query is the first to match, so resizing from
    // 640px to 361px has the narrow query go false without a change event on
    // it, and the tier would otherwise stay stuck on the wider window.
    const sync = () => setTier(readWindowTier());

    queries.forEach((query) => query.addEventListener("change", sync));
    return () => queries.forEach((query) => query.removeEventListener("change", sync));
  }, []);

  return tier;
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

// Inserts an ellipsis wherever two kept pages are not consecutive. Duplicates
// are dropped first: at either end of the list the current page is also the
// first or last one, so the window would otherwise repeat it.
function withGaps(window) {
  const unique = [...new Set(window)].sort((a, b) => a - b);
  const numbers = [];

  unique.forEach((page, index) => {
    if (index > 0 && page - unique[index - 1] > 1) numbers.push("ellipsis");
    numbers.push(page);
  });

  return numbers;
}

function buildPageNumbers(currentPage, totalPages, tier) {
  const total = Math.max(0, Math.floor(totalPages));
  if (total === 0) return [];

  const listAllUpTo = WINDOW_TIERS[tier];
  if (total <= listAllUpTo) return range(1, total);

  // Callers can hand over a stale page after rows are filtered or deleted.
  const current = Math.min(Math.max(currentPage, 1), total);

  // Both ends are pinned so neither is more than one tap away, with the current
  // page and a neighbour either side filling the middle. Clamping the window to
  // [2, total - 1] keeps it from repeating an end page that withGaps already
  // adds; at current === 1 or current === total the range collapses to empty
  // and the window falls back to just the two pinned ends.
  return withGaps([
    1,
    ...range(
      Math.max(2, current - NEIGHBOURS),
      Math.min(total - 1, current + NEIGHBOURS),
    ),
    total,
  ]);
}

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  const tier = useWindowTier();
  const visiblePageCount = Math.max(0, Math.floor(totalPages));
  const activePage = Math.min(Math.max(currentPage, 1), Math.max(visiblePageCount, 1));
  const pageNumbers = buildPageNumbers(currentPage, visiblePageCount, tier);

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="pagination-button pagination-button--navigation"
        onClick={() => onPageChange(activePage - 1)}
        disabled={activePage <= 1 || visiblePageCount === 0}
        aria-label="Previous page"
      >
        <FiChevronLeft size={16} aria-hidden="true" />
        <span className="pagination-button-label">Previous</span>
      </button>

      <div className="pagination-pages">
        {pageNumbers.map((page, index) =>
          page === "ellipsis" ? (
            <span key={`ellipsis-${index}`} className="pagination-ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              type="button"
              key={page}
              className={`pagination-button ${activePage === page ? "active" : ""}`}
              onClick={() => onPageChange(page)}
              aria-label={`Page ${page}`}
              aria-current={activePage === page ? "page" : undefined}
            >
              {page}
            </button>
          )
        )}
      </div>

      <button
        type="button"
        className="pagination-button pagination-button--navigation"
        onClick={() => onPageChange(activePage + 1)}
        disabled={activePage >= visiblePageCount || visiblePageCount === 0}
        aria-label="Next page"
      >
        <span className="pagination-button-label">Next</span>
        <FiChevronRight size={16} aria-hidden="true" />
      </button>
    </nav>
  );
};

export default Pagination;
