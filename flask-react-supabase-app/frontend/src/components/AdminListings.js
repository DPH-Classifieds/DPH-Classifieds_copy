import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminDashboard.css';

const AdminListings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') || 'cars';
  const statusFilter = searchParams.get('status') || 'pending';
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const fetchListings = async () => {
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
    };

    fetchListings();
  }, [filter, statusFilter]);

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
      await apiClient.post(`/api/admin/approve/${filter}/${selectedListing.id}/reject`, {
        rejection_note: rejectionNote
      });
      setListings(listings.filter(l => l.id !== selectedListing.id));
      setSuccessMessage('Listing rejected successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      setShowRejectModal(false);
      setShowDetailModal(false);
      setRejectionNote('');
    } catch (error) {
      console.error('Failed to reject listing:', error);
      alert('Failed to reject listing. Please try again.');
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

  const getListingImage = (listing) => {
    if (!listing.images || listing.images.length === 0) return null;
    const img = listing.images[0];
    return img.image_url || img.url || null;
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

  const ListingCard = ({ listing }) => (
    <div className="listing-card">
      <div className="listing-info">
        {getListingImage(listing) && (
          <img
            src={getListingImage(listing)}
            alt={getListingTitle(listing)}
            style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '8px', marginBottom: '12px' }}
            onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
          />
        )}
        <h3>{getListingTitle(listing)}</h3>
        <p><strong>Price:</strong> {getListingPrice(listing)}</p>
        <p><strong>Seller:</strong> {listing.user_email || listing.seller_email || 'N/A'}</p>
        <p><strong>Status:</strong> {getStatusBadge(listing.status || statusFilter)}</p>
        <p><strong>Created:</strong> {listing.created_at ? new Date(listing.created_at).toLocaleDateString() : 'N/A'}</p>
      </div>
      <div className="listing-actions">
        <button
          onClick={() => {
            setSelectedListing(listing);
            setShowDetailModal(true);
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
    <div className="admin-listings">
      <div className="page-header">
        <h1>{statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} {filter.charAt(0).toUpperCase() + filter.slice(1)}</h1>
        <p>Review and manage {statusFilter} {filter} listings</p>
        {successMessage && (
          <div className="success-message">{successMessage}</div>
        )}
      </div>

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
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              {getListingImage(selectedListing) && (
                <img
                  src={getListingImage(selectedListing)}
                  alt={getListingTitle(selectedListing)}
                  style={{ width: '100%', maxHeight: '300px', objectFit: 'cover', borderRadius: '8px', marginBottom: '16px' }}
                  onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                />
              )}
              <p><strong>Title:</strong> {getListingTitle(selectedListing)}</p>
              <p><strong>Price:</strong> {getListingPrice(selectedListing)}</p>
              <p><strong>Status:</strong> {getStatusBadge(selectedListing.status || statusFilter)}</p>
              <p><strong>Description:</strong> {selectedListing.display_description || selectedListing.description || selectedListing.car_description || 'No description provided'}</p>
              <p><strong>Seller:</strong> {selectedListing.user_email || selectedListing.seller_email || 'N/A'}</p>
              <p><strong>Created:</strong> {selectedListing.created_at ? new Date(selectedListing.created_at).toLocaleDateString() : 'N/A'}</p>
              {selectedListing.display_make && <p><strong>Make:</strong> {selectedListing.display_make}</p>}
              {selectedListing.display_model && <p><strong>Model:</strong> {selectedListing.display_model}</p>}
              {selectedListing.display_year && <p><strong>Year:</strong> {selectedListing.display_year}</p>}
              {selectedListing.display_mileage !== undefined && selectedListing.display_mileage !== null && <p><strong>Mileage:</strong> {Number(selectedListing.display_mileage).toLocaleString()} km</p>}
              {selectedListing.fuel_type && <p><strong>Fuel:</strong> {selectedListing.fuel_type}</p>}
              {selectedListing.transmission_type && <p><strong>Transmission:</strong> {selectedListing.transmission_type}</p>}
              {selectedListing.body_type && <p><strong>Body:</strong> {selectedListing.body_type}</p>}
              {selectedListing.car_city && <p><strong>City:</strong> {selectedListing.car_city}</p>}
              {selectedListing.car_owner_phone_number && <p><strong>Phone:</strong> {selectedListing.country_code || '+971'}{selectedListing.car_owner_phone_number}</p>}
              {selectedListing.rejection_note && <p><strong>Rejection Reason:</strong> {selectedListing.rejection_note}</p>}
              {selectedListing.images && selectedListing.images.length > 0 && (
                <div>
                  <strong>All Images ({selectedListing.images.length}):</strong>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {selectedListing.images.map((img, idx) => (
                      <img key={idx} src={img.image_url || img.url} alt={`Photo ${idx + 1}`}
                        style={{ width: '80px', height: '60px', objectFit: 'cover', borderRadius: '4px' }}
                        onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                      />
                    ))}
                  </div>
                </div>
              )}
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
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <label>Rejection Note (required)</label>
              <textarea
                value={rejectionNote}
                onChange={(e) => setRejectionNote(e.target.value)}
                placeholder="Enter reason for rejection..."
                rows={4}
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
    </div>
  );
};

export default AdminListings;
