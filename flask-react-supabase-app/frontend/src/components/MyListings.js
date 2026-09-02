import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getAccessToken } from '../utils/supabaseClient';
import { resolveMediaUrl } from '../utils/media';
import { useSavedListings } from '../context/SavedListingsContext';
import LoadingSpinner from './LoadingSpinner';
import UAELicensePlate from './UAELicensePlate';
import '../styles/MyListings.css';
import './ExplorePage.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const LISTING_PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const getImageUrl = (image) => {
  if (!image) return null;

  const imageUrl = image.display_url || image.image_url || image.url || image;
  return resolveMediaUrl(imageUrl);
};

const TYPE_CONFIG = {
  car: {
    label: 'Car',
    detailPath: (id) => `/cars/${id}`,
    editPath: (id) => `/edit/car/${id}`,
    deletePath: (id) => `${API_URL}/api/cars/${id}`,
    createPath: '/post-car',
  },
  bike: {
    label: 'Bike',
    detailPath: (id) => `/bikes/${id}`,
    editPath: (id) => `/edit/bike/${id}`,
    deletePath: (id) => `${API_URL}/api/bikes/${id}`,
    createPath: '/post-bike',
  },
  part: {
    label: 'Part',
    detailPath: (id) => `/car-parts/${id}`,
    editPath: (id) => `/edit/part/${id}`,
    deletePath: (id) => `${API_URL}/api/parts/${id}`,
    createPath: '/post-car-parts',
  },
  plate: {
    label: 'Plate',
    detailPath: (id) => `/plates/${id}`,
    editPath: (id) => `/edit/plate/${id}`,
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

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'saved', label: 'Saved' },
  { key: 'searches', label: 'Saved Searches' },
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
  if (listing.listing_state === 'deleted' || String(listing.status || '').toLowerCase() === 'deleted') {
    return `Deleted${listing.deleted_at ? ` on ${formatDate(listing.deleted_at)}` : ''}.`;
  }

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

const isDraftListing = (listing) => {
  const status = String(listing.status || '').toLowerCase();
  const state = String(listing.listing_state || '').toLowerCase();
  return status === 'draft' || state === 'draft' || listing.moderation_status === 'rejected';
};

const MyListings = () => {
  const [listings, setListings] = useState([]);
  const [listingLimit, setListingLimit] = useState({ current: 0, max: 4, remaining: 4 });
  const [listingLimitPerType, setListingLimitPerType] = useState(null);
  const [leadTotals, setLeadTotals] = useState({
    qualified_leads: 0,
    call_click: 0,
    whatsapp_click: 0,
    vin_open: 0,
    vin_reveal: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actioningId, setActioningId] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [outcomePromptListing, setOutcomePromptListing] = useState(null);
  const [activeTab, setActiveTab] = useState('active');
  const [wizardDrafts, setWizardDrafts] = useState([]);
  const [savedSearches, setSavedSearches] = useState([]);
  const [savedSearchesLoading, setSavedSearchesLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { savedListings, loading: savedLoading, refreshSavedListings } = useSavedListings() || {};

  useEffect(() => {
    Promise.all([fetchUserListings(), fetchWizardDrafts()]);
    fetchLeadTotals();
    fetchSavedSearches();
    if (refreshSavedListings) refreshSavedListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const requestedTab = new URLSearchParams(location.search).get('tab');
    if (requestedTab && TABS.some((tab) => tab.key === requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [location.search]);

  const fetchWizardDrafts = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const response = await fetch(`${API_URL}/api/user/drafts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const payload = await response.json();
      setWizardDrafts(Array.isArray(payload.drafts) ? payload.drafts : []);
    } catch (err) {
      console.warn('Failed to fetch wizard drafts:', err);
    }
  };

  const deleteWizardDraft = async (draftKey) => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const response = await fetch(`${API_URL}/api/user/drafts/${draftKey}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      await fetchWizardDrafts();
    } catch (err) {
      console.warn('Failed to delete wizard draft:', err);
    }
  };

  const fetchSavedSearches = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      setSavedSearchesLoading(true);
      const response = await fetch(`${API_URL}/api/user/saved-searches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const payload = await response.json();
      setSavedSearches(Array.isArray(payload.searches) ? payload.searches : []);
    } catch (err) {
      console.warn('Failed to fetch saved searches:', err);
    } finally {
      setSavedSearchesLoading(false);
    }
  };

  const deleteSavedSearch = async (search) => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const identifier = search?.id || search?.search_key;
      if (!identifier) return;
      const response = await fetch(`${API_URL}/api/user/saved-searches/${identifier}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      await fetchSavedSearches();
    } catch (err) {
      console.warn('Failed to delete saved search:', err);
    }
  };

  const fetchLeadTotals = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch(`${API_URL}/api/user/lead-metrics?days=30`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) return;
      const payload = await response.json();
      if (payload?.totals) {
        setLeadTotals((current) => ({ ...current, ...payload.totals }));
      }
    } catch (err) {
      console.warn('Failed to fetch user lead totals:', err);
    }
  };

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
      const nextListings = Array.isArray(payload.listings) ? payload.listings : [];
      setListings(nextListings);

      if (payload.listing_limit) {
        setListingLimit(payload.listing_limit);
        setListingLimitPerType(payload.listing_limit.per_type || null);
      }

      const pendingOutcome = nextListings.find(
        (listing) =>
          listing.listing_state === 'expired'
          && !listing.sold_status_set_at
          && !listing.auto_removed_at
          && !['deleted', 'rejected', 'sold'].includes(listing.status)
      );
      setOutcomePromptListing(pendingOutcome || null);
    } catch (err) {
      console.error('Error fetching listings:', err);
      setError('Could not load your listings. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const activeListings = useMemo(
    () => listings.filter((l) => !isDraftListing(l)),
    [listings]
  );

  const draftListings = useMemo(
    () => listings.filter((l) => isDraftListing(l)),
    [listings]
  );

  const activeListingsByType = useMemo(() => {
    return activeListings.reduce((acc, listing) => {
      const key = listing.listing_type || 'car';
      if (!acc[key]) acc[key] = [];
      acc[key].push(listing);
      return acc;
    }, {});
  }, [activeListings]);

  const draftListingsByType = useMemo(() => {
    return draftListings.reduce((acc, listing) => {
      const key = listing.listing_type || 'car';
      if (!acc[key]) acc[key] = [];
      acc[key].push(listing);
      return acc;
    }, {});
  }, [draftListings]);

  const hasUnlimitedListings = listingLimit.unlimited || listingLimit.max == null;
  const hasPerTypeLimits = Boolean(listingLimitPerType && typeof listingLimitPerType === 'object');

  const handleDeleteListing = async (listing) => {
    setDeleteConfirm(listing);
  };

  const confirmDelete = async () => {
    const listing = deleteConfirm;
    setDeleteConfirm(null);
    if (!listing) return;

    const typeConfig = TYPE_CONFIG[listing.listing_type];
    if (!typeConfig) return;

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

      // Backend performs a soft-delete (status=deleted, deleted_at set). Refresh so the
      // UI reflects the new lifecycle state and allows reposting from the deleted card.
      await fetchUserListings();
    } catch (err) {
      console.error('Delete listing error:', err);
      setError('Failed to delete listing. Please try again.');
    } finally {
      setActioningId(null);
    }
  };

  const handleOutcomeAction = async (listing, outcome) => {
    setActioningId(listing.id);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      const response = await fetch(`${API_URL}/api/user/listings/${listing.listing_type}/${listing.id}/outcome`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ outcome }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save listing outcome');
      }

      if (payload.listing) {
        setListings((current) =>
          current.map((item) => (item.id === listing.id ? payload.listing : item)),
        );
      } else {
        await fetchUserListings();
      }
      fetchWizardDrafts();
      setOutcomePromptListing(null);
    } catch (err) {
      console.error('Listing outcome update error:', err);
      setError(err.message || 'Failed to save listing outcome.');
    } finally {
      setActioningId(null);
    }
  };

  const isExpiredListing = (listing) => listing?.listing_state === 'expired';

  const isDeletedListing = (listing) => {
    const status = String(listing?.status || '').toLowerCase();
    const state = String(listing?.listing_state || '').toLowerCase();
    return status === 'deleted' || state === 'deleted' || Boolean(listing?.deleted_at);
  };

  const handleRepostListing = async (listing) => {
    setActioningId(listing.id);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      const response = await fetch(
        `${API_URL}/api/user/listings/${listing.listing_type}/${listing.id}/repost`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to repost listing');
      }
      await fetchUserListings();
    } catch (err) {
      console.error('Repost listing error:', err);
      setError(err.message || 'Failed to repost listing.');
    } finally {
      setActioningId(null);
    }
  };

  const handleDismissListing = async (listing) => {
    setActioningId(listing.id);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      const response = await fetch(
        `${API_URL}/api/user/listings/${listing.listing_type}/${listing.id}/dismiss`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to remove listing');
      }
      setListings((current) => current.filter((item) => item.id !== listing.id));
    } catch (err) {
      console.error('Dismiss listing error:', err);
      setError(err.message || 'Failed to remove listing.');
    } finally {
      setActioningId(null);
    }
  };

  const renderListingCard = (listing, config) => {
    const imageUrl = getPrimaryImage(listing);
    const canEdit = Boolean(config.editPath);
    const isBusy = actioningId === listing.id;
    const isDeleted = isDeletedListing(listing);
    const isDraft = isDraftListing(listing);
    const wasAutoRemoved = Boolean(listing.auto_removed_at);

    const cardModifier = isDeleted
      ? 'is-deleted'
      : isDraft
        ? 'is-draft'
        : listing.listing_state === 'expired'
          ? 'is-expired'
          : '';

    const statusLabel = (() => {
      if (isDeleted) return 'Deleted';
      if (isDraft) return 'Draft';
      if (listing.listing_state === 'expired') return 'Expired';
      const s = String(listing.status || '').toLowerCase();
      if (s === 'pending' || s === 'pending_auto_review') return 'Pending Review';
      if (s === 'approved') return 'Live';
      return listing.status || 'Live';
    })();

    const statusClass = isDeleted ? 'deleted' : isDraft ? 'draft' : listing.listing_state;

    return (
      <div key={`${listing.listing_type}-${listing.id}`} className={`my-listing-card ${cardModifier}`}>
        <div className={`my-listing-image${listing.listing_type === 'plate' ? ' my-listing-plate' : ''}`}>
          {listing.listing_type === 'plate' ? (
            <UAELicensePlate
              city={listing.city || 'Dubai'}
              code={listing.code || ''}
              number={String(listing.number || '')}
              className={listing.status === 'sold' ? 'sold' : ''}
            />
          ) : imageUrl ? (
            <img
              src={imageUrl}
              alt={buildListingTitle(listing)}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = LISTING_PLACEHOLDER_IMAGE;
              }}
            />
          ) : (
            <div className="no-image">No Image</div>
          )}

          <div className="my-listing-top-tags">
            <span className="listing-type-tag">{config.label}</span>
            <span className={`listing-state-tag state-${statusClass}`}>
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="my-listing-details">
          <h3>{buildListingTitle(listing)}</h3>
          <p className="my-listing-subtitle-card">{buildListingSubtitle(listing)}</p>
          <p className="my-listing-price">{formatMoney(getListingPrice(listing))}</p>
          <p className="my-listing-date">Posted on {formatDate(listing.created_at)}</p>
          {!isDraft && <p className="my-listing-lifecycle">{getLifecycleCopy(listing)}</p>}
          {isDeleted && wasAutoRemoved && (
            <p className="my-listing-lifecycle">
              Auto-removed because no outcome was selected within 7 days of expiry.
            </p>
          )}
          {listing.rejection_note && (
            <p className="my-listing-lifecycle">Rejection reason: {listing.rejection_note}</p>
          )}
          {!isDraft && listing.view_count !== undefined && listing.view_count !== null && (
            <p className="my-listing-views">
              {listing.view_count} view{listing.view_count === 1 ? '' : 's'}
            </p>
          )}
        </div>

        <div className="my-listing-actions">
          {isDraft ? (
            <>
              {canEdit && (
                <button
                  onClick={() => navigate(config.editPath(listing.id))}
                  className="btn btn-primary"
                  aria-label="Edit and post listing"
                >
                  Edit &amp; Post
                </button>
              )}
              <button
                onClick={() => handleDeleteListing(listing)}
                className="btn btn-danger"
                disabled={isBusy}
                aria-label="Delete listing"
              >
                {isBusy ? 'Deleting...' : 'Delete'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => navigate(config.detailPath(listing.id))}
                className="btn btn-secondary"
                aria-label={`View ${config.label.toLowerCase()} listing`}
              >
                View
              </button>

              {isDeleted ? (
                <>
                  <button
                    onClick={() => handleRepostListing(listing)}
                    className="btn btn-primary"
                    disabled={isBusy}
                    aria-label="Repost listing"
                  >
                    {isBusy ? 'Reposting...' : 'Repost'}
                  </button>
                  <button
                    onClick={() => handleDismissListing(listing)}
                    className="btn btn-secondary"
                    disabled={isBusy}
                    aria-label="Remove from my listings"
                  >
                    {isBusy ? 'Removing...' : 'Remove from list'}
                  </button>
                </>
              ) : (
                <>
                  {canEdit && (
                    <button
                      onClick={() => navigate(config.editPath(listing.id))}
                      className="btn btn-secondary"
                      aria-label="Edit listing"
                    >
                      Edit
                    </button>
                  )}

                  {isExpiredListing(listing) ? (
                    <>
                      <button
                        onClick={() => handleOutcomeAction(listing, 'not_sold_renew')}
                        className="btn btn-primary"
                        disabled={isBusy}
                      >
                        {isBusy ? 'Updating...' : 'Renew'}
                      </button>
                      <button
                        onClick={() => handleOutcomeAction(listing, 'move_to_draft')}
                        className="btn btn-secondary"
                        disabled={isBusy}
                      >
                        {isBusy ? 'Updating...' : 'Move to Drafts'}
                      </button>
                      <button
                        onClick={() => setOutcomePromptListing(listing)}
                        className="btn btn-secondary"
                        disabled={isBusy}
                      >
                        Sold Options
                      </button>
                    </>
                  ) : listing.can_extend && (
                    <button
                      onClick={() => setOutcomePromptListing(listing)}
                      className="btn btn-primary"
                      disabled={isBusy}
                    >
                      {isBusy ? 'Updating...' : 'Renew / Sold'}
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
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const renderSavedCard = (item) => {
    const type = String(item?.listingType || item?.listing_type || '').toLowerCase();
    const config = TYPE_CONFIG[type];
    if (!config) return null;

    const imageUrl = getImageUrl(item?.image || item?.images?.[0]);

    return (
      <div key={`saved-${type}-${item.id}`} className="my-listing-card">
        <div className="my-listing-image">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={item.title || buildListingTitle(item)}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = LISTING_PLACEHOLDER_IMAGE;
              }}
            />
          ) : (
            <div className="no-image">No Image</div>
          )}
          <div className="my-listing-top-tags">
            <span className="listing-type-tag">{config.label}</span>
          </div>
        </div>

        <div className="my-listing-details">
          <h3>{item.title || buildListingTitle(item)}</h3>
          <p className="my-listing-subtitle-card">{item.subtitle || buildListingSubtitle(item)}</p>
          {item.priceLabel && (
            <p className="my-listing-price">{item.priceLabel}</p>
          )}
        </div>

        <div className="my-listing-actions">
          <button
            onClick={() => navigate(config.detailPath(item.id))}
            className="btn btn-secondary"
          >
            View
          </button>
        </div>
      </div>
    );
  };

  const buildSavedSearchTitle = (search) => {
    if (search?.name) return search.name;
    if (search?.query_text) return search.query_text;
    if (search?.category) return `${search.category} search`;
    return 'Saved search';
  };

  const buildSavedSearchSubtitle = (search) => {
    const parts = [];
    if (search?.category) parts.push(search.category);
    if (search?.route_path) parts.push(search.route_path);
    if (search?.query_text) parts.push(`"${search.query_text}"`);
    return parts.join(' • ');
  };

  const renderSavedSearchCard = (search) => {
    const searchUrl = search?.route_path || '/explore';
    const filterCount = search?.filters && typeof search.filters === 'object'
      ? Object.keys(search.filters).length
      : 0;

    return (
      <div key={search.id || search.search_key} className="my-listing-card">
        <div className="my-listing-details">
          <h3>{buildSavedSearchTitle(search)}</h3>
          <p className="my-listing-subtitle-card">{buildSavedSearchSubtitle(search) || 'Saved from Explore'}</p>
          {search.result_count !== undefined && search.result_count !== null && (
            <p className="my-listing-price">{search.result_count} results when saved</p>
          )}
          <p className="my-listing-date">
            {filterCount > 0 ? `${filterCount} filter${filterCount === 1 ? '' : 's'}` : 'No extra filters'}
          </p>
        </div>
        <div className="my-listing-actions">
          <button
            onClick={() => navigate(searchUrl)}
            className="btn btn-secondary"
          >
            Open search
          </button>
          <button
            onClick={() => deleteSavedSearch(search)}
            className="btn btn-danger"
          >
            Delete
          </button>
        </div>
      </div>
    );
  };

  const renderListingSection = (typeListingsByType, emptyMessage) => {
    const hasAny = Object.values(typeListingsByType).some((list) => list.length > 0);
    if (!hasAny) {
      return (
        <div className="empty-state">
          <p>{emptyMessage}</p>
        </div>
      );
    }

    return Object.entries(TYPE_CONFIG).map(([type, config]) => {
      const typeListings = typeListingsByType[type] || [];
      if (typeListings.length === 0) return null;

      return (
        <div className="listing-section" key={type}>
          <div className="listing-section-head">
            <h2>{config.label} Listings</h2>
            <span>{typeListings.length}</span>
          </div>

          <div className="my-listings-grid">
            {typeListings.map((listing) => renderListingCard(listing, config))}
          </div>
        </div>
      );
    });
  };

  if (loading) {
    return <LoadingSpinner message="Loading your listings..." size="large" />;
  }

  return (
    <div className="my-listings-container">
      {deleteConfirm && (
        <div className="delete-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <div className="delete-confirm-modal">
            <h3 id="delete-confirm-title">Delete listing?</h3>
            <p>
              <strong>{buildListingTitle(deleteConfirm)}</strong> will be removed from the marketplace. You can repost it later from your deleted listings.
            </p>
            <div className="delete-confirm-actions">
              <button className="btn btn-danger" onClick={confirmDelete}>Yes, delete it</button>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {outcomePromptListing && (
        <div className="delete-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="outcome-confirm-title">
          <div className="delete-confirm-modal">
            <h3 id="outcome-confirm-title">Update Listing Status</h3>
            <p>
              Please let us know the status of <strong>{buildListingTitle(outcomePromptListing)}</strong>.
              {outcomePromptListing.listing_state === 'expired' 
                ? ' It has expired. You can renew it, move it back to drafts for re-review, or mark it as sold.'
                : ' You can extend it for another 15 days or mark it as sold.'}
            </p>
            <div className="delete-confirm-actions renewal-actions">
              <button
                className="btn btn-primary"
                disabled={actioningId === outcomePromptListing.id}
                onClick={() => handleOutcomeAction(outcomePromptListing, 'sold_on_dph')}
              >
                Sold on DPH
              </button>
              <button
                className="btn btn-secondary"
                disabled={actioningId === outcomePromptListing.id}
                onClick={() => handleOutcomeAction(outcomePromptListing, 'sold_elsewhere')}
              >
                Sold Elsewhere
              </button>
              <button
                className="btn btn-success"
                disabled={actioningId === outcomePromptListing.id}
                onClick={() => handleOutcomeAction(outcomePromptListing, 'not_sold_renew')}
              >
                Renew Listing
              </button>
              <button
                className="btn btn-secondary"
                disabled={actioningId === outcomePromptListing.id}
                onClick={() => handleOutcomeAction(outcomePromptListing, 'move_to_draft')}
              >
                Move to Drafts
              </button>
              <button
                className="btn btn-link"
                onClick={() => setOutcomePromptListing(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="my-listings-header">
        <div>
          <h1 className="section-title">My Listings</h1>
          <p className="my-listings-subtitle">
            Listings stay live for 15 days. After expiry, they remain here for another 30 days so you can extend or delete them.
          </p>
          <div className="my-listings-lead-stats">
            <span>Leads (30d): {leadTotals.qualified_leads || 0}</span>
            <span>Calls: {leadTotals.call_click || 0}</span>
            <span>WhatsApp: {leadTotals.whatsapp_click || 0}</span>
            <span>VIN opens: {leadTotals.vin_open || 0}</span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            {!hasUnlimitedListings && !hasPerTypeLimits ? (
              <div style={{ display: 'flex', gap: 4 }}>
                {Array.from({ length: listingLimit.max }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      width: 28,
                      height: 6,
                      borderRadius: 3,
                      background: i < listingLimit.current ? 'var(--ex-accent-green)' : 'var(--ex-line)',
                      transition: 'background 0.2s',
                    }}
                  />
                ))}
              </div>
            ) : null}
            {!hasUnlimitedListings && hasPerTypeLimits ? (
              <span style={{ fontSize: 13, color: 'var(--ex-text-muted)' }}>
                Cars {listingLimitPerType?.car?.current ?? 0}/{listingLimitPerType?.car?.max ?? 4}
                {' • '}
                Bikes {listingLimitPerType?.bike?.current ?? 0}/{listingLimitPerType?.bike?.max ?? 4}
                {' • '}
                Plates {listingLimitPerType?.plate?.current ?? 0}/{listingLimitPerType?.plate?.max ?? 4}
                {' • '}
                Parts {listingLimitPerType?.part?.current ?? 0}/{listingLimitPerType?.part?.max ?? 4}
              </span>
            ) : null}
            <span style={{ fontSize: 13, color: 'var(--ex-text-muted)' }}>
              {hasUnlimitedListings ? (
                <>
                  {listingLimit.current} listings used
                  <span style={{ color: 'var(--ex-accent-green)', marginLeft: 4 }}>(unlimited for your account)</span>
                </>
              ) : hasPerTypeLimits ? (
                <>
                  {listingLimit.current} total listings
                </>
              ) : (
                <>
                  {listingLimit.current} of {listingLimit.max} listings used
                  {listingLimit.remaining > 0 && (
                    <span style={{ color: 'var(--ex-accent-green)', marginLeft: 4 }}>({listingLimit.remaining} left)</span>
                  )}
                  {listingLimit.remaining === 0 && (
                    <span style={{ color: '#ef4444', marginLeft: 4 }}>(limit reached)</span>
                  )}
                </>
              )}
            </span>
          </div>
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

      <div className="my-listings-tabs">
        {TABS.map((tab) => {
          const count = tab.key === 'active'
            ? activeListings.length
            : tab.key === 'drafts'
              ? draftListings.length + wizardDrafts.length
              : (savedListings || []).length;

          return (
            <button
              key={tab.key}
              className={`my-listings-tab ${activeTab === tab.key ? 'is-active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {count > 0 && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="my-listings-tab-content">
        {activeTab === 'active' && (
          activeListings.length === 0 ? (
            <div className="empty-state">
              <h3>No Active Listings</h3>
              <p>Your published listings will appear here.</p>
              <div className="empty-state-actions">
                {SELL_ACTIONS.map((action) => (
                  <Link key={action.href} to={action.href} className="btn btn-primary">
                    {action.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            renderListingSection(activeListingsByType, 'No active listings.')
          )
        )}

        {activeTab === 'drafts' && (
          draftListings.length === 0 && wizardDrafts.length === 0 ? (
            <div className="empty-state">
              <h3>No Drafts</h3>
              <p>Drafts from rejected or incomplete listings will appear here.</p>
              <div className="empty-state-actions">
                {SELL_ACTIONS.map((action) => (
                  <Link key={action.href} to={action.href} className="btn btn-primary">
                    {action.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <>
              {wizardDrafts.length > 0 && (
                <div className="listing-section">
                  <div className="listing-section-head">
                    <h2>Unfinished listings</h2>
                    <span>{wizardDrafts.length}</span>
                  </div>
                  <div className="my-listings-grid">
                    {wizardDrafts.map((draft) => (
                      <div key={`wizard-draft-${draft.draft_key}`} className="my-listing-card">
                        <div className={`my-listing-image${draft.draft_key === 'plate' ? ' my-listing-plate' : ''}`}>
                          {draft.draft_key === 'plate' ? (
                            <UAELicensePlate
                              city={draft.plate_city || 'Dubai'}
                              code={draft.plate_code || ''}
                              number={draft.plate_number || ''}
                            />
                          ) : draft.display_image_url ? (
                            <img
                              src={draft.display_image_url}
                              alt={draft.display_title || 'Draft preview'}
                              onError={(event) => {
                                event.currentTarget.onerror = null;
                                event.currentTarget.src = LISTING_PLACEHOLDER_IMAGE;
                              }}
                            />
                          ) : (
                            <div className="no-image">No Image</div>
                          )}
                          <div className="my-listing-top-tags">
                            <span className="listing-state-tag state-draft">Draft</span>
                          </div>
                        </div>
                        <div
                          className="my-listing-details"
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                          onClick={() => draft.resume_path && navigate(draft.resume_path)}
                          onKeyDown={(event) => {
                            if ((event.key === 'Enter' || event.key === ' ') && draft.resume_path) {
                              event.preventDefault();
                              navigate(draft.resume_path);
                            }
                          }}
                        >
                          <h3>{draft.display_title || 'Untitled draft'}</h3>
                          <p className="my-listing-subtitle-card">
                            {draft.display_subtitle || 'Resume editing'}
                          </p>
                          {draft.updated_at && (
                            <p className="my-listing-date">Updated {formatDate(draft.updated_at)}</p>
                          )}
                        </div>
                        <div className="my-listing-actions">
                          <button
                            onClick={() => draft.resume_path && navigate(draft.resume_path)}
                            className="btn btn-primary"
                            aria-label="Resume editing draft"
                          >
                            Resume
                          </button>
                          <button
                            onClick={() => deleteWizardDraft(draft.draft_key)}
                            className="btn btn-danger"
                            aria-label="Delete draft"
                          >
                            Delete draft
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {draftListings.length > 0 && renderListingSection(draftListingsByType, 'No draft listings.')}
            </>
          )
        )}

        {activeTab === 'saved' && (
          savedLoading ? (
            <LoadingSpinner message="Loading saved listings..." size="small" />
          ) : (savedListings || []).length === 0 ? (
            <div className="empty-state">
              <h3>No Saved Listings</h3>
              <p>Browse the marketplace and save listings you like. They'll appear here.</p>
              <div className="empty-state-actions">
                <Link to="/explore" className="btn btn-primary">Browse Marketplace</Link>
              </div>
            </div>
          ) : (
            <div className="my-listings-grid">
              {(savedListings || []).map((item) => renderSavedCard(item))}
            </div>
          )
        )}

        {activeTab === 'searches' && (
          savedSearchesLoading ? (
            <LoadingSpinner message="Loading saved searches..." size="small" />
          ) : savedSearches.length === 0 ? (
            <div className="empty-state">
              <h3>No Saved Searches</h3>
              <p>Save a search from Explore and it will appear here.</p>
              <div className="empty-state-actions">
                <Link to="/explore" className="btn btn-primary">Go to Explore</Link>
              </div>
            </div>
          ) : (
            <div className="my-listings-grid">
              {savedSearches.map((search) => renderSavedSearchCard(search))}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default MyListings;
