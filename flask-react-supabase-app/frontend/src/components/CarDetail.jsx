import React, { useState, useEffect } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getAccessToken } from '../utils/supabaseClient';
import LoadingSpinner from './LoadingSpinner';
import ReportButton from './ReportButton';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import './CarDetailRedesigned.css';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
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
  const [car, setCar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const [loanCalculator, setLoanCalculator] = useState({
    carPrice: 0,
    downPayment: 0,
    loanTerm: 5,
    interestRate: 3.5
  });

  const [loanResults, setLoanResults] = useState({
    monthlyPayment: 0,
    loanAmount: 0,
    totalInterest: 0,
    totalCost: 0
  });

  useEffect(() => {
    const fetchCarDetails = async () => {
      setLoading(true);
      setError(null);
      
      try {
        let response;
        try {
          const token = await getAccessToken();
          const headers = token ? { Authorization: `Bearer ${token}` } : {};
          response = await axios.get(`${API_URL}/api/cars/${id}`, { headers });
        } catch (e) {
          console.error('Error fetching car details:', e);
          setError('Failed to load car details. Please try again later.');
          return;
        }
        
        setCar(response.data);
        
        const price = response.data.expected_selling_price || 0;
        setLoanCalculator(prev => ({
          ...prev,
          carPrice: price,
          downPayment: Math.round(price * 0.2)
        }));
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
    const { carPrice, downPayment, loanTerm, interestRate } = loanCalculator;
    const principal = carPrice - downPayment;
    const monthlyRate = interestRate / 100 / 12;
    const numberOfPayments = loanTerm * 12;

    let monthlyPayment = 0;
    if (monthlyRate > 0) {
      monthlyPayment = principal * monthlyRate * Math.pow(1 + monthlyRate, numberOfPayments) /
        (Math.pow(1 + monthlyRate, numberOfPayments) - 1);
    } else {
      monthlyPayment = principal / numberOfPayments;
    }

    const totalInterest = (monthlyPayment * numberOfPayments) - principal;
    const totalCost = principal + totalInterest;

    setLoanResults({
      monthlyPayment: Math.round(monthlyPayment),
      loanAmount: Math.round(principal),
      totalInterest: Math.round(totalInterest),
      totalCost: Math.round(totalCost)
    });
  }, [loanCalculator]);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [id]);

  const handleLoanChange = (field, value) => {
    setLoanCalculator(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const formatPrice = (price) => {
    if (!price) return 'Price on request';
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

  const getMainImageUrl = () => {
    const images = getGalleryImages();
    if (!images.length) return null;
    return images[activeImageIndex] || images[0];
  };

  const getDisplayTitle = () => {
    const composed = [car?.make_year, car?.car_manufacturer, car?.car_model, car?.trim]
      .filter(Boolean)
      .join(' ')
      .trim();
    return composed || car?.listing_title || 'Untitled listing';
  };

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

  const goBack = () => {
    navigate(-1);
  };

  if (loading) {
    return <LoadingSpinner message="Loading car details..." size="large" />;
  }

  if (error) {
    return (
      <div className="cd-error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={goBack} className="cd-back-button">Back to Listings</button>
      </div>
    );
  }

  if (!car) {
    return (
      <div className="cd-error-container">
        <h2>Car Not Found</h2>
        <p>The car listing you're looking for doesn't exist or has been removed.</p>
        <Link to="/cars" className="cd-back-button">Back to Listings</Link>
      </div>
    );
  }

  const galleryImages = getGalleryImages();
  const locationMapConfig = getLocationMapConfig();

  return (
    <div className="cd-container">
      <div className="cd-max-width">
        <nav className="cd-breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/cars">Cars</Link>
          <span>/</span>
          <span>{car?.car_manufacturer || 'Make'}</span>
          <span>/</span>
          <span className="cd-breadcrumb-current">{car?.car_model || 'Model'}</span>
        </nav>

        <div className="cd-title-block">
          <h1 className="cd-title">{getDisplayTitle()}</h1>
          <div className="cd-meta-strip">
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              {car?.car_city || 'UAE'}
            </span>
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              Posted {car?.created_at ? new Date(car.created_at).toLocaleDateString() : 'Recently'}
            </span>
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              Ref: {car?.id?.slice(0, 8) || 'N/A'}
            </span>
          </div>
        </div>

        <div className="cd-hero-grid">
          <div className="cd-hero-left">
            <div className="cd-main-image">
              {getMainImageUrl() ? (
                <img 
                  src={getMainImageUrl()} 
                  alt={getDisplayTitle()}
                  loading="lazy"
                  decoding="async"
                  width="800"
                  height="500"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = PLACEHOLDER_IMAGE;
                  }}
                />
              ) : (
                <div className="cd-image-placeholder">
                  <svg className="cd-car-silhouette" viewBox="0 0 120 50" fill="currentColor">
                    <path d="M10,35 L15,25 L25,25 L30,15 L90,15 L95,25 L105,25 L110,35 L10,35 Z" opacity="0.18"/>
                  </svg>
                  <span className="cd-placeholder-kicker">DPH Classifieds</span>
                  <span className="cd-placeholder-title">{getDisplayTitle()}</span>
                </div>
              )}
              {galleryImages.length > 0 && (
                <div className="cd-photo-count">{galleryImages.length} photos</div>
              )}
            </div>

            {galleryImages.length > 1 && (
              <div className="cd-gallery-strip">
                {galleryImages.map((imgUrl, index) => (
                  <div 
                    key={`${imgUrl}-${index}`}
                    className={`cd-thumbnail ${index === activeImageIndex ? 'cd-thumbnail-active' : ''}`}
                    onClick={() => setActiveImageIndex(index)}
                  >
                    <img src={imgUrl} alt={`Thumbnail ${index + 1}`} />
                  </div>
                ))}
              </div>
            )}

            <div className="cd-card cd-description-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Description</h3>
              </div>
              <div className="cd-description">
                {car?.car_description || 'No description provided.'}
              </div>
            </div>
          </div>

          <aside className="cd-hero-right">
            <div className="cd-price-card">
              <span className="cd-price-label">Listed Price</span>
              <div className="cd-price-value">{formatPrice(car?.expected_selling_price)}</div>
              <div className="cd-price-usd">
                ≈ USD {(car?.expected_selling_price / 3.67).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              
              <div className="cd-badges">
                {car?.regional_spec && (
                  <span className="cd-badge cd-badge-success">GCC Specs</span>
                )}
                {car?.is_insured && (
                  <span className="cd-badge cd-badge-info">Insured</span>
                )}
                {car?.imported && (
                  <span className="cd-badge cd-badge-warning">Imported</span>
                )}
              </div>

              <div className="cd-divider"></div>

              <div className="cd-cta-buttons">
                <a 
                  href={`tel:${car?.country_code || ''}${car?.car_owner_phone_number || car?.contact_phone}`} 
                  className="cd-button cd-button-primary"
                >
                  Call Seller
                </a>
                <a 
                  href={`https://wa.me/${formatWhatsappNumber()}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="cd-button cd-button-secondary"
                >
                  WhatsApp
                </a>
              </div>
            </div>

            <div className="cd-seller-card">
              <div className="cd-seller-avatar">
                {car?.seller_profile_photo ? (
                  <img 
                    src={car.seller_profile_photo} 
                    alt="Seller" 
                    className="seller-avatar-image"
                  />
                ) : (
                  (car?.dealer_name || car?.contact_name || '').charAt(0).toUpperCase()
                )}
              </div>
              <div className="cd-seller-info">
                <div className="cd-seller-name">
                  {car?.dealer_name || car?.contact_name || 'Private Seller'}
                  {car?.dealer_verified && (
                    <span className="cd-verified-badge">✓</span>
                  )}
                </div>
              </div>
              <div className="cd-divider"></div>
              <div className="cd-seller-location">
                <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                {car?.car_city || 'UAE'}
              </div>
            </div>
          </aside>
        </div>

        <div className="cd-content-grid">
          <div className="cd-content-left">
            <div className="cd-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">VIN / Chassis Number</h3>
              </div>
              <div className="cd-vin-block">
                <span className="cd-vin-label">Vehicle Identification Number</span>
                <div className="cd-vin-value">{car?.vin_number || 'Not provided'}</div>
              </div>
            </div>

            <div className="cd-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Car Specifications</h3>
              </div>
              <div className="cd-specs-list">
                {[
                  ['Make', car?.car_manufacturer],
                  ['Model', car?.car_model],
                  ['Year', car?.make_year],
                  ['Trim', car?.trim || 'N/A'],
                  ['Body Type', car?.body_type || 'N/A'],
                  ['Color', car?.color || 'N/A'],
                  ['Mileage', formatKilometers(car?.kilometer_driven)],
                  ['Fuel Type', car?.fuel_type || 'N/A'],
                  ['Transmission', car?.transmission_type || 'N/A'],
                  ['Cylinders', car?.cylinders || 'N/A'],
                  ['Horsepower', car?.horsepower || 'N/A'],
                  ['Doors', car?.doors || 'N/A'],
                  ['Regional Specs', car?.regional_spec || 'N/A'],
                  ['Warranty', car?.warranty || 'N/A'],
                  ['Service History', car?.service_history || 'N/A']
                ].map(([label, value]) => (
                  <div key={label} className="cd-spec-row">
                    <span className="cd-spec-label">{label}</span>
                    <span className="cd-spec-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="cd-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Extras & Features</h3>
              </div>
              {car?.extras && car.extras.length > 0 ? (
                <div className="cd-extras-grid">
                  {car.extras.map((extra, index) => (
                    <div key={index} className="cd-extra-item">
                      <span className="cd-extra-dot"></span>
                      {extra}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cd-empty-state">
                  No extras were listed for this vehicle.
                </div>
              )}
            </div>
          </div>

          <aside className="cd-content-right">
            <div className="cd-card cd-location-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Location</h3>
              </div>
              <div className="cd-location-city">
                <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                <span>{car?.car_city || 'UAE'}</span>
              </div>
              <div className="cd-location-subtitle">
                {locationMapConfig?.approximate 
                  ? 'Approximate city location'
                  : 'Exact seller location'
                }
              </div>
              <div className="cd-map-placeholder">
                <svg className="cd-icon cd-icon-map-pin" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                </svg>
              </div>
            </div>

            <div className="cd-card cd-loan-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Loan Calculator</h3>
              </div>
              <div className="cd-loan-inputs">
                <div className="cd-loan-input">
                  <label className="cd-loan-label">Car price (AED)</label>
                  <input 
                    type="number"
                    className="cd-loan-input-field"
                    value={loanCalculator.carPrice}
                    onChange={(e) => handleLoanChange('carPrice', Number(e.target.value))}
                  />
                </div>
                <div className="cd-loan-input">
                  <label className="cd-loan-label">Down payment (AED)</label>
                  <input 
                    type="number"
                    className="cd-loan-input-field"
                    value={loanCalculator.downPayment}
                    onChange={(e) => handleLoanChange('downPayment', Number(e.target.value))}
                  />
                </div>
                <div className="cd-loan-input">
                  <label className="cd-loan-label">Loan term</label>
                  <SearchableSelect 
                    className="cd-loan-select"
                    value={loanCalculator.loanTerm}
                    onChange={(e) => handleLoanChange('loanTerm', Number(e.target.value))}
                  >
                    <option value={1}>1 year</option>
                    <option value={2}>2 years</option>
                    <option value={3}>3 years</option>
                    <option value={4}>4 years</option>
                    <option value={5}>5 years</option>
                  </SearchableSelect>
                </div>
                <div className="cd-loan-input">
                  <label className="cd-loan-label">Interest rate (%)</label>
                  <input 
                    type="number"
                    step="0.1"
                    className="cd-loan-input-field"
                    value={loanCalculator.interestRate}
                    onChange={(e) => handleLoanChange('interestRate', Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="cd-loan-result">
                <div className="cd-loan-monthly">
                  <span className="cd-loan-result-label">Monthly payment</span>
                  <span className="cd-loan-result-value">
                    {loanResults.monthlyPayment.toLocaleString()} AED
                  </span>
                </div>
                <div className="cd-loan-substats">
                  <div>
                    <span className="cd-loan-substat-label">Loan amount</span>
                    <span>{loanResults.loanAmount.toLocaleString()} AED</span>
                  </div>
                  <div>
                    <span className="cd-loan-substat-label">Total interest</span>
                    <span>{loanResults.totalInterest.toLocaleString()} AED</span>
                  </div>
                  <div>
                    <span className="cd-loan-substat-label">Total cost</span>
                    <span>{loanResults.totalCost.toLocaleString()} AED</span>
                  </div>
                </div>
              </div>
              <div className="cd-loan-disclaimer">
                Indicative only. Actual rates depend on your bank and credit profile.
              </div>
            </div>

            <div className="cd-spacer"></div>
          </aside>
        </div>

        <ReportButton listingId={id} listingType="car" />
      </div>
    </div>
  );
};

export default CarDetail;
