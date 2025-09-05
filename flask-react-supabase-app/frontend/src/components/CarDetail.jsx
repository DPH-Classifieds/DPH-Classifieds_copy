import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import LoanCalculator from './LoanCalculator';
import './CarDetail.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const CarDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [car, setCar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    const fetchCarDetails = async () => {
      setLoading(true);
      setError(null);
      
      try {
        let response;
        try {
          // First try with our real endpoint
          response = await axios.get(`${API_URL}/api/cars/${id}`);
        } catch (e) {
          console.warn('Failed to fetch from main endpoint, generating mock data');
          // Generate mock data for testing
          response = {
            data: {
              id: id,
              listing_title: "2020 Toyota Camry LE",
              car_manufacturer: "Toyota",
              car_model: "Camry",
              make_year: 2020,
              expected_selling_price: 25000,
              car_city: "New York",
              trim: "LE",
              mileage: 35000,
              fuel_type: "Gasoline",
              transmission: "Automatic",
              color: "Silver",
              interior_color: "Black",
              engine: "2.5L 4-Cylinder",
              car_description: "Well-maintained Toyota Camry LE with low mileage. Features include backup camera, Bluetooth connectivity, keyless entry, and power windows/locks. One owner, no accidents.",
              contact_phone: "555-123-4567",
              images: [
                { id: 1, image_url: "https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?q=80&w=2069&auto=format&fit=crop" },
                { id: 2, image_url: "https://images.unsplash.com/photo-1619767886558-efdc259cde1a?q=80&w=2069&auto=format&fit=crop" },
                { id: 3, image_url: "https://images.unsplash.com/photo-1619726578880-4525b80dc7e4?q=80&w=2070&auto=format&fit=crop" }
              ]
            }
          };
        }
        
        setCar(response.data);
      } catch (err) {
        console.error('Error fetching car details:', err);
        setError('Failed to load car details. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchCarDetails();
  }, [id]);
  
  // Format price with currency symbol
  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      maximumFractionDigits: 0
    }).format(price);
  };
  
  // Go back to the listings page
  const goBack = () => {
    navigate(-1);
  };
  
  // Change active image
  const changeImage = (index) => {
    setActiveImageIndex(index);
  };
  
  // Get image url for main display
  const getMainImageUrl = () => {
    if (!car || !car.images || car.images.length === 0) {
      console.log("No images available for car", car?.id);
      return null;
    }
    
    const currentImage = car.images[activeImageIndex];
    console.log("Current image object:", currentImage);
    
    // Try all possible image URL fields
    const imageUrl = currentImage?.image_url || currentImage?.url || car.main_image_url;
    console.log("Using image URL:", imageUrl);
    
    // Check if the URL is a relative URL that needs the API base URL
    if (imageUrl && imageUrl.startsWith('/')) {
      const baseUrl = 'http://localhost:8000'; // This should match your API base URL
      const fullUrl = `${baseUrl}${imageUrl}`;
      console.log("Converted relative URL to absolute:", fullUrl);
      return fullUrl;
    }
    
    return imageUrl;
  };
  
  if (loading) {
    return (
      <div className="loading-spinner detail-spinner">
        <div className="spinner"></div>
        <p>Loading car details...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={goBack} className="back-button">Back to Listings</button>
      </div>
    );
  }
  
  if (!car) {
    return (
      <div className="not-found-container">
        <h2>Car Not Found</h2>
        <p>The car listing you're looking for doesn't exist or has been removed.</p>
        <Link to="/" className="back-button">Back to Listings</Link>
      </div>
    );
  }
  
  return (
    <div className="car-detail-container">
      <button onClick={goBack} className="back-button">
        <span>&#8592;</span> Back to Listings
      </button>
      
      <h1 className="car-detail-title">{car.listing_title}</h1>
      
      <div className="car-detail-content">
        <div className="car-gallery">
          <div className="main-image">
            {getMainImageUrl() ? (
              <img 
                src={getMainImageUrl()} 
                alt={car.listing_title} 
                onError={(e) => {
                  console.error("Image failed to load:", e.target.src);
                  e.target.onerror = null;
                  e.target.src = "https://via.placeholder.com/800x600?text=Image+Not+Available";
                }}
              />
            ) : (
              <div className="image-placeholder">No Image Available</div>
            )}
          </div>
          
          {car.images && car.images.length > 1 && (
            <div className="thumbnail-row">
              {car.images.map((image, index) => {
                // Process image URL the same way as main image
                let imgUrl = image.image_url || image.url;
                if (imgUrl && imgUrl.startsWith('/')) {
                  imgUrl = `http://localhost:8000${imgUrl}`;
                }
                
                return (
                  <div 
                    key={image.id || index} 
                    className={`thumbnail ${index === activeImageIndex ? 'active' : ''}`}
                    onClick={() => changeImage(index)}
                  >
                    <img src={imgUrl} alt={`Thumbnail ${index + 1}`} />
                  </div>
                );
              })}
            </div>
          )}
          
          {car.tour_url && (
            <div className="virtual-tour">
              <h3>360° Virtual Tour</h3>
              <a href={car.tour_url} target="_blank" rel="noopener noreferrer" className="tour-button">
                View 360° Tour
              </a>
            </div>
          )}
          
          <div className="car-description">
            <h3>Description</h3>
            <p>{car.car_description || 'No description provided'}</p>
          </div>
          
          <div className="loan-calculator">
            <h3>Loan Calculator</h3>
            <LoanCalculator carPrice={car.expected_selling_price} />
          </div>
        </div>
        
        <div className="car-info">
          <div className="car-price-location">
            <div className="car-detail-price">{formatPrice(car.expected_selling_price)}</div>
            <div className="car-detail-location">{car.car_city || 'Location not specified'}</div>
          </div>
          
          <div className="car-contact">
            <h3>Contact Seller</h3>
            <a href={`tel:${car.car_owner_phone_number}`} className="contact-button">
              <i className="phone-icon"></i> {car.car_owner_phone_number || 'Contact information not available'}
            </a>
          </div>
          
          <div className="car-specs-section">
            <h3>Car Specifications</h3>
            <div className="car-specs-grid">
              <div className="spec-item">
                <span className="spec-label">Manufacturer</span>
                <span className="spec-value">{car.car_manufacturer}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Model</span>
                <span className="spec-value">{car.car_model}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Year</span>
                <span className="spec-value">{car.make_year}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Trim</span>
                <span className="spec-value">{car.trim || 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Kilometers</span>
                <span className="spec-value">
                  {car.kilometer_driven ? `${car.kilometer_driven.toLocaleString()} km` : 'N/A'}
                </span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Body Type</span>
                <span className="spec-value">{car.body_type || 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Regional Spec</span>
                <span className="spec-value">{car.regional_spec || 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Fuel Type</span>
                <span className="spec-value">{car.fuel_type || 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Transmission</span>
                <span className="spec-value">{car.transmission_type || 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Seating Capacity</span>
                <span className="spec-value">{car.seating_capacity ? `${car.seating_capacity} seats` : 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Horsepower</span>
                <span className="spec-value">{car.horsepower || 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Engine Capacity</span>
                <span className="spec-value">{car.engine_capacity || 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Steering Side</span>
                <span className="spec-value">{car.steering_side || 'N/A'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Insured</span>
                <span className="spec-value">{car.is_insured ? 'Yes' : 'No'}</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">VIN</span>
                <span className="spec-value">{car.vin_number || 'N/A'}</span>
              </div>
            </div>
          </div>
          
          {car.extras && car.extras.length > 0 && (
            <div className="car-extras">
              <h3>Extras/Features</h3>
              <ul className="extras-list">
                {car.extras.map((extra, index) => (
                  <li key={index} className="extra-item">
                    <span className="check-icon">✓</span> {extra}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {car.car_location && (
            <div className="car-location">
              <h3>Location</h3>
              <p>{car.car_location}</p>
              <div className="map-container">
                {/* Map would be displayed here if implemented */}
                <div className="map-placeholder">Map location unavailable</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CarDetail; 