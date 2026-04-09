import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAccessToken } from '../utils/supabaseClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/MyListings.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const getImageUrl = (image) => {
  if (!image) return null;

  const imageUrl = image.image_url || image.url || image;
  if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('/')) {
    return `${API_URL}${imageUrl}`;
  }
  return imageUrl;
};

const TYPE_CONFIG = {
  car: {
    label: 'Car',
    detailPath: (id) => `/cars/${id}`,
    editPath: (id) => `/edit-listing/${id}`,
    deletePath: (id) => `${API_URL}/api/cars/${id}`,
    createPath: '/post-car',
  },
  bike: {
    label: 'Bike',
    detailPath: (id) => `/bikes/${id}`,
    deletePath: (id) => `${API_URL}/api/bikes/${id}`,
    createPath: '/post-bike',
  },
  part: {
    label: 'Part',
    detailPath: (id) => `/car-parts/${id}`,
    deletePath: (id) => `${API_URL}/api/parts/${id}`,
    createPath: '/post-car-parts',
  },
  plate: {
    label: 'Plate',
    detailPath: (id) => `/plates/${id}`,
    deletePath: (id) => `${API_URL}/api/plates/${id}`,
    createPath: '/post-plate',
  },
};

const SELL_ACTIONS = [
  { label: 'Post Car', href: '/post-car' },
  { label: 'Post Bike', href: '/post-bike' },
  { label: 'Post Part', href: '/post-car-parts' },
  { label: 'Post Plate', href: '/post-plate' },
];

const formatMoney = (value) => {
  if (value === undefined || value === null || value === '') return 'Price on request';
  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) return `AED ${value}`;
  return `AED ${numericValue.toLocaleString()}`;
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleDateString();
};

const buildListingTitle = (listing) => {
  switch (listing.listing_type) {
    case 'car':
      return listing.listing_title || `${listing.make_year || ''} ${listing.car_manufacturer || ''} ${listing.car_model || ''}`.trim();
    case 'bike':
      return `${listing.year || ''} ${listing.make || listing.bike_brand || ''} ${listing.model || listing.bike_model || ''}`.trim();
    case 'part':
      return listing.name || 'Car Part Listing';
    case 'plate':
      return `${listing.city || ''} ${listing.code || ''} ${listing.number || ''}`.trim() || 'Plate Listing';
    default:
      return 'Listing';
  }
};

const buildListingSubtitle = (listing) => {
  switch (listing.listing_type) {
    case 'car':
      return `${listing.body_type || 'Vehicle'}${listing.kilometer_driven ? ` • ${Number(listing.kilometer_driven).toLocaleString()} km` : ''}`;
    case 'bike':
      return `${listing.bike_type || 'Bike'}${listing.mileage ? ` • ${Number(listing.mileage).toLocaleString()} km` : ''}`;
    case 'part':
      return `${listing.part_type || 'Part'}${listing.condition ? ` • ${listing.condition}` : ''}`;
    case 'plate':
      return `${listing.city || 'Plate'}${listing.digits ? ` • ${listing.digits} digits` : ''}`;
    default:
      return '';
  }
};

const getListingPrice = (listing) =>
  listing.expected_selling_price ?? listing.price ?? null;

const getLifecycleCopy = (listing) => {
  if (listing.listing_state === 'expired') {
    return `Expired on ${formatDate(listing.expired_at || listing.expires_at)}. Deletes in ${listing.days_until_deletion ?? 0} day${listing.days_until_deletion === 1 ? '' : 's'}.`;
  }

  return `Expires on ${formatDate(listing.expires_at)}${listing.days_until_expiry !== undefined ? ` • ${listing.days_until_expiry} day${listing.days_until_expiry === 1 ? '' : 's'} left` : ''}`;
};

const getPrimaryImage = (listing) => {
  if (!listing.images || listing.images.length === 0) return null;
  if (listing.listing_type === 'plate') {
    return getImageUrl(listing.images.find((img) => img.is_primary) || listing.images[0]);
  }
  return getImageUrl(listing.images[0]);
};

const MyListings = () => {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actioningId, setActioningId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchUserListings();
  }, []);

  const fetchUserListings = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Authentication token not found');
      }

      const response = await fetch(`${API_URL}/api/user/listings`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch your listings');
      }

      const payload = await response.json();
      setListings(Array.isArray(payload.listings) ? payload.listings : []);
    } catch (err) {
      console.error('Error fetching listings:', err);
      setError('Could not load your listings. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const listingsByType = useMemo(() => {
    return listings.reduce((acc, listing) => {
      const key = listing.listing_type || 'car';
      if (!acc[key]) acc[key] = [];
      acc[key].push(listing);
      return acc;
    }, {});
  }, [listings]);

  const handleDeleteListing = async (listing) => {
    const typeConfig = TYPE_CONFIG[listing.listing_type];
    if (!typeConfig) return;

    if (!window.confirm('Are you sure you want to permanently delete this listing? This action cannot be undone.')) {
      return;
    }

    setActioningId(listing.id);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      const response = await fetch(typeConfig.deletePath(listing.id), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete listing');
      }

      setListings((current) => current.filter((item) => item.id !== listing.id));
    } catch (err) {
      console.error('Delete listing error:', err);
      setError('Failed to delete listing. Please try again.');
    } finally {
      setActioningId(null);
    }
  };

  const handleExtendListing = async (listing) => {
    setActioningId(listing.id);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      const response = await fetch(`${API_URL}/api/user/listings/${listing.listing_type}/${listing.id}/extend`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to extend listing');
      }

      if (payload.listing) {
        setListings((current) =>
          current.map((item) => (item.id === listing.id ? payload.listing : item)),
        );
      } else {
        await fetchUserListings();
      }
    } catch (err) {
      console.error('Extend listing error:', err);
      setError(err.message || 'Failed to extend listing. Please try again.');
    } finally {
      setActioningId(null);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading your listings..." size="large" />;
  }

  return (
    <div className="my-listings-container">
      <div className="my-listings-header">
        <div>
          <h1 className="section-title">My Listings</h1>
          <p className="my-listings-subtitle">
            Listings stay live for 30 days. After expiry, they remain here for another 30 days so you can extend or delete them.
          </p>
        </div>
        <div className="action-buttons">
          {SELL_ACTIONS.map((action) => (
            <Link key={action.href} to={action.href} className="btn btn-primary">
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {listings.length === 0 ? (
        <div className="empty-state">
          <h3>No Listings Yet</h3>
          <p>Your active, pending, and recently expired listings will appear here.</p>
          <div className="empty-state-actions">
            {SELL_ACTIONS.map((action) => (
              <Link key={action.href} to={action.href} className="btn btn-primary">
                {action.label}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        Object.entries(TYPE_CONFIG).map(([type, config]) => {
          const typeListings = listingsByType[type] || [];
          if (typeListings.length === 0) return null;

          return (
            <div className="listing-section" key={type}>
              <div className="listing-section-head">
                <h2>{config.label} Listings</h2>
                <span>{typeListings.length}</span>
              </div>

              <div className="my-listings-grid">
                {typeListings.map((listing) => {
                  const imageUrl = getPrimaryImage(listing);
                  const canEdit = listing.listing_type === 'car';
                  const isBusy = actioningId === listing.id;

                  return (
                    <div key={`${listing.listing_type}-${listing.id}`} className={`my-listing-card ${listing.listing_state === 'expired' ? 'is-expired' : ''}`}>
                      <div className="my-listing-image">
                        {imageUrl ? (
                          <img
                            src={imageUrl}
                            alt={buildListingTitle(listing)}
                            onError={(event) => {
                              event.currentTarget.onerror = null;
                              event.currentTarget.src = 'https://via.placeholder.com/400x300?text=No+Image+Available';
                            }}
                          />
                        ) : (
                          <div className="no-image">No Image</div>
                        )}

                        <div className="my-listing-top-tags">
                          <span className="listing-type-tag">{config.label}</span>
                          <span className={`listing-state-tag state-${listing.listing_state}`}>
                            {listing.listing_state === 'expired' ? 'Expired' : listing.status || 'Live'}
                          </span>
                        </div>
                      </div>

                      <div className="my-listing-details">
                        <h3>{buildListingTitle(listing)}</h3>
                        <p className="my-listing-subtitle-card">{buildListingSubtitle(listing)}</p>
                        <p className="my-listing-price">{formatMoney(getListingPrice(listing))}</p>
                        <p className="my-listing-date">Posted on {formatDate(listing.created_at)}</p>
                        <p className="my-listing-lifecycle">{getLifecycleCopy(listing)}</p>
                        {listing.view_count !== undefined && listing.view_count !== null && (
                          <p className="my-listing-views">
                            {listing.view_count} view{listing.view_count === 1 ? '' : 's'}
                          </p>
                        )}
                      </div>

                      <div className="my-listing-actions">
                        <button
                          onClick={() => navigate(config.detailPath(listing.id))}
                          className="btn btn-secondary"
                          aria-label={`View ${config.label.toLowerCase()} listing`}
                        >
                          View
                        </button>

                        {canEdit && (
                          <button
                            onClick={() => navigate(config.editPath(listing.id))}
                            className="btn btn-secondary"
                            aria-label="Edit listing"
                          >
                            Edit
                          </button>
                        )}

                        {listing.can_extend && (
                          <button
                            onClick={() => handleExtendListing(listing)}
                            className="btn btn-primary"
                            disabled={isBusy}
                          >
                            {isBusy ? 'Updating...' : 'Extend 30 Days'}
                          </button>
                        )}

                        <button
                          onClick={() => handleDeleteListing(listing)}
                          className="btn btn-danger"
                          disabled={isBusy}
                          aria-label="Delete listing"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default MyListings;
