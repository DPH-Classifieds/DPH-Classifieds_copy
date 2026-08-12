const slugify = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const buildCarPath = (listing = {}) => {
  const id = String(listing.id || '').trim();
  if (!id) return '/cars';

  const displayTitle = String(listing.listing_title || '')
    .replace(/^\s*(wts|for sale)\s*:\s*/i, '')
    .trim();
  const vehicleDescriptor = displayTitle || [
    listing.make_year || listing.car_year,
    listing.car_manufacturer || listing.make,
    listing.car_model || listing.model,
    listing.trim || listing.car_trim,
  ].filter(Boolean).join(' ');
  const descriptor = [vehicleDescriptor, listing.car_city || listing.city || listing.location]
    .map(slugify)
    .filter(Boolean)
    .join('-')
    .slice(0, 88)
    .replace(/-+$/g, '');
  const shortId = id.slice(0, 8).toLowerCase();

  return `/cars/${descriptor ? `${descriptor}-` : ''}${shortId}`;
};

export const getCarSlug = (listing = {}) => buildCarPath(listing).split('/').pop();
