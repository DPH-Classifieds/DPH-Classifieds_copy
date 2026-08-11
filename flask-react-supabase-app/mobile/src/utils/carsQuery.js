// Pure builders for the /api/cars browse query. Kept out of the screen so the
// sort/filter/exclude-reddit mapping can be unit-tested without rendering RN.

export const CARS_SORT_OPTIONS = [
  { label: 'Newest', order: 'created_at.desc' },
  { label: 'Oldest', order: 'created_at.asc' },
  { label: 'Price: Low to High', order: 'expected_selling_price.asc' },
  { label: 'Price: High to Low', order: 'expected_selling_price.desc' },
  { label: 'Year: High to Low', order: 'make_year.desc' },
  { label: 'Year: Low to High', order: 'make_year.asc' },
  { label: 'KM: Low to High', order: 'kilometer_driven.asc' },
  { label: 'KM: High to Low', order: 'kilometer_driven.desc' },
];

export const CARS_PRICE_RANGES = [
  { label: 'Any', min: 0, max: 0 },
  { label: 'Under 20k', min: 0, max: 20000 },
  { label: '20k - 50k', min: 20000, max: 50000 },
  { label: '50k - 100k', min: 50000, max: 100000 },
  { label: '100k - 200k', min: 100000, max: 200000 },
  { label: '200k - 500k', min: 200000, max: 500000 },
  { label: 'Above 500k', min: 500000, max: 0 },
];

export const CARS_KM_RANGES = [
  { label: 'Any', min: 0, max: 0 },
  { label: 'Under 20k km', min: 0, max: 20000 },
  { label: '20k - 50k km', min: 20000, max: 50000 },
  { label: '50k - 100k km', min: 50000, max: 100000 },
  { label: '100k - 150k km', min: 100000, max: 150000 },
  { label: 'Above 150k km', min: 150000, max: 0 },
];

// Returns the query param array (no leading path) for a cars page fetch. Maps
// UI filter state to the backend get_cars param names.
export function buildCarsQueryParams(pageNum, pageSize, filters) {
  const offset = (pageNum - 1) * pageSize;
  const params = [`limit=${pageSize}`, `offset=${offset}`];
  const sortOpt = CARS_SORT_OPTIONS.find((s) => s.label === filters.sort) || CARS_SORT_OPTIONS[0];
  params.push(`order=${encodeURIComponent(sortOpt.order)}`);
  if (filters.make) params.push(`car_manufacturer=${encodeURIComponent(filters.make)}`);
  if (filters.model) params.push(`car_model=${encodeURIComponent(filters.model)}`);
  if (filters.bodyType) params.push(`body_type=${encodeURIComponent(filters.bodyType)}`);
  if (filters.city) params.push(`car_city=${encodeURIComponent(filters.city)}`);
  if (filters.yearFrom) params.push(`make_year_from=${filters.yearFrom}`);
  if (filters.yearTo) params.push(`make_year_to=${filters.yearTo}`);
  if (filters.fuel) params.push(`fuel_type=${encodeURIComponent(filters.fuel)}`);
  if (filters.transmission) params.push(`transmission_type=${encodeURIComponent(filters.transmission)}`);
  // Secondary filters (parity with web; backend accepts each as eq.{value}).
  if (filters.regionalSpec) params.push(`regional_spec=${encodeURIComponent(filters.regionalSpec)}`);
  if (filters.steering) params.push(`steering_side=${encodeURIComponent(filters.steering)}`);
  if (filters.seating) params.push(`seating_capacity=${encodeURIComponent(filters.seating)}`);
  if (filters.horsepower) params.push(`horsepower=${encodeURIComponent(filters.horsepower)}`);
  if (filters.engineCapacity) params.push(`engine_capacity=${encodeURIComponent(filters.engineCapacity)}`);
  if (filters.priceRange) {
    if (filters.priceRange.min > 0) params.push(`price_from=${filters.priceRange.min}`);
    if (filters.priceRange.max > 0) params.push(`price_to=${filters.priceRange.max}`);
  }
  if (filters.mileageRange) {
    if (filters.mileageRange.min > 0) params.push(`kilometer_from=${filters.mileageRange.min}`);
    if (filters.mileageRange.max > 0) params.push(`kilometer_to=${filters.mileageRange.max}`);
  }
  if (filters.hideReddit) params.push('exclude_reddit=true');
  return params;
}

export function buildCarsQuery(pageNum, pageSize, filters) {
  return `/api/cars?${buildCarsQueryParams(pageNum, pageSize, filters).join('&')}`;
}
