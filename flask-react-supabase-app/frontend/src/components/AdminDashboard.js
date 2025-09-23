import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/AdminDashboard.css';

const AdminDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('plates');
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedListing, setSelectedListing] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [listingToReject, setListingToReject] = useState(null);

  useEffect(() => {
    const fetchListings = async () => {
      try {
        setLoading(true);
        let endpoint = '';
        switch (activeTab) {
          case 'plates':
            endpoint = '/api/plates';
            break;
          case 'cars':
            endpoint = '/api/cars';
            break;
          case 'bikes':
            endpoint = '/api/bikes';
            break;
          case 'parts':
            endpoint = '/api/parts';
            break;
          default:
            endpoint = '/api/plates';
        }
        
        console.log(`Fetching listings from ${endpoint}...`);
        const response = await apiClient.get(endpoint);
        console.log('Response received:', response);
        
        if (Array.isArray(response)) {
          console.log(`Received ${response.length} listings`);
          setListings(response);
        } else {
          console.error('Unexpected response format:', response);
          setListings([]);
        }
        
        setError(null);
      } catch (err) {
        console.error('Error fetching listings:', err);
        setError(`Failed to fetch listings: ${err.message || 'Unknown error'}`);
        setListings([]);
      } finally {
        setLoading(false);
      }
    };

    fetchListings();
  }, [activeTab]);

  const handleApprove = async (id, type) => {
    try {
      console.log(`Approving ${type} with ID: ${id}`);
      setIsLoading(true);
      
      // Make the approval request
      const response = await apiClient.post(`/api/${type}/${id}/approve`);
      console.log('Approval response:', response);
      
      // Show success message
      setSuccessMessage(`${type.charAt(0).toUpperCase() + type.slice(0, -1)} approved successfully`);
      
      // Wait a brief moment to ensure the backend has processed the change
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Refresh the listings to reflect the changes
      console.log(`Reloading ${activeTab} after approval`);
      const updatedListings = await apiClient.get(`/api/${activeTab}`);
      console.log('Updated listings:', updatedListings);
      
      if (Array.isArray(updatedListings)) {
        console.log(`Found ${updatedListings.length} updated listings`);
        setListings(updatedListings);
      } else {
        console.error('Unexpected response format after approval:', updatedListings);
      }
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (error) {
      console.error(`Error approving ${type}:`, error);
      setError(`Failed to approve ${type}: ${error.message || 'Unknown error'}`);
      
      // Clear error message after 3 seconds
      setTimeout(() => {
        setError('');
      }, 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async (id, type, note = '') => {
    try {
      console.log(`Rejecting ${type} with ID: ${id} and note: ${note}`);
      setIsLoading(true);
      
      // Make the rejection request with optional note
      const requestData = note ? { rejection_note: note } : {};
      const response = await apiClient.post(`/api/${type}/${id}/reject`, requestData);
      console.log('Rejection response:', response);
      
      // Show success message
      setSuccessMessage(`${type.charAt(0).toUpperCase() + type.slice(0, -1)} rejected successfully`);
      
      // Wait a brief moment to ensure the backend has processed the change
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Refresh the listings to reflect the changes
      console.log(`Reloading ${activeTab} after rejection`);
      const updatedListings = await apiClient.get(`/api/${activeTab}`);
      console.log('Updated listings:', updatedListings);
      
      if (Array.isArray(updatedListings)) {
        console.log(`Found ${updatedListings.length} updated listings`);
        setListings(updatedListings);
      } else {
        console.error('Unexpected response format after rejection:', updatedListings);
      }
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (error) {
      console.error(`Error rejecting ${type}:`, error);
      setError(`Failed to reject ${type}: ${error.message || 'Unknown error'}`);
      
      // Clear error message after 3 seconds
      setTimeout(() => {
        setError('');
      }, 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const openRejectModal = (listing) => {
    setListingToReject(listing);
    setRejectionNote('');
    setShowRejectModal(true);
  };

  const confirmReject = async () => {
    if (listingToReject) {
      await handleReject(listingToReject.id, activeTab.slice(0, -1), rejectionNote);
      setShowRejectModal(false);
      setListingToReject(null);
      setRejectionNote('');
    }
  };

  const openDetailModal = (listing) => {
    setSelectedListing(listing);
    setShowDetailModal(true);
  };

  if (!user || !user.is_admin) {
    return (
      <div className="admin-dashboard">
        <h2>Access Denied</h2>
        <p>You must be an administrator to access this page.</p>
      </div>
    );
  }

  // Format the listing title based on the type
  const getListingTitle = (listing, type) => {
    switch (type) {
      case 'plates':
        return `${listing.city || ''} ${listing.code || ''} ${listing.number || ''}`;
      case 'cars':
        return `${listing.listing_title || ''} ${listing.make_year ? `(${listing.make_year})` : ''} - ${formatPrice(listing.expected_selling_price || 0)}`;
      case 'bikes':
        return `${listing.make || ''} ${listing.model || ''}`;
      case 'parts':
        return listing.name || 'Unnamed part';
      default:
        return 'Unknown listing';
    }
  };

  // Format price with currency symbol
  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      maximumFractionDigits: 0
    }).format(price);
  };

  // Get a summary of the listing details based on type
  const getListingSummary = (listing, type) => {
    switch (type) {
      case 'plates':
        return `Price: ${listing.price ? `AED ${listing.price.toLocaleString()}` : 'N/A'} | Contact: ${listing.contact_phone || 'N/A'}`;
      case 'cars':
        return `${listing.car_manufacturer || ''} ${listing.car_model || ''} | ${listing.body_type || ''} | ${listing.fuel_type || ''} | ${listing.kilometer_driven ? `${listing.kilometer_driven.toLocaleString()} km` : 'N/A'}`;
      case 'bikes':
        return `Year: ${listing.year || 'N/A'} | Price: ${listing.price ? `AED ${listing.price.toLocaleString()}` : 'N/A'}`;
      case 'parts':
        return `Category: ${listing.category || 'N/A'} | Price: ${listing.price ? `AED ${listing.price.toLocaleString()}` : 'N/A'}`;
      default:
        return '';
    }
  };

  return (
    <div className="admin-dashboard">
      <h1>Admin Dashboard</h1>
      
      <div className="admin-tabs">
        <button 
          className={activeTab === 'plates' ? 'active' : ''} 
          onClick={() => setActiveTab('plates')}
        >
          License Plates
        </button>
        <button 
          className={activeTab === 'cars' ? 'active' : ''} 
          onClick={() => setActiveTab('cars')}
        >
          Cars
        </button>
        <button 
          className={activeTab === 'bikes' ? 'active' : ''} 
          onClick={() => setActiveTab('bikes')}
        >
          Bikes
        </button>
        <button 
          className={activeTab === 'parts' ? 'active' : ''} 
          onClick={() => setActiveTab('parts')}
        >
          Parts
        </button>
      </div>
      
      {successMessage && (
        <div className="success-message">
          {successMessage}
        </div>
      )}
      
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
      
      <div className="admin-content">
        <h2>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Listings</h2>
        
        {loading ? (
          <div className="loading-message">Loading listings...</div>
        ) : (
          <>
            <div className="listings-stats">
              <div className="stat-item">
                <span className="stat-value">{listings.length}</span>
                <span className="stat-label">Total Listings</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {listings.filter(item => item.status === 'pending').length}
                </span>
                <span className="stat-label">Pending Approval</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {listings.filter(item => item.status === 'approved').length}
                </span>
                <span className="stat-label">Approved</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {listings.filter(item => item.status === 'rejected').length}
                </span>
                <span className="stat-label">Rejected</span>
              </div>
            </div>
            
            <div className="listings-filter">
              <h3>Pending Approval</h3>
              {listings.filter(item => item.status === 'pending').length === 0 && (
                <p className="no-listings">No pending listings found.</p>
              )}
              <div className="listings-grid">
                {listings
                  .filter(item => item.status === 'pending')
                  .map(listing => (
                    <div key={listing.id} className="listing-card">
                      <div className="listing-header">
                        <h4 className="listing-title">
                          {getListingTitle(listing, activeTab.slice(0, -1))}
                        </h4>
                        <span className="listing-date">
                          {new Date(listing.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="listing-body">
                        <p className="listing-summary">
                          {getListingSummary(listing, activeTab)}
                        </p>
                        <p className="listing-contact">
                          <strong>Contact:</strong> {listing.car_owner_phone_number || listing.contact_phone || 'N/A'}
                        </p>
                        <p className="listing-email">
                          <strong>Email:</strong> {listing.user_email || 'N/A'}
                        </p>
                      </div>
                      <div className="listing-actions">
                        <button 
                          className="view-btn"
                          onClick={() => openDetailModal(listing)}
                        >
                          View Details
                        </button>
                        <button 
                          className="approve-btn"
                          onClick={() => handleApprove(listing.id, activeTab)}
                          disabled={isLoading}
                        >
                          Approve
                        </button>
                        <button 
                          className="reject-btn"
                          onClick={() => openRejectModal(listing)}
                          disabled={isLoading}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            
            <div className="listings-filter">
              <h3>Approved Listings</h3>
              {listings.filter(item => item.status === 'approved').length === 0 && (
                <p className="no-listings">No approved listings found.</p>
              )}
              <div className="listings-grid">
                {listings
                  .filter(item => item.status === 'approved')
                  .map(listing => (
                    <div key={listing.id} className="listing-card approved">
                      <div className="listing-header">
                        <h4 className="listing-title">
                          {getListingTitle(listing, activeTab.slice(0, -1))}
                        </h4>
                        <span className="listing-date">
                          {new Date(listing.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="listing-body">
                        <p className="listing-summary">
                          {getListingSummary(listing, activeTab)}
                        </p>
                        <p className="listing-contact">
                          <strong>Contact:</strong> {listing.car_owner_phone_number || listing.contact_phone || 'N/A'}
                        </p>
                        <p className="listing-status">
                          <span className="status-indicator approved"></span> Approved
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            
            <div className="listings-filter">
              <h3>Rejected Listings</h3>
              {listings.filter(item => item.status === 'rejected').length === 0 && (
                <p className="no-listings">No rejected listings found.</p>
              )}
              <div className="listings-grid">
                {listings
                  .filter(item => item.status === 'rejected')
                  .map(listing => (
                    <div key={listing.id} className="listing-card rejected">
                      <div className="listing-header">
                        <h4 className="listing-title">
                          {getListingTitle(listing, activeTab.slice(0, -1))}
                        </h4>
                        <span className="listing-date">
                          {new Date(listing.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="listing-body">
                        <p className="listing-summary">
                          {getListingSummary(listing, activeTab)}
                        </p>
                        <p className="listing-contact">
                          <strong>Contact:</strong> {listing.car_owner_phone_number || listing.contact_phone || 'N/A'}
                        </p>
                        <p className="listing-status">
                          <span className="status-indicator rejected"></span> Rejected
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Listing Detail Modal */}
      {showDetailModal && selectedListing && (
        <div className="modal-overlay" onClick={() => setShowDetailModal(false)}>
          <div className="modal-content listing-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Listing Details</h3>
              <button className="close-btn" onClick={() => setShowDetailModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="listing-detail-content">
                <h4>{getListingTitle(selectedListing, activeTab.slice(0, -1))}</h4>
                
                {/* Images Section */}
                {selectedListing.images && selectedListing.images.length > 0 && (
                  <div className="listing-images">
                    <h5>Images:</h5>
                    <div className="image-gallery">
                      {selectedListing.images.map((image, index) => (
                        <img 
                          key={index}
                          src={image.url || image.image_url || image}
                          alt={`Listing ${index + 1}`}
                          className="listing-image"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Listing Details by Type */}
                {activeTab === 'cars' && (
                  <div className="car-details">
                    <div className="detail-row">
                      <strong>Make:</strong> {selectedListing.car_manufacturer || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Model:</strong> {selectedListing.car_model || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Year:</strong> {selectedListing.make_year || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Price:</strong> {selectedListing.expected_selling_price ? `AED ${selectedListing.expected_selling_price.toLocaleString()}` : 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Mileage:</strong> {selectedListing.kilometer_driven ? `${selectedListing.kilometer_driven.toLocaleString()} km` : 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Body Type:</strong> {selectedListing.body_type || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Fuel Type:</strong> {selectedListing.fuel_type || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Transmission:</strong> {selectedListing.transmission || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>VIN:</strong> {selectedListing.vin_number || 'N/A'}
                    </div>
                  </div>
                )}

                {activeTab === 'bikes' && (
                  <div className="bike-details">
                    <div className="detail-row">
                      <strong>Make:</strong> {selectedListing.make || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Model:</strong> {selectedListing.model || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Year:</strong> {selectedListing.year || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Price:</strong> {selectedListing.price ? `AED ${selectedListing.price.toLocaleString()}` : 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Type:</strong> {selectedListing.bike_type || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Condition:</strong> {selectedListing.condition || 'N/A'}
                    </div>
                  </div>
                )}

                {activeTab === 'parts' && (
                  <div className="parts-details">
                    <div className="detail-row">
                      <strong>Name:</strong> {selectedListing.name || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Type:</strong> {selectedListing.part_type || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Category:</strong> {selectedListing.category || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Condition:</strong> {selectedListing.condition || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Price:</strong> {selectedListing.price ? `AED ${selectedListing.price.toLocaleString()}` : 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Compatible Makes:</strong> {selectedListing.compatible_makes ? selectedListing.compatible_makes.join(', ') : 'N/A'}
                    </div>
                  </div>
                )}

                {activeTab === 'plates' && (
                  <div className="plates-details">
                    <div className="detail-row">
                      <strong>City:</strong> {selectedListing.city || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Code:</strong> {selectedListing.code || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Number:</strong> {selectedListing.number || selectedListing.digits || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Price:</strong> {selectedListing.price ? `AED ${selectedListing.price.toLocaleString()}` : 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Format:</strong> {selectedListing.plate_format || 'N/A'}
                    </div>
                  </div>
                )}

                <div className="contact-details">
                  <h5>Contact Information:</h5>
                  <div className="detail-row">
                    <strong>Email:</strong> {selectedListing.user_email || 'N/A'}
                  </div>
                  <div className="detail-row">
                    <strong>Phone:</strong> {selectedListing.car_owner_phone_number || selectedListing.contact_phone || 'N/A'}
                  </div>
                  <div className="detail-row">
                    <strong>Name:</strong> {selectedListing.contact_name || selectedListing.car_owner_name || 'N/A'}
                  </div>
                </div>

                {selectedListing.description && (
                  <div className="description-section">
                    <h5>Description:</h5>
                    <p>{selectedListing.description}</p>
                  </div>
                )}

                <div className="status-info">
                  <div className="detail-row">
                    <strong>Status:</strong> {selectedListing.status || 'N/A'}
                  </div>
                  <div className="detail-row">
                    <strong>Created:</strong> {new Date(selectedListing.created_at).toLocaleString()}
                  </div>
                  {selectedListing.rejection_note && (
                    <div className="detail-row">
                      <strong>Rejection Note:</strong> {selectedListing.rejection_note}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button 
                className="approve-btn"
                onClick={() => {
                  handleApprove(selectedListing.id, activeTab);
                  setShowDetailModal(false);
                }}
                disabled={isLoading}
              >
                Approve
              </button>
              <button 
                className="reject-btn"
                onClick={() => {
                  setShowDetailModal(false);
                  openRejectModal(selectedListing);
                }}
                disabled={isLoading}
              >
                Reject
              </button>
              <button className="cancel-btn" onClick={() => setShowDetailModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {showRejectModal && listingToReject && (
        <div className="modal-overlay" onClick={() => setShowRejectModal(false)}>
          <div className="modal-content rejection-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reject Listing</h3>
              <button className="close-btn" onClick={() => setShowRejectModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to reject this listing?</p>
              <h4>{getListingTitle(listingToReject, activeTab.slice(0, -1))}</h4>
              
              <div className="rejection-note-section">
                <label htmlFor="rejection-note">Rejection Reason (Optional):</label>
                <textarea
                  id="rejection-note"
                  value={rejectionNote}
                  onChange={(e) => setRejectionNote(e.target.value)}
                  placeholder="Provide a reason for rejection to help the user understand..."
                  rows="4"
                  className="rejection-note-input"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button 
                className="confirm-reject-btn"
                onClick={confirmReject}
                disabled={isLoading}
              >
                {isLoading ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
              <button className="cancel-btn" onClick={() => setShowRejectModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard; 