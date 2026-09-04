// Usage: <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import "./Pagination.css";

const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  const pageNumbers = [];
  const visiblePageCount = Math.max(0, totalPages);

  for (let page = 1; page <= Math.min(3, visiblePageCount); page += 1) {
    pageNumbers.push(page);
  }

  if (visiblePageCount > 5) {
    pageNumbers.push("ellipsis");
  }

  for (let page = Math.max(4, visiblePageCount - 1); page <= visiblePageCount; page += 1) {
    if (!pageNumbers.includes(page)) pageNumbers.push(page);
  }

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
