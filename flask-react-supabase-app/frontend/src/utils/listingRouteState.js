const LISTING_STATE_FIELDS = [
  // Stable identity and source metadata.
  'id', 'listing_type', 'listingType', 'categoryKey', 'categoryLabel',
  'source_platform', 'sourcePlatform', 'source_url', 'source_author', 'source_created_at',
  // Normalized card fields.
  'title', 'subtitle', 'description', 'location', 'priceLabel', 'numericPrice',
  'year', 'kilometers', 'createdAt', 'route', 'image', 'sellerDealerVerified',
  'sellerName', 'is_featured', 'featured_highlight',
  // Detail-page display fields shared by cars, bikes, parts, and plates.
  'listing_title', 'name', 'part_name', 'part_type', 'condition', 'status',
  'price', 'expected_selling_price', 'make_year', 'car_year', 'car_manufacturer',
  'car_model', 'car_trim', 'make', 'manufacturer', 'model', 'trim',
  'bike_brand', 'bike_model', 'bike_type', 'bike_category', 'engine_size',
  'engine_capacity', 'kilometer_driven', 'mileage', 'city', 'car_city', 'car_location',
  'area', 'emirate', 'code', 'number', 'digits', 'plate_format',
  'car_description', 'regional_spec', 'body_type', 'color', 'fuel_type',
  'transmission_type', 'cylinders', 'horsepower', 'doors', 'seating_capacity',
  'steering_side', 'warranty', 'service_history', 'is_insured', 'imported',
  'vin_number', 'wheels', 'seller_name', 'dealer_name', 'contact_name',
  'contact_phone', 'car_owner_phone_number', 'seller_profile_photo',
  'user_email', 'whatsapp_prefill_text',
];

const ARRAY_FIELDS = new Set(['images', 'car_images', 'bike_images', 'part_images', 'features', 'extras']);
const IMAGE_FIELDS = ['id', 'display_url', 'image_url', 'url', 'focal_x', 'focal_y', 'focalX', 'focalY'];
const SIMPLE_OBJECT_FIELDS = ['id', 'name', 'label', 'title', 'value'];

const isSafeScalar = (value) => (
  value === null
  || typeof value === 'string'
  || typeof value === 'number'
  || typeof value === 'boolean'
);

const copyArrayItem = (value, field) => {
  if (isSafeScalar(value)) return value;
  if (!value || typeof value !== 'object') return null;

  const fields = field === 'images' || field.endsWith('_images') ? IMAGE_FIELDS : SIMPLE_OBJECT_FIELDS;
  const copied = {};
  fields.forEach((key) => {
    if (isSafeScalar(value[key]) && value[key] !== null) copied[key] = value[key];
  });
  return Object.keys(copied).length ? copied : null;
};

const copyListingFields = (listing) => {
  const safe = {};
  LISTING_STATE_FIELDS.forEach((key) => {
    const value = listing[key];
    if (ARRAY_FIELDS.has(key)) {
      if (Array.isArray(value)) {
        safe[key] = value.map((item) => copyArrayItem(item, key)).filter(Boolean);
      }
      return;
    }
    if (isSafeScalar(value) && value !== undefined) safe[key] = value;
  });
  return safe;
};

export const sanitizeListingForClientState = (listing) => {
  if (!listing || typeof listing !== 'object') return {};
  return copyListingFields(listing);
};

export const buildListingRouteState = (listing, extra = {}) => ({
  listing: sanitizeListingForClientState(listing),
  ...extra,
});

// Detail pages render route state immediately for a fast transition, then
// replace it with the authoritative API row. Some list responses intentionally
// omit seller identity fields, so retain those already visible during that
// refresh instead of flashing a different seller label.
export const mergeListingDetail = (previous, next) => {
  const merged = { ...(previous || {}), ...(next || {}) };
  ['seller_name', 'dealer_name', 'contact_name', 'user_email', 'seller_profile_photo'].forEach((key) => {
    if ((merged[key] === null || merged[key] === undefined || merged[key] === '') && previous?.[key]) {
      merged[key] = previous[key];
    }
  });
  return merged;
};

const inferRoute = (listing) => {
  const type = String(listing?.listingType || listing?.listing_type || listing?.categoryKey || '').toLowerCase();
  const base = type === 'car' || type === 'cars'
    ? '/cars'
    : type === 'bike' || type === 'bikes'
      ? '/bikes'
      : type === 'part' || type === 'parts' || type === 'car-parts'
        ? '/car-parts'
        : type === 'plate' || type === 'plates'
          ? '/plates'
          : null;
  return base && listing?.id ? `${base}/${listing.id}` : null;
};

// Save-state projection for optimistic favourites and the saved-listings view.
// It accepts raw API rows and normalized card models, but never carries the
// normalized model's `raw` server-row escape hatch.
export const buildListingSaveData = (listing) => {
  const safe = sanitizeListingForClientState(listing);
  const route = typeof listing?.route === 'string' ? listing.route : inferRoute(listing);
  if (route) safe.route = route;

  const routeListing = listing?.routeState?.listing || listing;
  safe.routeState = buildListingRouteState(routeListing);
  return safe;
};
