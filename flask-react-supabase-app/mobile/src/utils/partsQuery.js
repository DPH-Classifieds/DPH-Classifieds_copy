// Pure builders for the /api/parts browse query. Mirrors carsQuery.js/bikesQuery.js —
// backend only reads limit/offset (never page/per_page), so pagination must be
// expressed as an offset here, not a page number.

export const PARTS_SORT_OPTIONS = [
  { label: 'Newest', order: 'created_at.desc' },
  { label: 'Oldest', order: 'created_at.asc' },
  { label: 'Price: Low to High', order: 'price.asc' },
  { label: 'Price: High to Low', order: 'price.desc' },
];

// Returns the query param array (no leading path) for a parts page fetch. Maps
// UI filter state to the backend get_parts param names (condition/part_type —
// matches the DB columns directly).
export function buildPartsQueryParams(pageNum, pageSize, filters) {
  const offset = (pageNum - 1) * pageSize;
  const params = [`limit=${pageSize}`, `offset=${offset}`];
  const sortOpt = PARTS_SORT_OPTIONS.find((s) => s.label === filters.sort) || PARTS_SORT_OPTIONS[0];
  params.push(`order=${encodeURIComponent(sortOpt.order)}`);
  if (filters.condition) params.push(`condition=${encodeURIComponent(filters.condition)}`);
  if (filters.partType) params.push(`part_type=${encodeURIComponent(filters.partType)}`);
  if (filters.hideReddit) params.push('exclude_reddit=true');
  return params;
}

export function buildPartsQuery(pageNum, pageSize, filters) {
  return `/api/parts?${buildPartsQueryParams(pageNum, pageSize, filters).join('&')}`;
}
