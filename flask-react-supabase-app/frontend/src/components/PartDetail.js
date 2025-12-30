import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReportButton from './ReportButton';
import LoadingSpinner from './LoadingSpinner';
import '../styles/DetailView.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const PartDetail = () => {
  const { id } = useParams();
  const [part, setPart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchPartDetails = async () => {
      try {
        setLoading(true);
        console.log(`Fetching part details for ID: ${id}`);
        
        // Use direct fetch for public access (no authentication required)
        const response = await fetch(`${API_URL}/api/parts/${id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          const message = response.status === 404
            ? 'Car part not found.'
            : `Failed to fetch part details: ${response.status} ${response.statusText}`;
          throw new Error(message);
        }
        
        const partData = await response.json();
        console.log('Part details response:', partData);
        setPart(partData);
        setError(null);
      } catch (err) {
        console.error('Error fetching part details:', err);
        setError(`Failed to load part details: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchPartDetails();
    }
  }, [id]);

  if (loading) {
    return (
      <LoadingSpinner message="Loading part details..." size="large" />
    );
  }

  if (error) {
    return (
      <div className="detail-container error">
        <h2>Error</h2>
        <p className="error-message">{error}</p>
        <div className="error-actions">
          <Link to="/car-parts" className="btn-back">Back to Car Parts</Link>
          <button onClick={() => window.location.reload()} className="btn-retry">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!part) {
    return (
      <div className="detail-container not-found">
        <h2>Car Part Not Found</h2>
        <p>The car part you're looking for doesn't exist or may have been removed.</p>
        <Link to="/car-parts" className="btn-back">Back to Car Parts</Link>
      </div>
    );
  }

  return (
    <div className="detail-container">
      <div className="detail-header">
        <div className="detail-header-left">
          <Link to="/car-parts" className="btn-back">← Back to Car Parts</Link>
          <h1>{part.name || part.part_name}</h1>
        </div>
        <ReportButton listingId={id} listingType="part" />
      </div>

      <div className="detail-main">
        <div className="detail-images">
          {/* Main image */}
          <div className="main-image">
            {part.images && part.images.length > 0 ? (
              <img 
                src={part.images[0].image_url || part.images[0].url || `${API_URL}${part.images[0].url}`} 
                alt={part.name || part.part_name} 
              />
            ) : (
              <div className="no-image">No Image Available</div>
            )}
          </div>
          
          {/* Additional images */}
          {part.images && part.images.length > 1 && (
            <div className="additional-images">
              <h3>Additional Images</h3>
              <div className="image-gallery">
                {part.images.slice(1).map((image, index) => (
                  <div key={index} className="gallery-image">
                    <img 
                      src={image.image_url || image.url || `${API_URL}${image.url}`} 
                      alt={`Part ${index + 1}`} 
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="detail-info">
          <div className="info-panel">
            <h2>Part Details</h2>
            
            <div className="info-group">
              <div className="info-item">
                <span className="info-label">Name:</span>
                <span className="info-value">{part.name || part.part_name}</span>
              </div>
              
              <div className="info-item">
                <span className="info-label">Category:</span>
                <span className="info-value">{part.category || part.part_type}</span>
              </div>
              
              {part.brand && (
                <div className="info-item">
                  <span className="info-label">Brand:</span>
                  <span className="info-value">{part.brand}</span>
                </div>
              )}
              
              <div className="info-item">
                <span className="info-label">Condition:</span>
                <span className="info-value">{part.condition || 'Used'}</span>
              </div>
              
              {part.warranty && (
                <div className="info-item">
                  <span className="info-label">Warranty:</span>
                  <span className="info-value">{part.warranty}</span>
                </div>
              )}
              
              {part.location && (
                <div className="info-item">
                  <span className="info-label">Location:</span>
                  <span className="info-value">{part.location}</span>
                </div>
              )}
              
              <div className="info-item full-width">
                <span className="info-label">Price:</span>
                <span className="info-value price">AED {part.price?.toLocaleString()}</span>
                {part.is_negotiable && <span className="negotiable-tag">(Negotiable)</span>}
              </div>
            </div>
            
            {(part.compatibility || (part.compatible_makes && part.compatible_makes.length > 0)) && (
              <div className="compatibility-section">
                <h3>Compatibility</h3>
                {part.compatibility ? (
                  <div className="compatible-info">
                    <span className="info-label">Compatible with:</span>
                    <span className="info-value">{part.compatibility}</span>
                  </div>
                ) : (
                  <>
                    <div className="compatible-makes">
                      <span className="info-label">Makes:</span>
                      <span className="info-value">{part.compatible_makes.join(', ')}</span>
                    </div>
                    
                    {part.compatible_models && part.compatible_models.length > 0 && (
                      <div className="compatible-models">
                        <span className="info-label">Models:</span>
                        <span className="info-value">{part.compatible_models.join(', ')}</span>
                      </div>
                    )}
                    
                    {part.compatible_years && (
                      <div className="compatible-years">
                        <span className="info-label">Years:</span>
                        <span className="info-value">{part.compatible_years}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            
            {part.description && (
              <div className="description-section">
                <h3>Description</h3>
                <p>{part.description}</p>
              </div>
            )}
            
            <div className="contact-section">
              <h3>Contact Information</h3>
              <div className="info-group">
                {part.contact_name && (
                  <div className="info-item">
                    <span className="info-label">Name:</span>
                    <span className="info-value">{part.contact_name}</span>
                  </div>
                )}
                
                <div className="info-item">
                  <span className="info-label">Phone:</span>
                  <span className="info-value">{part.contact_number}</span>
                </div>
                
                {part.user_email && (
                  <div className="info-item">
                    <span className="info-label">Email:</span>
                    <span className="info-value">{part.user_email}</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="listing-meta">
              <span>Listed on: {new Date(part.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          
          <div className="action-panel">
            <a 
              href={`tel:${part.contact_number}`} 
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

export default PartDetail; 
