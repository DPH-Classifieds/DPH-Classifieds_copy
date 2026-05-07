import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { LISTING_REJECTION_REASONS } from './admin/rejectionConstants';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import '../styles/AdminOps.css';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const ADMIN_DELETE_REASONS = [
  'Duplicate listing',
  'Fraud or suspicious activity',
  'Prohibited or inappropriate content',
  'Policy violation',
  'Incorrect information',
  'Spam',
  'Price manipulation',
];

const UAE_CITY_COORDINATES = {
  'abu dhabi': [24.4539, 54.3773],
  dubai: [25.2048, 55.2708],
  sharjah: [25.3463, 55.4209],
  ajman: [25.4052, 55.5136],
  'umm al quwain': [25.5647, 55.5552],
  'ras al khaimah': [25.7895, 55.9432],
  fujairah: [25.1288, 56.3265]
};

const EXTRA_BOOLEAN_LABELS = {
  climate_control: 'Climate Control',
  dvd_player: 'DVD Player',
  keyless_entry: 'Keyless Entry',
  navigation_system: 'Navigation System',
  premium_sound_system: 'Premium Sound System',
  cooled_seats: 'Cooled Seats',
  front_wheel_drive: 'Front Wheel Drive',
  leather_seats: 'Leather Seats',
  parking_sensors: 'Parking Sensors',
  rear_view_camera: 'Rear View Camera',
  lady_driven: 'Lady Driven',
};

const AdminListings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') || 'cars';
  const statusFilter = searchParams.get('status') || 'pending';
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [selectedRejectIndex, setSelectedRejectIndex] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteReasonDetails, setDeleteReasonDetails] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const navigate = useNavigate();

  const fetchListings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(`/api/admin/approve/${filter}?status=${statusFilter}`);
      setListings(Array.isArray(response) ? response : []);
    } catch (error) {
      console.error('Failed to fetch listings:', error);
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [filter, statusFilter]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  useEffect(() => {
    const onFocus = () => fetchListings();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchListings]);

  const updateParams = (key, value) => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params);
  };

  const handleApprove = async (listingId) => {
    try {
      setActionLoading(true);
      await apiClient.post(`/api/admin/approve/${filter}/${listingId}/approve`);
      setListings(listings.filter(l => l.id !== listingId));
      setSuccessMessage('Listing approved successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      setShowDetailModal(false);
    } catch (error) {
      console.error('Failed to approve listing:', error);
      alert('Failed to approve listing. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    try {
      setActionLoading(true);
      const selected = selectedRejectIndex !== '' ? LISTING_REJECTION_REASONS[Number(selectedRejectIndex)] : null;
      await apiClient.post(`/api/admin/approve/${filter}/${selectedListing.id}/reject`, {
        rejection_note: selected
          ? `${selected.reason}${rejectionNote.trim() && rejectionNote.trim() !== selected.reason ? ` - ${rejectionNote.trim()}` : ''}`
          : rejectionNote,
        rejection_reason: selected?.reason || '',
        rejection_fix: selected?.fix || '',
      });
      setListings(listings.filter(l => l.id !== selectedListing.id));
      setSuccessMessage('Listing rejected successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      setShowRejectModal(false);
      setShowDetailModal(false);
      setRejectionNote('');
      setSelectedRejectIndex('');
    } catch (error) {
      console.error('Failed to reject listing:', error);
      alert('Failed to reject listing. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const getDeleteType = (value) => {
    const map = {
      cars: 'car',
      bikes: 'bike',
      parts: 'part',
      plates: 'plate',
    };
    return map[value] || 'car';
  };

  const handleDeleteListing = async () => {
    if (!selectedListing) return;
    if (!deleteReason.trim()) {
      alert('Please select a removal reason.');
      return;
    }
    try {
      setActionLoading(true);
      const finalReason = deleteReasonDetails.trim()
        ? `${deleteReason}: ${deleteReasonDetails.trim()}`
        : deleteReason;
      await apiClient.request(`/api/${getDeleteType(filter)}/${selectedListing.id}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: { reason: finalReason },
      });
      setListings(listings.filter((l) => l.id !== selectedListing.id));
      setSuccessMessage('Listing removed successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      setShowDeleteModal(false);
      setShowDetailModal(false);
      setDeleteReason('');
      setDeleteReasonDetails('');
    } catch (error) {
      console.error('Failed to delete listing:', error);
      alert('Failed to delete listing. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  const getListingTitle = (listing) => {
    if (listing.display_title) return listing.display_title;
    if (listing.listing_title) return listing.listing_title;
    if (listing.title) return listing.title;
    return `Listing #${listing.id ? listing.id.slice(0, 8) : 'Unknown'}`;
  };

  const getListingPrice = (listing) => {
    const price = listing.display_price ?? listing.price ?? listing.expected_selling_price;
    if (!price) return 'N/A';
    return `${Number(price).toLocaleString()} AED`;
  };

  const getListingImage = (listing, index = 0) => {
    if (!listing.images || listing.images.length === 0) return null;
    const img = listing.images[index];
    return img.display_url || img.image_url || img.url || null;
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: { background: 'rgba(255,193,7,0.15)', border: '1px solid rgba(255,193,7,0.3)', color: '#ffc107' },
      approved: { background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.3)', color: '#4caf50' },
      rejected: { background: 'rgba(244,67,54,0.15)', border: '1px solid rgba(244,67,54,0.3)', color: '#f44336' },
    };
    const s = styles[status] || styles.pending;
    return (
      <span style={{ ...s, padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, textTransform: 'capitalize' }}>
        {status}
      </span>
    );
  };

  const getListingVin = (listing) =>
    listing?.vin_number || listing?.chassis_number || listing?.vin || null;

  const getLeadMetrics = (listing) => {
    const metrics = listing?.lead_metrics || {};
    const callClick = Number(metrics.call_click || 0);
    const whatsappClick = Number(metrics.whatsapp_click || 0);
    const vinOpen = Number(metrics.vin_open || 0);
    const qualifiedLeads = Number(metrics.qualified_leads || (callClick + whatsappClick));
    return { callClick, whatsappClick, vinOpen, qualifiedLeads };
  };

  const formatPrice = (price) => {
    if (!price) return 'Price on request';
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      maximumFractionDigits: 0
    }).format(price);
  };

  const formatKilometers = (value) => {
    if (value === null || value === undefined || value === '') {
      return 'Mileage on request';
    }
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return `${value} km`;
    }
    return `${parsed.toLocaleString()} km`;
  };

  const getLocationMapConfig = (listing) => {
    const lat = Number.parseFloat(listing?.latitude);
    const lng = Number.parseFloat(listing?.longitude);

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return {
        center: [lat, lng],
        zoom: 13,
        approximate: false
      };
    }

    const normalizedCity = (listing?.car_city || '').trim().toLowerCase();
    const fallbackCenter = UAE_CITY_COORDINATES[normalizedCity];

    if (fallbackCenter) {
      return {
        center: fallbackCenter,
        zoom: 10,
        approximate: true
      };
    }

    return null;
  };

  const getDisplayExtras = (listing) => {
    if (Array.isArray(listing?.extras) && listing.extras.length > 0) {
      return listing.extras;
    }

    return Object.entries(EXTRA_BOOLEAN_LABELS)
      .filter(([key]) => Boolean(listing?.[key]))
      .map(([, label]) => label);
  };

  const listingSummary = useMemo(() => {
    const visible = listings.length;
    const pending = listings.filter((listing) => (listing.status || statusFilter) === 'pending').length;
    const views = listings.reduce((sum, listing) => sum + Number(listing.view_count || 0), 0);
    const leads = listings.reduce((sum, listing) => {
      const metrics = getLeadMetrics(listing);
      return sum + metrics.qualifiedLeads;
    }, 0);
    return { visible, pending, views, leads };
  }, [listings, statusFilter]);

  const ListingCard = ({ listing }) => (
    <div className="listing-card">
      <div className="listing-info">
        {getListingImage(listing) && (
          <img
            src={getListingImage(listing)}
            alt={getListingTitle(listing)}
            style={{ width: '100%', aspectRatio: 'var(--listing-image-frame-ratio, 16 / 10)', objectFit: 'cover', borderRadius: '8px', marginBottom: '12px' }}
            onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
          />
        )}
        <h3>{getListingTitle(listing)}</h3>
        <p><strong>Price:</strong> {getListingPrice(listing)}</p>
        <p><strong>Seller:</strong> {listing.user_email || listing.seller_email || 'N/A'}</p>
        <p><strong>VIN:</strong> {getListingVin(listing) || 'N/A'}</p>
        <p><strong>Leads:</strong> {getLeadMetrics(listing).qualifiedLeads}</p>
        <p><strong>Calls:</strong> {getLeadMetrics(listing).callClick} · <strong>WhatsApp:</strong> {getLeadMetrics(listing).whatsappClick}</p>
        <p><strong>VIN Opens:</strong> {getLeadMetrics(listing).vinOpen}</p>
        <p><strong>Status:</strong> {getStatusBadge(listing.status || statusFilter)}</p>
        <p><strong>Created:</strong> {listing.created_at ? new Date(listing.created_at).toLocaleDateString() : 'N/A'}</p>
      </div>
      <div className="listing-actions">
        <button
          onClick={() => {
            navigate(`/admin/listings/${filter}/${listing.id}`);
          }}
          className="action-button view-btn"
        >
          View Details
        </button>
        {(statusFilter === 'pending') && (
          <button
            onClick={() => handleApprove(listing.id)}
            className="action-button approve-btn"
            disabled={actionLoading}
          >
            Approve
          </button>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Loading {statusFilter} {filter}...</p>
      </div>
    );
  }

  const filterOptions = ['cars', 'parts', 'plates', 'bikes'];
  const statusOptions = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ];

  return (
    <div className="admin-ops admin-page admin-listings">
      <div className="admin-page-header">
        <div>
          <div className="admin-label">Listings</div>
          <h1 className="admin-page-title">{statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} {filter.charAt(0).toUpperCase() + filter.slice(1)}</h1>
          <p className="admin-page-subtitle">Review and manage listing approvals, drill into a listing record, and move into the specific detail page when you need the full history.</p>
        </div>
        <div className="admin-actions">
          <span className="admin-status-pill tone-warning">{listingSummary.visible} shown</span>
          <span className="admin-status-pill">{statusFilter}</span>
        </div>
      </div>

      <div className="admin-kpi-grid" style={{ marginBottom: '18px' }}>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Visible listings</div>
          <div className="admin-kpi-value">{listingSummary.visible}</div>
          <div className="admin-kpi-note">Listings in the current queue.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Pending</div>
          <div className="admin-kpi-value">{listingSummary.pending}</div>
          <div className="admin-kpi-note">Listings still awaiting action.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Views</div>
          <div className="admin-kpi-value">{listingSummary.views}</div>
          <div className="admin-kpi-note">Combined views across visible items.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Leads</div>
          <div className="admin-kpi-value">{listingSummary.leads}</div>
          <div className="admin-kpi-note">Call and WhatsApp actions for the current queue.</div>
        </div>
      </div>

      {successMessage && (
        <div className="admin-surface" style={{ marginBottom: '18px' }}>
          {successMessage}
        </div>
      )}

      <div className="filter-tabs" style={{ marginBottom: '12px' }}>
        {statusOptions.map(opt => (
          <button
            key={opt.key}
            onClick={() => updateParams('status', opt.key)}
            className={`filter-tab ${statusFilter === opt.key ? 'active' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="filter-tabs">
        {filterOptions.map(option => (
          <button
            key={option}
            onClick={() => updateParams('filter', option)}
            className={`filter-tab ${filter === option ? 'active' : ''}`}
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>

      {listings.length === 0 ? (
        <div className="empty-state">
          <h2>No {statusFilter} {filter}</h2>
          <p>There are no {statusFilter} {filter} listings at this time.</p>
        </div>
      ) : (
        <div className="listings-grid">
          {listings.map(listing => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      {showDetailModal && selectedListing && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Listing Details</h2>
              <button
                onClick={() => setShowDetailModal(false)}
                className="close-modal"
                type="button"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div>
                  {getListingImage(selectedListing, activeImageIndex) && (
                    <div style={{ position: 'relative' }}>
                      <img
                        src={getListingImage(selectedListing, activeImageIndex)}
                        alt={getListingTitle(selectedListing)}
                        style={{ width: '100%', aspectRatio: 'var(--listing-image-frame-ratio, 16 / 10)', objectFit: 'cover', borderRadius: '8px' }}
                        onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                      />
                      {selectedListing.images && selectedListing.images.length > 0 && (
                        <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 8px', borderRadius: '4px', fontSize: '12px' }}>
                          {selectedListing.images.length} photos
                        </div>
                      )}
                    </div>
                  )}
                  {selectedListing.images && selectedListing.images.length > 1 && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
                      {selectedListing.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img.display_url || img.image_url || img.url}
                          alt={`Thumbnail ${idx + 1}`}
                          style={{
                            width: '80px',
                            aspectRatio: 'var(--listing-image-frame-ratio, 16 / 10)',
                            objectFit: 'cover',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            border: idx === activeImageIndex ? '2px solid #007bff' : '2px solid transparent',
                            flexShrink: 0
                          }}
                          onClick={() => setActiveImageIndex(idx)}
                          onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
                    <div style={{ fontSize: '14px', color: '#6c757d', marginBottom: '4px' }}>Listed Price</div>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#212529', marginBottom: '4px' }}>
                      {formatPrice(selectedListing.expected_selling_price || selectedListing.price || selectedListing.display_price)}
                    </div>
                    <div style={{ fontSize: '14px', color: '#6c757d' }}>
                      ≈ USD {((selectedListing.expected_selling_price || selectedListing.price || selectedListing.display_price || 0) / 3.67).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {selectedListing.regional_spec && (
                      <span style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: 'rgba(40, 167, 69, 0.15)', border: '1px solid rgba(40, 167, 69, 0.3)', color: '#28a745' }}>
                        GCC Specs
                      </span>
                    )}
                    {selectedListing.is_insured && (
                      <span style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: 'rgba(23, 162, 184, 0.15)', border: '1px solid rgba(23, 162, 184, 0.3)', color: '#17a2b8' }}>
                        Insured
                      </span>
                    )}
                    {selectedListing.imported && (
                      <span style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, background: 'rgba(255, 193, 7, 0.15)', border: '1px solid rgba(255, 193, 7, 0.3)', color: '#ffc107' }}>
                        Imported
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#007bff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px' }}>
                        {(selectedListing.dealer_name || selectedListing.contact_name || 'S').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {selectedListing.dealer_name || selectedListing.contact_name || 'Private Seller'}
                          {selectedListing.dealer_verified && (
                            <span style={{ color: '#28a745', fontSize: '12px' }}>✓</span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6c757d' }}>
                          {selectedListing.user_email || selectedListing.seller_email || 'N/A'}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#6c757d' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                        <circle cx="12" cy="10" r="3"/>
                      </svg>
                      {selectedListing.car_city || 'UAE'}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', borderBottom: '2px solid #dee2e6', paddingBottom: '8px' }}>Car Specifications</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                  {[
                    ['Make', selectedListing.car_manufacturer || selectedListing.display_make],
                    ['Model', selectedListing.car_model || selectedListing.display_model],
                    ['Year', selectedListing.make_year || selectedListing.display_year],
                    ['Trim', selectedListing.trim || 'N/A'],
                    ['Body Type', selectedListing.body_type || 'N/A'],
                    ['Color', selectedListing.color || 'N/A'],
                    ['Mileage', formatKilometers(selectedListing.kilometer_driven || selectedListing.display_mileage)],
                    ['Fuel Type', selectedListing.fuel_type || 'N/A'],
                    ['Transmission', selectedListing.transmission_type || 'N/A'],
                    ['Cylinders', selectedListing.cylinders || 'N/A'],
                    ['Horsepower', selectedListing.horsepower || 'N/A'],
                    ['Engine', selectedListing.engine_capacity || 'N/A'],
                    ['Doors', selectedListing.doors || 'N/A'],
                    ['Seating Capacity', selectedListing.seating_capacity || 'N/A'],
                    ['Steering Side', selectedListing.steering_side || 'N/A'],
                    ['Regional Specs', selectedListing.regional_spec || 'N/A'],
                    ['Warranty', selectedListing.warranty || 'N/A'],
                    ['Service History', selectedListing.service_history || 'N/A']
                  ].map(([label, value]) => (
                    <div key={label} style={{ padding: '12px', borderRadius: '6px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
                      <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>{label}</div>
                      <div style={{ fontSize: '14px', fontWeight: '500', color: '#212529' }}>{value || 'N/A'}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', borderBottom: '2px solid #dee2e6', paddingBottom: '8px' }}>Extras & Features</h3>
                {getDisplayExtras(selectedListing).length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                    {getDisplayExtras(selectedListing).map((extra, index) => (
                      <div key={index} style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#007bff' }}></span>
                        {extra}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: '16px', borderRadius: '6px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', fontSize: '14px', color: '#6c757d' }}>
                    No extras were listed for this vehicle.
                  </div>
                )}
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', borderBottom: '2px solid #dee2e6', paddingBottom: '8px' }}>Location</h3>
                <div style={{ padding: '12px', borderRadius: '6px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span style={{ fontSize: '14px', fontWeight: '500' }}>{selectedListing.car_city || 'UAE'}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>
                    Area: {selectedListing.area || selectedListing.car_location || 'Not specified'}
                  </div>
                  {selectedListing.latitude && selectedListing.longitude && (
                    <div style={{ fontSize: '12px', color: '#6c757d' }}>
                      Coordinates: {Number(selectedListing.latitude).toFixed(4)}, {Number(selectedListing.longitude).toFixed(4)}
                    </div>
                  )}
                </div>
                {getLocationMapConfig(selectedListing) && (
                  <div style={{ height: '200px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #dee2e6' }}>
                    <MapContainer
                      center={getLocationMapConfig(selectedListing).center}
                      zoom={getLocationMapConfig(selectedListing).zoom}
                      scrollWheelZoom={false}
                      zoomControl={true}
                      doubleClickZoom={false}
                      attributionControl
                      style={{ height: '100%', width: '100%' }}
                    >
                      <TileLayer
                        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      />
                      <Marker position={getLocationMapConfig(selectedListing).center} />
                    </MapContainer>
                  </div>
                )}
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', borderBottom: '2px solid #dee2e6', paddingBottom: '8px' }}>Lead Metrics</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                  {[
                    ['Total Leads', getLeadMetrics(selectedListing).qualifiedLeads, '#28a745'],
                    ['Call Clicks', getLeadMetrics(selectedListing).callClick, '#007bff'],
                    ['WhatsApp Clicks', getLeadMetrics(selectedListing).whatsappClick, '#25D366'],
                    ['VIN Opens', getLeadMetrics(selectedListing).vinOpen, '#6c757d']
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ padding: '16px', borderRadius: '8px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', textAlign: 'center' }}>
                      <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>{label}</div>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: color }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', borderBottom: '2px solid #dee2e6', paddingBottom: '8px' }}>Description</h3>
                <div style={{ padding: '16px', borderRadius: '8px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', fontSize: '14px', lineHeight: '1.6' }}>
                  {selectedListing.car_description || selectedListing.display_description || selectedListing.description || 'No description provided.'}
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', borderBottom: '2px solid #dee2e6', paddingBottom: '8px' }}>Additional Information</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <div style={{ padding: '12px', borderRadius: '6px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
                    <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>VIN / Chassis Number</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#212529' }}>{getListingVin(selectedListing) || 'N/A'}</div>
                  </div>
                  <div style={{ padding: '12px', borderRadius: '6px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
                    <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>Phone</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#212529' }}>
                      {selectedListing.country_code || '+971'}{selectedListing.car_owner_phone_number || 'N/A'}
                    </div>
                  </div>
                  <div style={{ padding: '12px', borderRadius: '6px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
                    <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>Created</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#212529' }}>
                      {selectedListing.created_at ? new Date(selectedListing.created_at).toLocaleDateString() : 'N/A'}
                    </div>
                  </div>
                  <div style={{ padding: '12px', borderRadius: '6px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6' }}>
                    <div style={{ fontSize: '12px', color: '#6c757d', marginBottom: '4px' }}>Status</div>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#212529' }}>
                      {getStatusBadge(selectedListing.status || statusFilter)}
                    </div>
                  </div>
                </div>
                {selectedListing.rejection_note && (
                  <div style={{ marginTop: '12px', padding: '12px', borderRadius: '6px', backgroundColor: '#fff3cd', border: '1px solid #ffc107' }}>
                    <div style={{ fontSize: '12px', color: '#856404', marginBottom: '4px', fontWeight: '600' }}>Rejection Reason</div>
                    <div style={{ fontSize: '14px', color: '#856404' }}>{selectedListing.rejection_note}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              {statusFilter === 'pending' && (
                <>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    className="action-button reject-btn"
                    disabled={actionLoading}
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(selectedListing.id)}
                    className="action-button approve-btn"
                    disabled={actionLoading}
                  >
                    Approve
                  </button>
                </>
              )}
              {statusFilter !== 'pending' && (
                <button
                  onClick={() => setShowDetailModal(false)}
                  className="action-button secondary"
                >
                  Close
                </button>
              )}
              <button
                onClick={() => {
                  setDeleteReason('');
                  setDeleteReasonDetails('');
                  setShowDeleteModal(true);
                  setShowDetailModal(false);
                }}
                className="action-button reject-btn"
                disabled={actionLoading}
              >
                Delete Listing
              </button>
            </div>
          </div>
        </div>
      )}

      {showRejectModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Reject Listing</h2>
              <button
                onClick={() => setShowRejectModal(false)}
                className="close-modal"
                type="button"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <label htmlFor="rejection-reason-preset">Reason for rejection *</label>
              <select
                id="rejection-reason-preset"
                value={selectedRejectIndex || ''}
                onChange={(e) => {
                  const idx = e.target.value;
                  setSelectedRejectIndex(idx);
                  if (idx !== '') {
                    setRejectionNote(LISTING_REJECTION_REASONS[Number(idx)].reason);
                  }
                }}
              >
                <option value="">Select a reason...</option>
                {LISTING_REJECTION_REASONS.map((item, idx) => (
                  <option key={idx} value={idx}>
                    {item.reason}
                  </option>
                ))}
              </select>
              {selectedRejectIndex !== '' && selectedRejectIndex !== null && (
                <div style={{ margin: '8px 0 12px', padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 4, fontWeight: 600 }}>How to fix:</div>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}>{LISTING_REJECTION_REASONS[Number(selectedRejectIndex)].fix}</div>
                </div>
              )}
              <label>Additional notes (optional)</label>
              <textarea
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                placeholder="Add any extra context..."
                rows={3}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowRejectModal(false)}
                className="action-button secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                className="action-button reject-btn"
                disabled={actionLoading || !rejectionNote.trim()}
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && selectedListing && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2>Remove Listing</h2>
              <button onClick={() => setShowDeleteModal(false)} className="close-modal" type="button">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p><strong>{getListingTitle(selectedListing)}</strong> will be removed from the marketplace.</p>
              <label htmlFor="delete-reason"><strong>Removal reason</strong></label>
              <select
                id="delete-reason"
                value={deleteReason}
                onChange={(event) => setDeleteReason(event.target.value)}
              >
                <option value="">Select a reason</option>
                {ADMIN_DELETE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
              <label htmlFor="delete-reason-details" style={{ marginTop: '12px' }}>
                <strong>Additional details (optional)</strong>
              </label>
              <textarea
                id="delete-reason-details"
                value={deleteReasonDetails}
                onChange={(event) => setDeleteReasonDetails(event.target.value)}
                placeholder="Optional internal details for admin history..."
                rows={3}
              />
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="action-button secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteListing}
                className="action-button reject-btn"
                disabled={actionLoading || !deleteReason.trim()}
              >
                {actionLoading ? 'Removing...' : 'Remove Listing'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminListings;
