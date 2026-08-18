// Pure builders for the /api/bikes browse query. Kept out of the screen so the
// sort/filter/pagination mapping can be unit-tested without rendering RN.
// Mirrors carsQuery.js — backend only reads limit/offset (never page/per_page),
// so pagination must be expressed as an offset here, not a page number.

export const BIKES_SORT_OPTIONS = [
  { label: 'Newest', order: 'created_at.desc' },
  { label: 'Oldest', order: 'created_at.asc' },
  { label: 'Price: Low to High', order: 'price.asc' },
  { label: 'Price: High to Low', order: 'price.desc' },
  { label: 'Year: High to Low', order: 'year.desc' },
  { label: 'KM: High to Low', order: 'mileage.desc' },
];

export const BIKES_PRICE_RANGES = [
  { label: 'Any', min: 0, max: 0 },
  { label: 'Under 10k', min: 0, max: 10000 },
  { label: '10k - 25k', min: 10000, max: 25000 },
  { label: '25k - 50k', min: 25000, max: 50000 },
  { label: '50k - 100k', min: 50000, max: 100000 },
  { label: 'Above 100k', min: 100000, max: 0 },
];

// Returns the query param array (no leading path) for a bikes page fetch. Maps
// UI filter state to the backend get_bikes param names (bike_brand/bike_type/
// price_from/price_to — matches the DB columns, same convention as cars).
export function buildBikesQueryParams(pageNum, pageSize, filters) {
  const offset = (pageNum - 1) * pageSize;
  const params = [`limit=${pageSize}`, `offset=${offset}`];
  const sortOpt = BIKES_SORT_OPTIONS.find((s) => s.label === filters.sort) || BIKES_SORT_OPTIONS[0];
  params.push(`order=${encodeURIComponent(sortOpt.order)}`);
  if (filters.brand) params.push(`bike_brand=${encodeURIComponent(filters.brand)}`);
  if (filters.type) params.push(`bike_type=${encodeURIComponent(filters.type)}`);
  if (filters.priceRange) {
    if (filters.priceRange.min > 0) params.push(`price_from=${filters.priceRange.min}`);
    if (filters.priceRange.max > 0) params.push(`price_to=${filters.priceRange.max}`);
  }
  if (filters.hideReddit) params.push('exclude_reddit=true');
  return params;
}

export function buildBikesQuery(pageNum, pageSize, filters) {
  return `/api/bikes?${buildBikesQueryParams(pageNum, pageSize, filters).join('&')}`;
}
