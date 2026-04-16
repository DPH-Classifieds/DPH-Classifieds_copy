import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminDashboard.css';

const AdminListings = () => {
  const [searchParams] = useSearchParams();
  const filter = searchParams.get('filter') || 'cars';
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
        const response = await apiClient.get(`/api/admin/approve/${filter}`);
        setListings(Array.isArray(response) ? response : []);
      } catch (error) {
        console.error('Failed to fetch listings:', error);
        setListings([]);
      } finally {
        setLoading(false);
      }
    };

    fetchListings();
  }, [filter]);

  const handleApprove = async (listingId) => {
    try {
      setActionLoading(true);
      await apiClient.post(`/api/admin/approve/${filter}/${listingId}/approve`);
      setListings(listings.filter(l => l.id !== listingId));
      setSuccessMessage('Listing approved successfully!');
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
      setSuccessMessage('Listing rejected successfully!');
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
    if (listing.title) return listing.title;
    if (listing.make && listing.model) return `${listing.make} ${listing.model}`;
    if (listing.make) return listing.make;
    return `Listing #${listing.id}`;
  };

  const ListingCard = ({ listing }) => (
    <div className="listing-card">
      <div className="listing-info">
        <h3>{getListingTitle(listing)}</h3>
        <p><strong>Price:</strong> {listing.price ? `${listing.price} AED` : 'N/A'}</p>
        <p><strong>Seller:</strong> {listing.seller_email || listing.user_email || 'N/A'}</p>
        <p><strong>Status:</strong> <span className="status-pending">Pending Review</span></p>
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
        <button
          onClick={() => handleApprove(listing.id)}
          className="action-button approve-btn"
          disabled={actionLoading}
        >
          Approve
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Loading {filter}...</p>
      </div>
    );
  }

  const filterOptions = ['cars', 'parts', 'plates', 'bikes'];

  return (
    <div className="admin-listings">
      <div className="page-header">
        <h1>Pending {filter.charAt(0).toUpperCase() + filter.slice(1)}</h1>
        <p>Review and approve pending {filter} listings</p>
        {successMessage && (
          <div className="success-message">{successMessage}</div>
        )}
      </div>

      <div className="filter-tabs">
        {filterOptions.map(option => (
          <a
            key={option}
            href={`/admin/listings?filter=${option}`}
            className={`filter-tab ${filter === option ? 'active' : ''}`}
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </a>
        ))}
      </div>

      {listings.length === 0 ? (
        <div className="empty-state">
          <h2>No pending {filter}</h2>
          <p>All {filter} have been reviewed. Great job!</p>
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
                ×
              </button>
            </div>
            <div className="modal-body">
              <p><strong>Title:</strong> {getListingTitle(selectedListing)}</p>
              <p><strong>Price:</strong> {selectedListing.price ? `${selectedListing.price} AED` : 'N/A'}</p>
              <p><strong>Description:</strong> {selectedListing.description || 'No description provided'}</p>
              <p><strong>Seller:</strong> {selectedListing.seller_email || selectedListing.user_email || 'N/A'}</p>
              <p><strong>Created:</strong> {selectedListing.created_at ? new Date(selectedListing.created_at).toLocaleDateString() : 'N/A'}</p>
              {selectedListing.make && <p><strong>Make:</strong> {selectedListing.make}</p>}
              {selectedListing.model && <p><strong>Model:</strong> {selectedListing.model}</p>}
              {selectedListing.year && <p><strong>Year:</strong> {selectedListing.year}</p>}
              {selectedListing.mileage && <p><strong>Mileage:</strong> {selectedListing.mileage}</p>}
            </div>
            <div className="modal-footer">
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
                ×
              </button>
            </div>
            <div className="modal-body">
              <label>Rejection Note (required):</label>
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
