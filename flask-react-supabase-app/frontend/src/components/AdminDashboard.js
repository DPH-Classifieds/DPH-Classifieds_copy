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

  const handleReject = async (id, type) => {
    try {
      console.log(`Rejecting ${type} with ID: ${id}`);
      setIsLoading(true);
      
      // Make the rejection request
      const response = await apiClient.post(`/api/${type}/${id}/reject`);
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
    return new Intl.NumberFormat('en-US', {
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
                          className="approve-btn"
                          onClick={() => handleApprove(listing.id, activeTab)}
                          disabled={isLoading}
                        >
                          Approve
                        </button>
                        <button 
                          className="reject-btn"
                          onClick={() => handleReject(listing.id, activeTab)}
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
    </div>
  );
};

export default AdminDashboard; 