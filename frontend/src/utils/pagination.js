// Builds the sequence of page numbers a pagination control should render.
//
// Returns an array of numbers and the string "ellipsis". The first and last
// page are always included so both ends stay reachable, a moving window is
// shown around the current page, and "ellipsis" marks any skipped range.
//
// buildPageItems(20, 50) -> [1, "ellipsis", 19, 20, 21, "ellipsis", 50]
export const ELLIPSIS = "ellipsis";

export function buildPageItems(currentPage, totalPages, options = {}) {
  const { siblings = 1, maxWithoutEllipsis = 7 } = options;

  const total = Math.max(0, Math.floor(Number(totalPages) || 0));
  if (total === 0) return [];

  const current = Math.min(
    Math.max(Math.floor(Number(currentPage) || 1), 1),
    total,
  );

  if (total <= maxWithoutEllipsis) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const start = Math.max(2, current - siblings);
  const end = Math.min(total - 1, current + siblings);

  const items = [1];
  if (start > 2) items.push(ELLIPSIS);
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < total - 1) items.push(ELLIPSIS);
  items.push(total);

  return items;
}
