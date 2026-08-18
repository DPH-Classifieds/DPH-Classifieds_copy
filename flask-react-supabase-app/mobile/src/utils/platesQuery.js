// Pure builders for the /api/plates browse query. Mirrors carsQuery.js/bikesQuery.js —
// backend only reads limit/offset (never page/per_page), so pagination must be
// expressed as an offset here, not a page number.

export const PLATES_SORT_OPTIONS = [
  { label: 'Newest', order: 'created_at.desc' },
  { label: 'Oldest', order: 'created_at.asc' },
  { label: 'Price: Low to High', order: 'price.asc' },
  { label: 'Price: High to Low', order: 'price.desc' },
];

// Returns the query param array (no leading path) for a plates page fetch. Maps
// UI filter state to the backend get_plates param names (city/digits — matches
// the DB columns directly).
export function buildPlatesQueryParams(pageNum, pageSize, filters) {
  const offset = (pageNum - 1) * pageSize;
  const params = [`limit=${pageSize}`, `offset=${offset}`];
  const sortOpt = PLATES_SORT_OPTIONS.find((s) => s.label === filters.sort) || PLATES_SORT_OPTIONS[0];
  params.push(`order=${encodeURIComponent(sortOpt.order)}`);
  if (filters.city) params.push(`city=${encodeURIComponent(filters.city)}`);
  if (filters.digits && filters.digits !== 'Any') params.push(`digits=${filters.digits}`);
  if (filters.hideReddit) params.push('exclude_reddit=true');
  return params;
}

export function buildPlatesQuery(pageNum, pageSize, filters) {
  return `/api/plates?${buildPlatesQueryParams(pageNum, pageSize, filters).join('&')}`;
}
