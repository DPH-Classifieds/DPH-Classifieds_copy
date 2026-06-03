export const formatNumber = (value) => {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('en-AE').format(Number.isFinite(numeric) ? numeric : 0);
};

export const formatCurrencyAED = (value) => {
  const numeric = Number(value || 0);
  if (!numeric) {
    return 'Price on request';
  }

  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0,
  }).format(numeric);
};

export const formatDateTime = (value) => {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
};

export const formatDate = (value) => {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString();
};

export const getDisplayName = (user) =>
  user?.display_name ||
  [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
  user?.username ||
  user?.email ||
  'Unknown user';

export const getEventActorLabel = (event) =>
  event?.actor_name ||
  event?.actor_username ||
  event?.actor_email ||
  (event?.user_id ? 'Unknown user' : 'Guest');

export const getListingTitle = (listing) => {
  if (!listing) {
    return 'Unknown listing';
  }

  return (
    listing.display_title ||
    listing.listing_title ||
    listing.title ||
    listing.name ||
    [listing.car_year || listing.make_year, listing.car_manufacturer || listing.make, listing.car_model || listing.model]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    `Listing ${listing.id || ''}`.trim()
  );
};

export const getListingTypeLabel = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'car' || normalized === 'cars') return 'Cars';
  if (normalized === 'bike' || normalized === 'bikes') return 'Bikes';
  if (normalized === 'part' || normalized === 'parts' || normalized === 'car-parts') return 'Parts';
  if (normalized === 'plate' || normalized === 'plates') return 'Plates';
  if (normalized === 'buying_request' || normalized === 'buying_requests') return 'Buying Requests';
  return normalized || 'Listing';
};

export const getStatusTone = (status) => {
  const normalized = String(status || 'unknown').toLowerCase();
  if (normalized === 'approved' || normalized === 'active' || normalized === 'verified') return 'success';
  if (normalized === 'pending') return 'warning';
  if (normalized === 'rejected' || normalized === 'suspended' || normalized === 'banned') return 'danger';
  return 'neutral';
};
