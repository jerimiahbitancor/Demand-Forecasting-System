// Usage: <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

import { useEffect, useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import "./Pagination.css";

// Phones have ~320px of usable width. Prev + Next at 40px each leave ~230px,
// which fits at most 5 page buttons at 40px. Rendering the same 1,2,3,…,N
// window as desktop would force the row to wrap onto several lines, so phones
// get a narrower window centred on the current page instead.
function useIsCompact() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const sync = () => setIsCompact(query.matches);

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isCompact;
}

function buildPageNumbers(currentPage, totalPages, isCompact) {
  const numbers = [];

  if (isCompact) {
    // Single page: nothing to window around.
    if (totalPages <= 1) return [1];

    // Always show first and last so the ends stay reachable, plus the
    // current page and its immediate neighbours in between.
    const candidates = new Set([1, totalPages, currentPage]);
    if (currentPage - 1 > 1) candidates.add(currentPage - 1);
    if (currentPage + 1 < totalPages) candidates.add(currentPage + 1);

    const sorted = [...candidates].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

    sorted.forEach((page, index) => {
      if (index > 0 && page - sorted[index - 1] > 1) numbers.push("ellipsis");
      numbers.push(page);
    });

    return numbers;
  }

  for (let page = 1; page <= Math.min(3, totalPages); page += 1) {
    numbers.push(page);
  }

  if (totalPages > 5) {
    numbers.push("ellipsis");
  }

  for (let page = Math.max(4, totalPages - 1); page <= totalPages; page += 1) {
    if (!numbers.includes(page)) numbers.push(page);
  }

  return numbers;
}

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  const isCompact = useIsCompact();
  const visiblePageCount = Math.max(0, totalPages);
  const pageNumbers = buildPageNumbers(currentPage, visiblePageCount, isCompact);

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="pagination-button pagination-button--navigation"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
      >
        <FiChevronLeft size={16} /> Previous
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
              className={`pagination-button ${currentPage === page ? "active" : ""}`}
              onClick={() => onPageChange(page)}
              aria-current={currentPage === page ? "page" : undefined}
            >
              {page}
            </button>
          )
        )}
      </div>

      <button
        type="button"
        className="pagination-button pagination-button--navigation"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= visiblePageCount || visiblePageCount === 0}
      >
        Next <FiChevronRight size={16} />
      </button>
    </nav>
  );
};

export default Pagination;
