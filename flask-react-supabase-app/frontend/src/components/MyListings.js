import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/supabaseClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/MyListings.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Helper function to get proper image URL
const getImageUrl = (image) => {
  if (!image) return null;
  
  // Try all possible image URL fields
  const imageUrl = image.image_url || image.url || image;
  
  // Check if the URL is a relative URL that needs the API base URL
  if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('/')) {
    return `${API_URL}${imageUrl}`;
  }
  
  return imageUrl;
};

const MyListings = () => {
  const { user } = useAuth();
  const [carListings, setCarListings] = useState([]);
  const [plateListings, setPlateListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      fetchUserListings();
    }
  }, [user]);

  const fetchUserListings = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const token = await getAccessToken();
      
      if (!token) {
        throw new Error('Authentication token not found');
      }
      
      // Fetch car listings
      const carResponse = await fetch(`${API_URL}/api/user/cars`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!carResponse.ok) {
        throw new Error('Failed to fetch car listings');
      }
      
      const carData = await carResponse.json();
      setCarListings(carData);
      
      // Fetch plate listings
      try {
        const plateResponse = await fetch(`${API_URL}/api/user/plates`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (plateResponse.ok) {
          const plateData = await plateResponse.json();
          setPlateListings(plateData);
        } else {
          console.warn('Could not fetch plate listings:', plateResponse.statusText);
          setPlateListings([]);
        }
      } catch (plateErr) {
        console.error('Error fetching plate listings:', plateErr);
        setPlateListings([]);
      }
    } catch (err) {
      console.error('Error fetching user listings:', err);
      setError('Could not load your listings. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCarListing = async (id) => {
    if (window.confirm('Are you sure you want to delete this car listing? This action cannot be undone.')) {
      try {
        const token = await getAccessToken();
        
        if (!token) {
          throw new Error('Authentication token not found');
        }
        
        const response = await fetch(`${API_URL}/api/cars/${id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to delete car listing');
        }
        
        // Remove the deleted listing from state
        setCarListings(carListings.filter(listing => listing.id !== id));
      } catch (err) {
        console.error('Error deleting car listing:', err);
        setError('Failed to delete listing. Please try again.');
      }
    }
  };
  
  const handleDeletePlateListing = async (id) => {
    if (window.confirm('Are you sure you want to delete this plate listing? This action cannot be undone.')) {
      try {
        const token = await getAccessToken();
        
        if (!token) {
          throw new Error('Authentication token not found');
        }
        
        const response = await fetch(`${API_URL}/api/plates/${id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to delete plate listing');
        }
        
        // Remove the deleted listing from state
        setPlateListings(plateListings.filter(listing => listing.id !== id));
      } catch (err) {
        console.error('Error deleting plate listing:', err);
        setError('Failed to delete listing. Please try again.');
      }
    }
  };

  if (loading) {
    return (
      <LoadingSpinner message="Loading your listings..." size="large" />
    );
  }
  
  const allListingsEmpty = carListings.length === 0 && plateListings.length === 0;

  return (
    <div className="my-listings-container">
      <div className="my-listings-header">
        <h1 className="section-title">My Listings</h1>
        <div className="action-buttons">
          <Link to="/create-listing" className="btn btn-primary">
            Post New Car
          </Link>
          <Link to="/post-plate" className="btn btn-primary">
            Post License Plate
          </Link>
        </div>
      </div>
      
      {error && <div className="alert alert-danger">{error}</div>}
      
      {allListingsEmpty ? (
        <div className="empty-state">
          <h3>No Listings Yet</h3>
          <p>You haven't posted any listings yet.</p>
          <div className="empty-state-actions">
            <Link to="/create-listing" className="btn btn-primary">
              Post a Car
            </Link>
            <Link to="/post-plate" className="btn btn-primary">
              Post a License Plate
            </Link>
          </div>
        </div>
      ) : (
        <>
          {carListings.length > 0 && (
            <div className="listing-section">
              <h2>My Car Listings</h2>
              <div className="my-listings-grid">
                {carListings.map(listing => (
                  <div key={listing.id} className="my-listing-card">
                    <div className="my-listing-image">
                      {listing.images && listing.images.length > 0 ? (
                        <img 
                          src={getImageUrl(listing.images[0])} 
                          alt={listing.listing_title || 'Car'}
                          onError={(e) => {
                            console.error("Image failed to load:", e.target.src);
                            e.target.onerror = null;
                            e.target.src = "https://via.placeholder.com/400x300?text=No+Image+Available";
                          }}
                        />
                      ) : (
                        <div className="no-image">No Image</div>
                      )}
                    </div>
                    
                    <div className="my-listing-details">
                      <h3>{listing.listing_title || `${listing.make_year} ${listing.car_manufacturer} ${listing.car_model}`}</h3>
                      <p className="my-listing-price">AED {listing.expected_selling_price?.toLocaleString()}</p>
                      <p className="my-listing-date">
                        Posted on {new Date(listing.created_at).toLocaleDateString()}
                      </p>
                      {listing.view_count !== undefined && listing.view_count !== null && (
                        <p className="my-listing-views">
                          {listing.view_count} view{listing.view_count !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    
                    <div className="my-listing-actions">
                      <button 
                        onClick={() => navigate(`/cars/${listing.id}`)} 
                        className="btn btn-secondary"
                        aria-label="View listing"
                      >
                        View
                      </button>
                      <button 
                        onClick={() => navigate(`/edit-listing/${listing.id}`)} 
                        className="btn btn-secondary"
                        aria-label="Edit listing"
                      >
                        Edit
                      </button>
                      <button 
                        onClick={() => handleDeleteCarListing(listing.id)} 
                        className="btn btn-danger"
                        aria-label="Delete listing"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {plateListings.length > 0 && (
            <div className="listing-section">
              <h2>My License Plate Listings</h2>
              <div className="my-listings-grid">
                {plateListings.map(plate => (
                  <div key={plate.id} className="my-listing-card">
                    <div className="my-listing-image">
                      {plate.images && plate.images.length > 0 ? (
                        <img 
                          src={getImageUrl(plate.images.find(img => img.is_primary) || plate.images[0])} 
                          alt={`${plate.city} ${plate.code} ${plate.number}`}
                          onError={(e) => {
                            console.error("Image failed to load:", e.target.src);
                            e.target.onerror = null;
                            e.target.src = "https://via.placeholder.com/400x300?text=No+Image+Available";
                          }}
                        />
                      ) : (
                        <div className="no-image">No Image</div>
                      )}
                    </div>
                    
                    <div className="my-listing-details">
                      <h3>{plate.city} License Plate</h3>
                      <p className="listing-code-number">{plate.code} {plate.number}</p>
                      <p className="my-listing-price">AED {plate.price?.toLocaleString()}</p>
                      <p className="my-listing-date">
                        Posted on {new Date(plate.created_at).toLocaleDateString()}
                      </p>
                      {plate.view_count !== undefined && plate.view_count !== null && (
                        <p className="my-listing-views">
                          {plate.view_count} view{plate.view_count !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    
                    <div className="my-listing-actions">
                      <button 
                        onClick={() => navigate(`/plates/${plate.id}`)} 
                        className="btn btn-secondary"
                        aria-label="View plate"
                      >
                        View
                      </button>
                      <button 
                        onClick={() => navigate(`/edit-plate/${plate.id}`)} 
                        className="btn btn-secondary"
                        aria-label="Edit plate"
                      >
                        Edit
                      </button>
                      <button 
                        onClick={() => handleDeletePlateListing(plate.id)} 
                        className="btn btn-danger"
                        aria-label="Delete plate"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MyListings; 
