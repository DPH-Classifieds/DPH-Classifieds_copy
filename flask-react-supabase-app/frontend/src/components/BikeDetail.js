import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReportButton from './ReportButton';
import LoadingSpinner from './LoadingSpinner';
import '../styles/DetailView.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const BikeDetail = () => {
  const { id } = useParams();
  const [bike, setBike] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Function to track view count
  const trackView = async (bikeId) => {
    try {
      await fetch(`${API_URL}/api/bikes/${bikeId}/view`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } catch (error) {
      console.warn('Failed to track view:', error);
      // Don't show error to user, just log it
    }
  };

  useEffect(() => {
    const fetchBikeDetails = async () => {
      try {
        setLoading(true);
        console.log(`Fetching bike details for ID: ${id}`);
        
        // Use direct fetch for public access (no authentication required)
        const response = await fetch(`${API_URL}/api/bikes/${id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          const message = response.status === 404
            ? 'Bike not found.'
            : `Failed to fetch bike details: ${response.status} ${response.statusText}`;
          throw new Error(message);
        }
        
        const bikeData = await response.json();
        console.log('Bike details response:', bikeData);
        setBike(bikeData);
        setError(null);
        
        // Track the view after successfully fetching bike details
        await trackView(id);
      } catch (err) {
        console.error('Error fetching bike details:', err);
        setError(`Failed to load bike details: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchBikeDetails();
    }
  }, [id]);

  // Helper function to get proper image URL
  const getImageUrl = (image) => {
    if (!image) return null;
    
    // Try all possible image URL fields
    const imageUrl = image.image_url || image.url;
    console.log("Processing image URL:", imageUrl);
    
    // Check if the URL is a relative URL that needs the API base URL
    if (imageUrl && imageUrl.startsWith('/')) {
      const fullUrl = `${API_URL}${imageUrl}`;
      console.log("Converted relative URL to absolute:", fullUrl);
      return fullUrl;
    }
    
    return imageUrl;
  };

  if (loading) {
    return (
      <LoadingSpinner message="Loading bike details..." size="large" />
    );
  }

  if (error) {
    return (
      <div className="detail-container error">
        <h2>Error</h2>
        <p className="error-message">{error}</p>
        <div className="error-actions">
          <Link to="/bikes" className="btn-back">Back to Bikes</Link>
          <button onClick={() => window.location.reload()} className="btn-retry">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!bike) {
    return (
      <div className="detail-container not-found">
        <h2>Bike Not Found</h2>
        <p>The bike you're looking for doesn't exist or may have been removed.</p>
        <Link to="/bikes" className="btn-back">Back to Bikes</Link>
      </div>
    );
  }

  return (
    <div className="detail-container">
      <div className="detail-header">
        <div className="detail-header-left">
          <Link to="/bikes" className="btn-back">← Back to Bikes</Link>
          <h1>{bike.make || bike.bike_brand} {bike.model || bike.bike_model} {bike.year || bike.make_year}</h1>
        </div>
        <ReportButton listingId={id} listingType="bike" />
      </div>

      <div className="detail-main">
        <div className="detail-images">
          {/* Main image */}
          <div className="main-image">
            {bike.images && bike.images.length > 0 ? (
              <img 
                src={getImageUrl(bike.images[0])} 
                alt={`${bike.make || bike.bike_brand || ''} ${bike.model || bike.bike_model || ''}`.trim()}
                onError={(e) => {
                  console.error("Image failed to load:", e.target.src);
                  e.target.onerror = null;
                  e.target.src = "https://via.placeholder.com/800x600?text=Image+Not+Available";
                }}
              />
            ) : (
              <div className="no-image">No Image Available</div>
            )}
          </div>
          
          {/* Additional images */}
          {bike.images && bike.images.length > 1 && (
            <div className="additional-images">
              <h3>Additional Images</h3>
              <div className="image-gallery">
                {bike.images.slice(1).map((image, index) => (
                  <div key={index} className="gallery-image">
                    <img 
                      src={getImageUrl(image)} 
                      alt={`${bike.make || bike.bike_brand || ''} ${bike.model || bike.bike_model || ''} - view ${index + 1}`.trim()}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = "https://via.placeholder.com/400x300?text=Image+Not+Available";
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="detail-info">
          <div className="info-panel">
            <h2>Bike Details</h2>
            
            <div className="info-group">
              <div className="info-item">
                <span className="info-label">Make:</span>
                <span className="info-value">{bike.make || bike.bike_brand || 'N/A'}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Model:</span>
                <span className="info-value">{bike.model || bike.bike_model || 'N/A'}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Year:</span>
                <span className="info-value">{bike.year || bike.make_year || 'N/A'}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Type:</span>
                <span className="info-value">{bike.bike_type || bike.bike_category || 'N/A'}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Engine Size:</span>
                <span className="info-value">{bike.engine_size || bike.engine_capacity || 'N/A'}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Mileage:</span>
                <span className="info-value">{Number(bike.mileage || 0).toLocaleString()} km</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Color:</span>
                <span className="info-value">{bike.color}</span>
              </div>
              
                              <div className="info-item">
                  <span className="info-label">
                    <span 
                      className="vin-tooltip"
                      title="VIN (Vehicle Identification Number) is a unique 17-character code that identifies this bike. You can find it on the vehicle registration document, insurance papers, on the frame neck (under handlebars), on the frame near the engine, or on the engine casing."
                      style={{ 
                        cursor: 'help',
                        borderBottom: '1px dotted #333',
                        color: '#000'
                      }}
                    >
                      VIN:
                    </span>
                  </span>
                  <span className="info-value">{bike.vin_number || 'N/A'}</span>
                </div>
              
              <div className="info-item">
                <span className="info-label">Location:</span>
                <span className="info-value">{bike.location || 'N/A'}</span>
              </div>
              
              <div className="info-item full-width">
                <span className="info-label">Price:</span>
                <span className="info-value price">AED {Number(bike.price || 0).toLocaleString()}</span>
              </div>
              
              {bike.is_dealer && (
                <div className="info-item">
                  <span className="dealer-badge">
                    <span className="badge">Dealer</span>
                  </span>
                </div>
              )}
              
              {bike.view_count !== undefined && bike.view_count !== null && (
                <div className="info-item">
                  <span className="view-counter">
                    <span className="views">{bike.view_count || 0} views</span>
                  </span>
                </div>
              )}
            </div>
            
            {bike.features && bike.features.length > 0 && (
              <div className="features-section">
                <h3>Features</h3>
                <ul className="features-list">
                  {bike.features.map((feature, index) => (
                    <li key={index}>{feature}</li>
                  ))}
                </ul>
              </div>
            )}
            
            {bike.description && (
              <div className="description-section">
                <h3>Description</h3>
                <p>{bike.description}</p>
              </div>
            )}
            
            <div className="contact-section">
              <h3>Contact Information</h3>
              <div className="info-group">
                <div className="info-item">
                  <span className="info-label">Name:</span>
                  <span className="info-value">{bike.contact_name}</span>
                </div>
                
                <div className="info-item">
                  <span className="info-label">Phone:</span>
                  <span className="info-value">{bike.contact_phone}</span>
                </div>
                
                {bike.user_email && (
                  <div className="info-item">
                    <span className="info-label">Email:</span>
                    <span className="info-value">{bike.user_email}</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="listing-meta">
              <span>Listed on: {new Date(bike.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          
          <div className="action-panel">
            <a 
              href={`tel:${bike.contact_phone}`} 
              className="action-btn call-btn"
            >
              Call Seller
            </a>
            
            <button className="action-btn chat-btn">
              Message Seller
            </button>
            
            <button className="action-btn save-btn">
              Save Listing
            </button>
            
            <button className="action-btn share-btn">
              Share Listing
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BikeDetail; 
