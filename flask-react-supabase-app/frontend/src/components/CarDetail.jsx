import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import LoanCalculator from './LoanCalculator';
import ReportButton from './ReportButton';
import { useAuth } from '../context/AuthContext';
import { formatPhoneNumber } from '../utils/countryCodes';
import './CarDetail.css';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const MAX_DESCRIPTION_WORDS = 300;
const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/1200x800/0b1c12/a2e4a6?text=Image+Not+Available';
const UAE_CITY_COORDINATES = {
  'abu dhabi': [24.4539, 54.3773],
  dubai: [25.2048, 55.2708],
  sharjah: [25.3463, 55.4209],
  ajman: [25.4052, 55.5136],
  'umm al quwain': [25.5647, 55.5552],
  'ras al khaimah': [25.7895, 55.9432],
  fujairah: [25.1288, 56.3265]
};

const CarDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [car, setCar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const canViewVin = Boolean(user);

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

  useEffect(() => {
    setActiveImageIndex(0);
  }, [id]);
  
  // Format price with currency symbol
  const formatPrice = (price) => {
    if (!price) {
      return 'Price on request';
    }

    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      maximumFractionDigits: 0
    }).format(price);
  };

  const formatKilometers = (value) => {
    if (value === null || value === undefined || value === '') {
      return 'Mileage on request';
    }

    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return `${value} km`;
    }

    return `${parsed.toLocaleString()} km`;
  };
  
  // Go back to the listings page
  const goBack = () => {
    navigate(-1);
  };

  const truncateWords = (text, maxWords) => {
    if (!text) return '';
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) {
      return text;
    }
    return `${words.slice(0, maxWords).join(' ')}...`;
  };

  const formatWhatsappNumber = () => {
    const countryCode = (car?.country_code || '+971').replace('+', '');
    const phone = (car?.car_owner_phone_number || car?.contact_phone || '').replace(/\D/g, '').replace(/^0+/, '');
    return `${countryCode}${phone}`;
  };

  const getGalleryImages = () => {
    if (!car?.images?.length) {
      return [];
    }

    return car.images
      .map((image) => image?.image_url || image?.url || null)
      .filter(Boolean)
      .map((imageUrl) => (imageUrl.startsWith('/') ? `${API_URL}${imageUrl}` : imageUrl));
  };

  const getDisplayTitle = () => {
    const composed = [car?.make_year, car?.car_manufacturer, car?.car_model, car?.trim]
      .filter(Boolean)
      .join(' ')
      .trim();

    return composed || car?.listing_title || 'Untitled listing';
  };

  const getSubtitle = () =>
    [car?.body_type, car?.regional_spec, car?.fuel_type].filter(Boolean).join(' • ') || 'Verified marketplace listing';

  const getPrimaryHighlights = () =>
    [
      { label: 'Mileage', value: formatKilometers(car?.kilometer_driven || car?.mileage) },
      { label: 'Transmission', value: car?.transmission_type || 'N/A' },
      { label: 'Location', value: car?.car_city || 'UAE' },
      { label: 'Condition', value: car?.is_insured ? 'Insured' : 'Insurance not listed' }
    ].filter((item) => item.value && item.value !== 'N/A');

  const getSpecEntries = () =>
    [
      ['Manufacturer', car?.car_manufacturer],
      ['Model', car?.car_model],
      ['Year', car?.make_year],
      ['Trim', car?.trim || 'N/A'],
      ['Kilometers', formatKilometers(car?.kilometer_driven)],
      ['Body Type', car?.body_type || 'N/A'],
      ['Regional Spec', car?.regional_spec || 'N/A'],
      ['Fuel Type', car?.fuel_type || 'N/A'],
      ['Transmission', car?.transmission_type || 'N/A'],
      ['Seating Capacity', car?.seating_capacity ? `${car.seating_capacity} seats` : 'N/A'],
      ['Horsepower', car?.horsepower || 'N/A'],
      ['Engine Capacity', car?.engine_capacity || 'N/A'],
      ['Steering Side', car?.steering_side || 'N/A'],
      ['Insured', car?.is_insured ? 'Yes' : 'No']
    ];

  const getLocationMapConfig = () => {
    const lat = Number.parseFloat(car?.latitude);
    const lng = Number.parseFloat(car?.longitude);

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return {
        center: [lat, lng],
        zoom: 13,
        approximate: false
      };
    }

    const normalizedCity = (car?.car_city || '').trim().toLowerCase();
    const fallbackCenter = UAE_CITY_COORDINATES[normalizedCity];

    if (fallbackCenter) {
      return {
        center: fallbackCenter,
        zoom: 10,
        approximate: true
      };
    }

    return null;
  };
  
  const getVinDisplay = () => {
    if (!car?.vin_number) {
      return 'N/A';
    }
    if (canViewVin) {
      return car.vin_number;
    }
    return car.vin_number.replace(/.(?=.{4})/g, '•');
  };
  
  // Change active image
  const changeImage = (index) => {
    setActiveImageIndex(index);
  };
  
  // Get image url for main display
  const getMainImageUrl = () => {
    const images = getGalleryImages();
    if (!images.length) {
      return null;
    }

    return images[activeImageIndex] || images[0];
  };
  
  if (loading) {
    return <LoadingSpinner message="Loading car details..." size="large" />;
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

  const locationMapConfig = getLocationMapConfig();
  
  return (
    <div className="car-detail-container">
      <div className="car-detail-header">
        <button onClick={goBack} className="back-button">
          <span>&#8592;</span> Back to Listings
        </button>
        <ReportButton listingId={id} listingType="car" />
      </div>
      
      <section className="car-detail-hero">
        <div className="car-detail-hero-copy">
          <div className="car-detail-badges">
            <span className="detail-pill">{car.car_city || 'UAE'}</span>
            {car.is_dealer ? <span className="detail-pill detail-pill-accent">Dealer listing</span> : null}
            {car.view_count ? <span className="detail-pill">{car.view_count} views</span> : null}
          </div>
          <h1 className="car-detail-title">{getDisplayTitle()}</h1>
          <p className="car-detail-subtitle">{getSubtitle()}</p>
          <div className="car-highlight-grid">
            {getPrimaryHighlights().map((item) => (
              <div key={item.label} className="car-highlight-card">
                <span className="car-highlight-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="car-hero-price-card">
          <span className="car-hero-price-label">Listed Price</span>
          <strong>{formatPrice(car.expected_selling_price)}</strong>
          <span>{car.car_city || car.car_location || 'Location not specified'}</span>
        </div>
      </section>
      
      <div className="car-detail-content">
        <div className="car-gallery">
          <div className="main-image-card">
            <div className="main-image">
            {getMainImageUrl() ? (
              <img 
                src={getMainImageUrl()} 
                alt={getDisplayTitle()} 
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = PLACEHOLDER_IMAGE;
                }}
              />
            ) : (
              <div className="image-placeholder">
                <span className="image-placeholder-kicker">DPH Classifieds</span>
                <strong>{getDisplayTitle()}</strong>
                <p>Seller has not uploaded photos yet. The listing details are live and ready to review.</p>
              </div>
            )}
            </div>
            <div className="main-image-meta">
              <div>
                <span className="main-image-meta-label">Gallery</span>
                <strong>{getGalleryImages().length > 0 ? `${getGalleryImages().length} photo${getGalleryImages().length > 1 ? 's' : ''}` : 'No uploaded photos yet'}</strong>
              </div>
              <div>
                <span className="main-image-meta-label">Listing</span>
                <strong>{car.listing_title || 'Direct seller post'}</strong>
              </div>
            </div>
          </div>
          
          {getGalleryImages().length > 1 && (
            <div className="thumbnail-row">
              {getGalleryImages().map((imgUrl, index) => {
                return (
                  <div 
                    key={`${imgUrl}-${index}`}
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
          
        </div>
        
        <aside className="car-info">
          <div className="car-price-location">
            <span className="car-panel-kicker">At a glance</span>
            <div className="car-detail-price">{formatPrice(car.expected_selling_price)}</div>
            <div className="car-detail-location">{car.car_city || 'Location not specified'}</div>
            <div className="price-meta-row">
              <span className="detail-pill">{car.make_year || 'Year N/A'}</span>
              <span className="detail-pill">{car.body_type || 'Body type N/A'}</span>
            </div>
          </div>
          
          <div className="car-contact">
            <h3>Contact Seller</h3>
            <div className="contact-buttons">
              <a href={`tel:${car.country_code || ''}${car.car_owner_phone_number || car.contact_phone}`} className="contact-button phone-button">
                {formatPhoneNumber(car.country_code, car.car_owner_phone_number || car.contact_phone)}
              </a>
              <a 
                href={`https://wa.me/${formatWhatsappNumber()}`} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="contact-button whatsapp-button"
              >
                WhatsApp
              </a>
            </div>
          </div>

          <div className="car-description">
            <h3>Description</h3>
            <p>{truncateWords(car.car_description || '', MAX_DESCRIPTION_WORDS) || 'No description provided'}</p>
          </div>
        </aside>
      </div>

      <section className="car-detail-lower-grid">
        <div className="car-specs-section">
          <h3>Car Specifications</h3>
          <div className="car-specs-grid">
            {getSpecEntries().map(([label, value]) => (
              <div key={label} className="spec-item">
                <span className="spec-label">{label}</span>
                <span className="spec-value">{value}</span>
              </div>
            ))}
            {car.vin_number && (
              <div className="spec-item">
                <span className="spec-label">
                  <span
                    className="vin-tooltip"
                    title="VIN (Vehicle Identification Number) is a unique 17-character code that identifies your vehicle. You can find it on your registration, insurance papers, dashboard, door jamb, or under the hood."
                  >
                    VIN
                  </span>
                </span>
                <span className={`spec-value ${canViewVin ? '' : 'masked-vin'}`}>{getVinDisplay()}</span>
              </div>
            )}
          </div>
          {car.vin_number && !canViewVin && (
            <small className="vin-visibility-note">VIN is masked. Sign in to view the full VIN.</small>
          )}
        </div>

        <div className="car-detail-side-grid">
          <div className="car-location">
            <h3>Location</h3>
            <p>{car.car_city || car.car_location || 'Location not specified'}</p>
            {locationMapConfig?.approximate ? (
              <small className="location-note">Approximate city location shown because the seller did not share an exact pin.</small>
            ) : null}
            <div className="map-container">
              {locationMapConfig ? (
                <MapContainer
                  center={locationMapConfig.center}
                  zoom={locationMapConfig.zoom}
                  scrollWheelZoom={false}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap contributors"
                  />
                  <Marker position={locationMapConfig.center} />
                </MapContainer>
              ) : (
                <div className="map-placeholder">Map location unavailable</div>
              )}
            </div>
          </div>

          <div className="loan-calculator">
            <h3>Loan Calculator</h3>
            <LoanCalculator carPrice={car.expected_selling_price} />
          </div>
        </div>

        {car.extras && car.extras.length > 0 ? (
          <div className="car-extras car-extras-wide">
            <h3>Extras & Features</h3>
            <ul className="extras-list">
              {car.extras.map((extra, index) => (
                <li key={index} className="extra-item">
                  <span className="check-icon">✓</span> {extra}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="car-extras car-extras-empty car-extras-wide">
            <h3>Extras & Features</h3>
            <p>No extras were listed for this vehicle.</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default CarDetail; 
