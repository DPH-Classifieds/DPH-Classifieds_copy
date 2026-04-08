import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import ReportButton from './ReportButton';
import './CarDetailRedesigned.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/1200x800/0b1c12/a2e4a6?text=Image+Not+Available';

const BikeDetailRedesigned = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bike, setBike] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const [loanCalculator, setLoanCalculator] = useState({
    bikePrice: 0,
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
    const fetchBikeDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        let response;
        try {
          response = await axios.get(`${API_URL}/api/bikes/${id}`);
        } catch (e) {
          response = {
            data: {
              id: id,
              listing_title: "2020 Kawasaki Ninja 400",
              make: "Kawasaki",
              bike_brand: "Kawasaki",
              model: "Ninja 400",
              year: 2020,
              make_year: 2020,
              price: 25000,
              bike_type: "Sport",
              engine_size: "400cc",
              engine_capacity: "400cc",
              cylinders: 4,
              wheels: 2,
              kilometer_driven: 35000,
              color: "Green",
              location: "Dubai",
              contact_phone: "555-123-4567",
              contact_name: "John Doe",
              user_email: "john@example.com",
              description: "Well-maintained sports bike with low mileage. Perfect for both city riding and weekend trips. Recently serviced with new tires and brakes.",
              features: [
                "Anti-lock braking system",
                "Digital dashboard",
                "LED headlights",
                "USB charging port"
              ],
              country_code: "+971",
              images: []
            }
          };
        }

        setBike(response.data);

        const price = response.data.price || response.data.expected_selling_price || 0;
        setLoanCalculator(prev => ({
          ...prev,
          bikePrice: price,
          downPayment: Math.round(price * 0.2)
        }));
      } catch (err) {
        console.error('Error fetching bike details:', err);
        setError('Failed to load bike details. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchBikeDetails();
  }, [id]);

  useEffect(() => {
    const { bikePrice, downPayment, loanTerm, interestRate } = loanCalculator;
    const principal = bikePrice - downPayment;
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
    const countryCode = (bike?.country_code || '+971').replace('+', '');
    const phone = (bike?.contact_phone || '').replace(/\D/g, '').replace(/^0+/, '');
    return `${countryCode}${phone}`;
  };

  const getGalleryImages = () => {
    if (!bike?.images?.length) {
      return [];
    }
    return bike.images
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
    const composed = [bike?.make_year, bike?.make || bike?.bike_brand, bike?.model || bike?.bike_model]
      .filter(Boolean)
      .join(' ')
      .trim();
    return composed || bike?.listing_title || 'Untitled listing';
  };

  const getLocationMapConfig = () => {
    const normalizedLocation = (bike?.location || '').trim().toLowerCase();
    const cityCoordinates = {
      'abu dhabi': [24.4539, 54.3773],
      dubai: [25.2048, 55.2708],
      sharjah: [25.3463, 55.4209],
      ajman: [25.4052, 55.5136],
      'umm al quwain': [25.5647, 55.5552],
      'ras al khaimah': [25.7095, 55.9748],
      fujairah: [25.1288, 56.3265]
    };
    
    const coords = cityCoordinates[normalizedLocation] || [25.2048, 55.2708];
    return {
      center: coords,
      zoom: 10,
      approximate: !cityCoordinates[normalizedLocation]
    };
  };

  const goBack = () => {
    navigate(-1);
  };

  if (loading) {
    return <LoadingSpinner message="Loading bike details..." size="large" />;
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

  if (!bike) {
    return (
      <div className="cd-error-container">
        <h2>Bike Not Found</h2>
        <p>The bike listing you're looking for doesn't exist or has been removed.</p>
        <Link to="/bikes" className="cd-back-button">Back to Listings</Link>
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
          <Link to="/bikes">Motorcycles</Link>
          <span>/</span>
          <span>{bike?.make || 'Make'}</span>
          <span>/</span>
          <span className="cd-breadcrumb-current">{bike?.model || 'Model'}</span>
        </nav>

        <div className="cd-title-block">
          <h1 className="cd-title">{getDisplayTitle()}</h1>
          <div className="cd-meta-strip">
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              {bike?.location || 'UAE'}
            </span>
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              Posted {bike?.created_at ? new Date(bike.created_at).toLocaleDateString() : 'Recently'}
            </span>
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              Ref: {bike?.id?.slice(0, 8) || 'N/A'}
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
                {bike?.description || 'No description provided.'}
              </div>
            </div>
          </div>

          <aside className="cd-hero-right">
            <div className="cd-price-card">
              <span className="cd-price-label">Listed Price</span>
              <div className="cd-price-value">{formatPrice(bike?.price || bike?.expected_selling_price)}</div>
              <div className="cd-price-usd">
                ≈ USD {(bike?.price || bike?.expected_selling_price || 0 / 3.67).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>

              <div className="cd-badges">
                {bike?.wheels && (
                  <span className="cd-badge cd-badge-success">{bike.wheels} Wheels</span>
                )}
                {bike?.cylinders && (
                  <span className="cd-badge cd-badge-info">{bike.cylinders} Cylinders</span>
                )}
              </div>

              <div className="cd-divider"></div>

              <div className="cd-cta-buttons">
                <a 
                  href={`tel:${bike?.country_code || ''}${bike?.contact_phone}`} 
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
                {bike?.seller_profile_photo ? (
                  <img 
                    src={bike.seller_profile_photo} 
                    alt="Seller" 
                    className="seller-avatar-image"
                  />
                ) : (
                  (bike?.contact_name || bike?.user_email || '').charAt(0).toUpperCase()
                )}
              </div>
              <div className="cd-seller-info">
                <div className="cd-seller-name">
                  {bike?.contact_name || 'Private Seller'}
                </div>
              </div>
              <div className="cd-divider"></div>
              <div className="cd-seller-location">
                <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                {bike?.location || 'UAE'}
              </div>
            </div>
          </aside>
        </div>

        <div className="cd-content-grid">
          <div className="cd-content-left">
            <div className="cd-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Bike Specifications</h3>
              </div>
              <div className="cd-specs-list">
                {[
                  ['Make', bike?.make || bike?.bike_brand],
                  ['Model', bike?.model || bike?.bike_model],
                  ['Year', bike?.make_year],
                  ['Type', bike?.bike_type || bike?.bike_category],
                  ['Engine Size', bike?.engine_size || bike?.engine_capacity],
                  ['Cylinders', bike?.cylinders || 'N/A'],
                  ['Wheels', bike?.wheels || 'N/A'],
                  ['Mileage', formatKilometers(bike?.kilometer_driven)],
                  ['Color', bike?.color || 'N/A'],
                  ['Regional Specs', 'GCC Spec']
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
              {bike?.features && bike.features.length > 0 ? (
                <div className="cd-extras-grid">
                  {bike.features.map((feature, index) => (
                    <div key={index} className="cd-extra-item">
                      <span className="cd-extra-dot"></span>
                      {feature}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cd-empty-state">
                  No features were listed for this motorcycle.
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
                <span>{bike?.location || 'UAE'}</span>
              </div>
              <div className="cd-location-subtitle">
                {locationMapConfig?.approximate 
                  ? 'Approximate city location'
                  : 'Exact seller location'
                }
              </div>
              <div className="cd-map-placeholder">
                <svg className="cd-icon cd-icon-map-pin" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
                  <path d="M12 2C8.13 2 5 4.93 5 8c0 1.55.46 2.9 1.25 3.9.34 5.22 2.28 1.17 2.59.67.91.95.67 3.66.96 5.46.96 7.92.05 1.72-.59 2.57-.59 4.66.98 9.27.98 13.16.42 1.77-1.11 3.33.03 4.14-.03 3.54-.59 5.23-2.08 6.61-6.61-6.61-6.61.13 1.72.04 3.63-.08 4.51-.25 4.94-.69 5.65-.69 6.76.16 7.77.08 8.68.1 9.6.26 10.25.49 10.64.89 10.85 1.31.02 1.49-.28 1.59-.73 1.76-.73 2.21-.4 2.67-.4 3.04.09 3.23-.16 3.34-.5 3.4-.99 3.47-1.57 3.47-1.57H12z"/>
                </svg>
              </div>
            </div>

            <div className="cd-card cd-loan-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Loan Calculator</h3>
              </div>
              <div className="cd-loan-inputs">
                <div className="cd-loan-input">
                  <label className="cd-loan-label">Bike price (AED)</label>
                  <input 
                    type="number"
                    className="cd-loan-input-field"
                    value={loanCalculator.bikePrice}
                    onChange={(e) => handleLoanChange('bikePrice', Number(e.target.value))}
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
                  <select 
                    className="cd-loan-select"
                    value={loanCalculator.loanTerm}
                    onChange={(e) => handleLoanChange('loanTerm', Number(e.target.value))}
                  >
                    <option value={1}>1 year</option>
                    <option value={2}>2 years</option>
                    <option value={3}>3 years</option>
                    <option value={4}>4 years</option>
                    <option value={5}>5 years</option>
                  </select>
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

        <ReportButton listingId={id} listingType="bike" />
      </div>
    </div>
  );
};

export default BikeDetailRedesigned;
