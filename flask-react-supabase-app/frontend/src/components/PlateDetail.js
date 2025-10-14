import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/DetailView.css';
import '../styles/UAELicensePlate.css';
import UAELicensePlate from './UAELicensePlate';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const PlateDetail = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const [plate, setPlate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Function to track view count
  const trackView = async (plateId) => {
    try {
      await fetch(`${API_URL}/api/plates/${plateId}/view`, {
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
    const fetchPlateDetails = async () => {
      try {
        setLoading(true);
        console.log(`Fetching plate details for ID: ${id}`);
        
        // Use direct fetch for public access (no authentication required)
        const response = await fetch(`${API_URL}/api/plates/${id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch plate details: ${response.status} ${response.statusText}`);
        }
        
        const plateData = await response.json();
        console.log('Plate details response:', plateData);
        setPlate(plateData);
        setError(null);
        
        // Track the view after successfully fetching plate details
        await trackView(id);
      } catch (err) {
        console.error('Error fetching plate details:', err);
        setError(`Failed to load plate details: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchPlateDetails();
    }
  }, [id]);

  // For the plate preview rendering
  const getPlateLayout = (city) => {
    if (!city) return 'center';
    
    const cityLower = city.toLowerCase();
    if (cityLower === 'abu dhabi' || cityLower === 'fujairah' || cityLower === 'sharjah' || cityLower === 'umm al quwain') {
      return 'right';
    } else if (cityLower === 'ras al khaimah') {
      return 'left';
    } else {
      return 'center';
    }
  };

  const getLogoPath = (city) => {
    if (!city) return '/images/plates/dubai.png';
    
    const cityLower = city.toLowerCase();
    if (cityLower === 'abu dhabi') {
      return `/images/plates/abudhabi.png`;
    } else if (cityLower === 'ras al khaimah') {
      return `/images/plates/ras-al-khaimah.png`;
    } else if (cityLower === 'umm al quwain') {
      return `/images/plates/umm-al-quwain.png`;
    } else if (cityLower === 'fujairah') {
      return `/images/plates/Fujairah.png`;
    } else {
      return `/images/plates/${cityLower}.png`;
    }
  };

  if (loading) {
    return (
      <div className="detail-container loading">
        <div className="loading-spinner"></div>
        <p>Loading plate details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="detail-container error">
        <h2>Error</h2>
        <p className="error-message">{error}</p>
        <div className="error-actions">
          <Link to="/plates" className="btn-back">Back to Plates</Link>
          <button onClick={() => window.location.reload()} className="btn-retry">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!plate) {
    return (
      <div className="detail-container not-found">
        <h2>License Plate Not Found</h2>
        <p>The license plate you're looking for doesn't exist or may have been removed.</p>
        <Link to="/plates" className="btn-back">Back to Plates</Link>
      </div>
    );
  }

  return (
    <div className="detail-container">
      <div className="detail-header">
        <Link to="/plates" className="btn-back">← Back to Plates</Link>
        <h1>{plate.city} License Plate {plate.code} {plate.number}</h1>
      </div>

      <div className="detail-main">
        <div className="detail-images">
          {/* Replace the old plate preview with our new component */}
          <div className="plate-preview">
            <UAELicensePlate
              city={plate.city}
              code={plate.code}
              number={plate.number}
              className={plate.status === 'sold' ? 'sold' : ''}
            />
          </div>
          
          {/* Show any additional images if available */}
          {plate.images && plate.images.length > 0 && (
            <div className="additional-images">
              <h3>Additional Images</h3>
              <div className="image-gallery">
                {plate.images.map((image, index) => (
                  <div key={index} className="gallery-image">
                    <img 
                      src={`${API_URL}${image.url}`} 
                      alt={`Plate image ${index + 1}`} 
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="detail-info">
          <div className="info-panel">
            <h2>License Plate Details</h2>
            
            <div className="info-group">
              <div className="info-item">
                <span className="info-label">City:</span>
                <span className="info-value">{plate.city}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Code:</span>
                <span className="info-value">{plate.code}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Number:</span>
                <span className="info-value">{plate.number}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Format:</span>
                <span className="info-value">{plate.plate_format}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Number of Digits:</span>
                <span className="info-value">{plate.digits}</span>
              </div>
              
              <div className="info-item full-width">
                <span className="info-label">Price:</span>
                <span className="info-value price">AED {plate.price?.toLocaleString()}</span>
              </div>
              
              {plate.is_dealer && (
                <div className="info-item">
                  <span className="dealer-badge">
                    <span className="badge">Dealer</span>
                  </span>
                </div>
              )}
              
              {user && user.id === plate.user_id && (
                <div className="info-item">
                  <span className="view-counter">
                    <span className="views">👁️ {plate.view_count || 0} views</span>
                  </span>
                </div>
              )}
            </div>
            
            {plate.description && (
              <div className="description-section">
                <h3>Description</h3>
                <p>{plate.description}</p>
              </div>
            )}
            
            <div className="contact-section">
              <h3>Contact Information</h3>
              <div className="info-group">
                <div className="info-item">
                  <span className="info-label">Name:</span>
                  <span className="info-value">{plate.contact_name}</span>
                </div>
                
                <div className="info-item">
                  <span className="info-label">Phone:</span>
                  <span className="info-value">{plate.contact_phone}</span>
                </div>
                
                {plate.user_email && (
                  <div className="info-item">
                    <span className="info-label">Email:</span>
                    <span className="info-value">{plate.user_email}</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="listing-meta">
              <span>Listed on: {new Date(plate.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          
          <div className="action-panel">
            <a 
              href={`tel:${plate.contact_phone}`} 
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

export default PlateDetail; 