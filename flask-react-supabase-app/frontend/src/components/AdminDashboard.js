import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/AdminDashboard.css';

const AdminDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('plates');
  const [listings, setListings] = useState([]);
  const [reports, setReports] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedListing, setSelectedListing] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [listingToReject, setListingToReject] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportedListing, setReportedListing] = useState(null);
  const [loadingReportedListing, setLoadingReportedListing] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [selectedDealer, setSelectedDealer] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [showDealerModal, setShowDealerModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        if (activeTab === 'reports') {
          // Fetch reports
          console.log('Fetching reports...');
          const response = await apiClient.get('/api/admin/reports');
          console.log('Reports received:', response);
          
          if (Array.isArray(response)) {
            console.log(`Received ${response.length} reports`);
            setReports(response);
          } else {
            console.error('Unexpected response format:', response);
            setReports([]);
          }
        } else if (activeTab === 'dealers') {
          // Fetch dealers
          console.log('Fetching dealers...');
          const response = await apiClient.get('/api/admin/dealers');
          console.log('Dealers received:', response);
          
          if (Array.isArray(response)) {
            console.log(`Received ${response.length} dealers`);
            setDealers(response);
          } else {
            console.error('Unexpected response format:', response);
            setDealers([]);
          }
        } else {
          // Fetch listings
          let endpoint = '';
          switch (activeTab) {
            case 'plates':
              endpoint = '/api/admin/plates';
              break;
            case 'cars':
              endpoint = '/api/admin/cars';
              break;
            case 'bikes':
              endpoint = '/api/admin/bikes';
              break;
            case 'parts':
              endpoint = '/api/admin/parts';
              break;
            default:
              endpoint = '/api/admin/plates';
          }
          
          console.log(`Fetching listings from ${endpoint}...`);
          const response = await apiClient.get(endpoint);
          console.log('Response received:', response);
          console.log('Sample listing data:', response[0]); // Log first listing to see structure
          
          if (Array.isArray(response)) {
            console.log(`Received ${response.length} listings`);
            setListings(response);
          } else {
            console.error('Unexpected response format:', response);
            setListings([]);
          }
        }
        
        setError(null);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(`Failed to fetch data: ${err.message || 'Unknown error'}`);
        if (activeTab === 'reports') {
          setReports([]);
        } else if (activeTab === 'dealers') {
          setDealers([]);
        } else {
          setListings([]);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
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
      const updatedListings = await apiClient.get(`/api/admin/${activeTab}`);
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

  const handleDelete = async (id, type) => {
    try {
      if (!window.confirm('Are you sure you want to permanently delete this listing? This action cannot be undone.')) {
        return;
      }
      
      console.log(`Deleting ${type} with ID: ${id}`);
      setIsLoading(true);
      
      // Make the delete request
      const response = await apiClient.delete(`/api/${type}/${id}/delete`);
      console.log('Delete response:', response);
      
      // Show success message
      setSuccessMessage(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully`);
      
      // Wait a brief moment to ensure the backend has processed the change
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Refresh the listings to reflect the changes
      console.log(`Reloading ${activeTab} after deletion`);
      const updatedListings = await apiClient.get(`/api/admin/${activeTab}`);
      console.log('Updated listings:', updatedListings);
      
      if (Array.isArray(updatedListings)) {
        console.log(`Found ${updatedListings.length} updated listings`);
        setListings(updatedListings);
      } else {
        console.error('Unexpected response format after deletion:', updatedListings);
      }
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (error) {
      console.error(`Error deleting ${type}:`, error);
      setError(`Failed to delete ${type}: ${error.message || 'Unknown error'}`);
      
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
      const updatedListings = await apiClient.get(`/api/admin/${activeTab}`);
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

  const handleReportAction = async (reportId, status) => {
    try {
      setIsLoading(true);
      
      await apiClient.patch(`/api/reports/${reportId}`, { status });
      
      setSuccessMessage(`Report ${status} successfully`);
      
      // Refresh reports
      const updatedReports = await apiClient.get('/api/admin/reports');
      if (Array.isArray(updatedReports)) {
        setReports(updatedReports);
      }
      
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (error) {
      console.error(`Error updating report:`, error);
      setError(`Failed to update report: ${error.message || 'Unknown error'}`);
      
      setTimeout(() => {
        setError('');
      }, 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveListing = async (listingId, listingType) => {
    if (!window.confirm('Are you sure you want to permanently delete this listing? This action cannot be undone.')) {
      return;
    }

    try {
      setIsLoading(true);
      
      // Delete the listing based on type
      const endpoint = `/api/${listingType}s/${listingId}`;
      await apiClient.delete(endpoint);
      
      setSuccessMessage(`${listingType.charAt(0).toUpperCase() + listingType.slice(1)} listing removed successfully`);
      
      // Refresh reports to update the display
      const updatedReports = await apiClient.get('/api/admin/reports');
      if (Array.isArray(updatedReports)) {
        setReports(updatedReports);
      }
      
      setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
    } catch (error) {
      console.error(`Error removing listing:`, error);
      setError(`Failed to remove listing: ${error.message || 'Unknown error'}`);
      
      setTimeout(() => {
        setError('');
      }, 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchReportedListing = async (listingId, listingType) => {
    try {
      const endpoint = `/api/${listingType}s/${listingId}`;
      const listing = await apiClient.get(endpoint);
      return listing;
    } catch (error) {
      console.error(`Error fetching reported listing:`, error);
      return null;
    }
  };

  // Helper function to get proper image URL
  const getImageUrl = (image) => {
    if (!image) return null;
    
    // Try all possible image URL fields
    const imageUrl = image.url || image.image_url || image;
    
    // Check if the URL is a relative URL that needs the API base URL
    if (imageUrl && imageUrl.startsWith('/')) {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
      return `${API_URL}${imageUrl}`;
    }
    
    return imageUrl;
  };

  if (!user || !user.is_admin) {
    return (
      <div className="admin-dashboard">
        <h2>Access Denied</h2>
        <p>You must be an administrator to access this page.</p>
      </div>
    );
  }

  // Format the listing title based on the type - Enhanced for admin view
  const getListingTitle = (listing, type) => {
    switch (type) {
      case 'plates':
        return `${listing.city || ''} ${listing.code || ''} ${listing.number || listing.digits || ''}`;
      case 'cars':
        // Enhanced admin title: Make Model Year + Poster info
        const carMake = listing.car_manufacturer || listing.make || '';
        const carModel = listing.car_model || listing.model || '';
        const carYear = listing.make_year || listing.year || '';
        const posterName = listing.user_email || listing.car_owner_name || 'Unknown User';
        const carTitle = `${carMake} ${carModel} ${carYear}`.trim() || 'Car Listing';
        return `${carTitle} - Posted by ${posterName}`;
      case 'bikes':
        const bikeMake = listing.make || '';
        const bikeModel = listing.model || '';
        const bikeYear = listing.year || '';
        const bikePosterName = listing.user_email || listing.bike_owner_name || 'Unknown User';
        const bikeTitle = `${bikeMake} ${bikeModel} ${bikeYear ? `(${bikeYear})` : ''}`.trim() || 'Bike Listing';
        return `${bikeTitle} - Posted by ${bikePosterName}`;
      case 'parts':
        const partName = listing.name || listing.part_name || 'Car Part';
        const partPosterName = listing.user_email || listing.contact_name || 'Unknown User';
        return `${partName} - Posted by ${partPosterName}`;
      default:
        return 'Unknown listing';
    }
  };

  // Format price with currency symbol
  // eslint-disable-next-line no-unused-vars
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
        const platePrice = listing.price ? `AED ${listing.price.toLocaleString()}` : 'N/A';
        const plateContact = listing.contact_phone || listing.car_owner_phone_number || 'N/A';
        return `Price: ${platePrice} | Contact: ${plateContact}`;
      case 'cars':
        const carMake = listing.car_manufacturer || listing.make || 'N/A';
        const carModel = listing.car_model || listing.model || 'N/A';
        const bodyType = listing.body_type || 'N/A';
        const fuelType = listing.fuel_type || 'N/A';
        const mileage = listing.kilometer_driven ? `${listing.kilometer_driven.toLocaleString()} km` : 'N/A';
        return `${carMake} ${carModel} | ${bodyType} | ${fuelType} | ${mileage}`;
      case 'bikes':
        const bikeYear = listing.year || 'N/A';
        const bikePrice = listing.price || listing.expected_selling_price;
        const bikePriceStr = bikePrice ? `AED ${bikePrice.toLocaleString()}` : 'N/A';
        const bikeType = listing.bike_type || listing.type || 'N/A';
        return `Year: ${bikeYear} | Price: ${bikePriceStr} | Type: ${bikeType}`;
      case 'parts':
        const partCategory = listing.category || listing.part_type || 'N/A';
        const partPrice = listing.price ? `AED ${listing.price.toLocaleString()}` : 'N/A';
        const partCondition = listing.condition || 'N/A';
        return `Category: ${partCategory} | Price: ${partPrice} | Condition: ${partCondition}`;
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
        <button 
          className={activeTab === 'reports' ? 'active' : ''} 
          onClick={() => setActiveTab('reports')}
        >
          Reports
        </button>
        <button 
          className={activeTab === 'dealers' ? 'active' : ''} 
          onClick={() => setActiveTab('dealers')}
        >
          Dealers
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
        {activeTab === 'reports' ? (
          <>
            <h2>User Reports</h2>
            {loading ? (
              <div className="loading-message">Loading reports...</div>
            ) : (
              <>
                <div className="listings-stats">
                  <div className="stat-item">
                    <span className="stat-value">{reports.length}</span>
                    <span className="stat-label">Total Reports</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">
                      {reports.filter(r => r.status === 'pending').length}
                    </span>
                    <span className="stat-label">Pending Review</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">
                      {reports.filter(r => r.status === 'resolved').length}
                    </span>
                    <span className="stat-label">Resolved</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">
                      {reports.filter(r => r.status === 'dismissed').length}
                    </span>
                    <span className="stat-label">Dismissed</span>
                  </div>
                </div>

                <div className="listings-filter">
                  <h3>Pending Reports</h3>
                  {reports.filter(r => r.status === 'pending').length === 0 && (
                    <p className="no-listings">No pending reports found.</p>
                  )}
                  <div className="listings-grid">
                    {reports
                      .filter(r => r.status === 'pending')
                      .map(report => (
                        <div key={report.id} className="listing-card">
                          <div className="listing-header">
                            <h4 className="listing-title">
                              {report.listing_type.charAt(0).toUpperCase() + report.listing_type.slice(1)} ID: {report.listing_id}
                            </h4>
                            <span className="listing-date">
                              {new Date(report.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="listing-body">
                            <p className="listing-summary">
                              <strong>Reason:</strong> {report.reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </p>
                            {report.details && (
                              <p className="listing-details">
                                <strong>Details:</strong> {report.details}
                              </p>
                            )}
                            <p className="listing-contact">
                              <strong>Reporter ID:</strong> {report.reporter_id}
                            </p>
                          </div>
                          <div className="listing-actions">
                            <button 
                              className="view-btn"
                              onClick={() => {
                                setSelectedReport(report);
                                setShowReportModal(true);
                              }}
                            >
                              View Details
                            </button>
                            <button 
                              className="approve-btn"
                              onClick={() => handleReportAction(report.id, 'resolved')}
                              disabled={isLoading}
                            >
                              Resolve
                            </button>
                            <button 
                              className="reject-btn"
                              onClick={() => handleReportAction(report.id, 'dismissed')}
                              disabled={isLoading}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="listings-filter">
                  <h3>Resolved Reports</h3>
                  {reports.filter(r => r.status === 'resolved').length === 0 && (
                    <p className="no-listings">No resolved reports found.</p>
                  )}
                  <div className="listings-grid">
                    {reports
                      .filter(r => r.status === 'resolved')
                      .slice(0, 10)
                      .map(report => (
                        <div key={report.id} className="listing-card approved">
                          <div className="listing-header">
                            <h4 className="listing-title">
                              {report.listing_type.charAt(0).toUpperCase() + report.listing_type.slice(1)} ID: {report.listing_id}
                            </h4>
                            <span className="listing-date">
                              {new Date(report.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="listing-body">
                            <p className="listing-summary">
                              <strong>Reason:</strong> {report.reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </p>
                            <p className="listing-status">
                              <span className="status-indicator approved"></span> Resolved
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
          </>
        ) : activeTab === 'dealers' ? (
          <>
            <h2>Dealer Management</h2>
            {loading ? (
              <div className="loading-message">Loading dealers...</div>
            ) : (
              <>
                <div className="listings-stats">
                  <div className="stat-item">
                    <span className="stat-value">{dealers.length}</span>
                    <span className="stat-label">Total Dealers</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">
                      {dealers.filter(d => d.dealer_verified).length}
                    </span>
                    <span className="stat-label">Verified</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-value">
                      {dealers.filter(d => !d.dealer_verified).length}
                    </span>
                    <span className="stat-label">Pending Verification</span>
                  </div>
                </div>

                <div className="listings-filter">
                  <h3>Pending Dealer Verifications</h3>
                  {dealers.filter(d => !d.dealer_verified).length === 0 && (
                    <p className="no-listings">No pending dealer verifications found.</p>
                  )}
                  <div className="listings-grid">
                    {dealers
                      .filter(d => !d.dealer_verified)
                      .map(dealer => (
                        <div key={dealer.id} className="listing-card">
                          <div className="listing-header">
                            <h4 className="listing-title">
                              {dealer.company_name || 'Unknown Company'}
                            </h4>
                            <span className="listing-date">
                              Registered: {new Date(dealer.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="listing-body">
                            <p className="listing-summary">
                              <strong>Contact:</strong> {dealer.first_name} {dealer.last_name}
                            </p>
                            <p className="listing-contact">
                              <strong>Email:</strong> {dealer.email}
                            </p>
                            {dealer.phone && (
                              <p className="listing-contact">
                                <strong>Phone:</strong> {dealer.phone}
                              </p>
                            )}
                            {dealer.company_registration_number && (
                              <p className="listing-details">
                                <strong>Registration #:</strong> {dealer.company_registration_number}
                              </p>
                            )}
                            {dealer.trade_license_number && (
                              <p className="listing-details">
                                <strong>Trade License #:</strong> {dealer.trade_license_number}
                              </p>
                            )}
                            {dealer.city && (
                              <p className="listing-location">
                                <strong>Location:</strong> {dealer.city}, {dealer.emirate || 'UAE'}
                              </p>
                            )}
                          </div>
                          <div className="listing-actions">
                            <button 
                              className="view-btn"
                              onClick={() => {
                                setSelectedDealer(dealer);
                                setShowDealerModal(true);
                              }}
                            >
                              View Details
                            </button>
                            <button 
                              className="approve-btn"
                              onClick={async () => {
                                try {
                                  await apiClient.post(`/api/admin/dealers/${dealer.id}/verify`);
                                  setSuccessMessage('Dealer verified successfully!');
                                  // Refresh dealers list
                                  const updatedDealers = await apiClient.get('/api/admin/dealers');
                                  setDealers(updatedDealers);
                                  setTimeout(() => setSuccessMessage(''), 3000);
                                } catch (error) {
                                  setError(`Failed to verify dealer: ${error.message}`);
                                }
                              }}
                              disabled={isLoading}
                            >
                              Verify Dealer
                            </button>
                            <button 
                              className="reject-btn"
                              onClick={async () => {
                                const note = prompt('Enter rejection reason (optional):');
                                try {
                                  await apiClient.post(`/api/admin/dealers/${dealer.id}/reject`, {
                                    rejection_note: note || ''
                                  });
                                  setSuccessMessage('Dealer verification rejected');
                                  // Refresh dealers list
                                  const updatedDealers = await apiClient.get('/api/admin/dealers');
                                  setDealers(updatedDealers);
                                  setTimeout(() => setSuccessMessage(''), 3000);
                                } catch (error) {
                                  setError(`Failed to reject dealer: ${error.message}`);
                                }
                              }}
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
                  <h3>Verified Dealers</h3>
                  {dealers.filter(d => d.dealer_verified).length === 0 && (
                    <p className="no-listings">No verified dealers found.</p>
                  )}
                  <div className="listings-grid">
                    {dealers
                      .filter(d => d.dealer_verified)
                      .slice(0, 10)
                      .map(dealer => (
                        <div key={dealer.id} className="listing-card approved">
                          <div className="listing-header">
                            <h4 className="listing-title">
                              {dealer.company_name || 'Unknown Company'}
                            </h4>
                            <span className="listing-date">
                              Verified: {new Date(dealer.dealer_verified_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="listing-body">
                            <p className="listing-summary">
                              <strong>Contact:</strong> {dealer.first_name} {dealer.last_name}
                            </p>
                            <p className="listing-contact">
                              <strong>Email:</strong> {dealer.email}
                            </p>
                            <p className="listing-status">
                              <span className="status-indicator approved"></span> Verified Dealer
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
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
                      <div className="listing-actions">
                        <button 
                          className="view-btn"
                          onClick={() => openDetailModal(listing)}
                        >
                          View Details
                        </button>
                        <button 
                          className="delete-btn"
                          onClick={() => handleDelete(listing.id, activeTab.slice(0, -1))}
                          disabled={isLoading}
                          style={{backgroundColor: '#dc3545'}}
                        >
                          Delete
                        </button>
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
                          src={getImageUrl(image)}
                          alt={`Listing ${index + 1}`}
                          className="listing-image"
                          onError={(e) => {
                            console.error("Image failed to load:", e.target.src);
                            e.target.onerror = null;
                            e.target.src = "https://via.placeholder.com/150x120?text=Image+Not+Available";
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Listing Details by Type */}
                {activeTab === 'cars' && (
                  <div className="car-details">
                    <div className="detail-row">
                      <strong>Make:</strong> {selectedListing.car_manufacturer || selectedListing.make || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Model:</strong> {selectedListing.car_model || selectedListing.model || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Year:</strong> {selectedListing.make_year || selectedListing.year || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Price:</strong> {(selectedListing.expected_selling_price || selectedListing.price) ? `AED ${(selectedListing.expected_selling_price || selectedListing.price).toLocaleString()}` : 'N/A'}
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
                      <strong>Transmission:</strong> {selectedListing.transmission || selectedListing.transmission_type || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>VIN:</strong> {selectedListing.vin_number || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Location:</strong> {selectedListing.car_city || selectedListing.location || 'N/A'}
                    </div>
                    <div className="detail-row">
                      <strong>Regional Spec:</strong> {selectedListing.regional_spec || 'N/A'}
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

      {/* Report Detail Modal */}
      {showReportModal && selectedReport && (
        <div className="modal-overlay" onClick={() => {
          setShowReportModal(false);
          setReportedListing(null);
        }}>
          <div className="modal-content listing-detail-modal report-modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Report Details</h3>
              <button className="close-btn" onClick={() => {
                setShowReportModal(false);
                setReportedListing(null);
              }}>×</button>
            </div>
            <div className="modal-body">
              <div className="listing-detail-content">
                <div className="report-section">
                  <h4>Report Information</h4>
                  <div className="detail-row">
                    <strong>Listing Type:</strong> {selectedReport.listing_type.charAt(0).toUpperCase() + selectedReport.listing_type.slice(1)}
                  </div>
                  <div className="detail-row">
                    <strong>Listing ID:</strong> {selectedReport.listing_id}
                  </div>
                  <div className="detail-row">
                    <strong>Reason:</strong> {selectedReport.reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </div>
                  {selectedReport.details && (
                    <div className="detail-row">
                      <strong>Details:</strong> {selectedReport.details}
                    </div>
                  )}
                  <div className="detail-row">
                    <strong>Reporter ID:</strong> {selectedReport.reporter_id}
                  </div>
                  <div className="detail-row">
                    <strong>Status:</strong> <span className={`status-badge ${selectedReport.status}`}>{selectedReport.status}</span>
                  </div>
                  <div className="detail-row">
                    <strong>Reported On:</strong> {new Date(selectedReport.created_at).toLocaleString()}
                  </div>
                  {selectedReport.admin_note && (
                    <div className="detail-row">
                      <strong>Admin Note:</strong> {selectedReport.admin_note}
                    </div>
                  )}
                </div>

                <div className="reported-listing-section">
                  <h4>Reported Listing</h4>
                  {!reportedListing && !loadingReportedListing && (
                    <button 
                      className="view-btn"
                      onClick={async () => {
                        setLoadingReportedListing(true);
                        const listing = await fetchReportedListing(selectedReport.listing_id, selectedReport.listing_type);
                        setReportedListing(listing);
                        setLoadingReportedListing(false);
                      }}
                    >
                      Load Listing Details
                    </button>
                  )}
                  {loadingReportedListing && <p>Loading listing...</p>}
                  {reportedListing && (
                    <div className="reported-listing-details">
                      {selectedReport.listing_type === 'car' && (
                        <>
                          <div className="detail-row">
                            <strong>Title:</strong> {reportedListing.listing_title || `${reportedListing.car_manufacturer} ${reportedListing.car_model}`}
                          </div>
                          <div className="detail-row">
                            <strong>Year:</strong> {reportedListing.make_year}
                          </div>
                          <div className="detail-row">
                            <strong>Price:</strong> AED {reportedListing.expected_selling_price?.toLocaleString()}
                          </div>
                          <div className="detail-row">
                            <strong>Contact:</strong> {reportedListing.contact_phone || reportedListing.car_owner_phone_number}
                          </div>
                        </>
                      )}
                      {selectedReport.listing_type === 'bike' && (
                        <>
                          <div className="detail-row">
                            <strong>Title:</strong> {reportedListing.make} {reportedListing.model} {reportedListing.year}
                          </div>
                          <div className="detail-row">
                            <strong>Price:</strong> AED {reportedListing.price?.toLocaleString()}
                          </div>
                        </>
                      )}
                      {selectedReport.listing_type === 'plate' && (
                        <>
                          <div className="detail-row">
                            <strong>Plate:</strong> {reportedListing.city} {reportedListing.code} {reportedListing.number}
                          </div>
                          <div className="detail-row">
                            <strong>Price:</strong> AED {reportedListing.price?.toLocaleString()}
                          </div>
                        </>
                      )}
                      {selectedReport.listing_type === 'part' && (
                        <>
                          <div className="detail-row">
                            <strong>Name:</strong> {reportedListing.name || reportedListing.part_name}
                          </div>
                          <div className="detail-row">
                            <strong>Price:</strong> AED {reportedListing.price?.toLocaleString()}
                          </div>
                        </>
                      )}
                      {reportedListing.images && reportedListing.images.length > 0 && (
                        <div className="detail-row">
                          <strong>Images:</strong>
                          <div className="listing-preview-images">
                            {reportedListing.images.slice(0, 3).map((img, idx) => (
                              <img 
                                key={idx}
                                src={getImageUrl(img)} 
                                alt={`Preview ${idx + 1}`}
                                style={{width: '100px', height: '75px', objectFit: 'cover', margin: '5px', borderRadius: '4px'}}
                                onError={(e) => {
                                  e.target.src = "https://via.placeholder.com/100x75?text=No+Image";
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {reportedListing === null && !loadingReportedListing && (
                    <p className="listing-not-found">Listing may have been removed or does not exist.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              {selectedReport.status === 'pending' && (
                <>
                  <button 
                    className="approve-btn"
                    onClick={() => {
                      handleReportAction(selectedReport.id, 'resolved');
                      setShowReportModal(false);
                      setReportedListing(null);
                    }}
                    disabled={isLoading}
                  >
                    Resolve
                  </button>
                  <button 
                    className="reject-btn"
                    onClick={() => {
                      handleReportAction(selectedReport.id, 'dismissed');
                      setShowReportModal(false);
                      setReportedListing(null);
                    }}
                    disabled={isLoading}
                  >
                    Dismiss
                  </button>
                  {reportedListing && (
                    <button 
                      className="delete-btn"
                      onClick={() => {
                        handleRemoveListing(selectedReport.listing_id, selectedReport.listing_type);
                        setShowReportModal(false);
                        setReportedListing(null);
                      }}
                      disabled={isLoading}
                      style={{backgroundColor: '#dc3545', color: 'white'}}
                    >
                      Remove Listing
                    </button>
                  )}
                </>
              )}
              <button className="cancel-btn" onClick={() => {
                setShowReportModal(false);
                setReportedListing(null);
              }}>
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