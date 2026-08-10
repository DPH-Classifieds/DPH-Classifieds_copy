import React, { useState, useEffect, useMemo } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { getAccessToken } from '../utils/supabaseClient';
import ListingSkeleton from './ListingSkeleton';
import ReportButton from './ReportButton';
import SavedListingToggleButton from './SavedListingToggleButton';
import RedditSourcePanel, { isRedditSourced } from './RedditSourcePanel';
import RedditListingDetail from './RedditListingDetail';
import ImageLightbox from './ImageLightbox';
import SeoMeta from './SeoMeta';
import './CarDetailRedesigned.css';
import { buildListingSeo } from '../utils/seo';
import { buildWhatsappMessage, getWhatsAppListingUrl } from '../utils/whatsapp';
import { forwardLeadToGa4 } from '../utils/analytics';
import { getWebAnalyticsIdentity } from '../utils/analyticsIdentity';
import { getBotSignals } from '../utils/botSignals';
import { resolveMediaUrl } from '../utils/media';
import useSwipe from '../hooks/useSwipe';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const SITE_URL = process.env.REACT_APP_SITE_URL || 'https://dphclassifieds.com';
const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const BikeDetailRedesigned = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const preloadedBike = location.state?.listing ?? null;
  const [bike, setBike] = useState(() => preloadedBike);
  const [loading, setLoading] = useState(() => !preloadedBike);
  const [error, setError] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

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
  const seoData = useMemo(
    () =>
      buildListingSeo('bike', bike || preloadedBike || {}, {
        canonicalPath: `/bikes/${id}`,
        location: (bike || preloadedBike)?.location || (bike || preloadedBike)?.city || 'UAE',
      }),
    [bike, id, preloadedBike]
  );

  useEffect(() => {
    const fetchBikeDetails = async () => {
      if (!preloadedBike) {
        setLoading(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.get(`${API_URL}/api/bikes/${id}`, { headers });

        setBike(response.data);

        const price = response.data.price || response.data.expected_selling_price || 0;
        setLoanCalculator(prev => ({
          ...prev,
          bikePrice: price,
          downPayment: Math.round(price * 0.2)
        }));
      } catch (err) {
        console.error('Error fetching bike details:', err);
        if (!preloadedBike) {
          setError('Failed to load bike details. Please try again later.');
        }
      } finally {
        if (!preloadedBike) {
          setLoading(false);
        }
      }
    };

    fetchBikeDetails();
  }, [id, preloadedBike]);

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

  // Public phone + WhatsApp: no login / phone-verify. Click is still tracked
  // anonymously by the onClick handlers below.
  const handleCallClick = () => true;
  const handleWhatsappClick = () => true;

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
    const phone = (bike?.contact_phone || '').replace(/\D/g, '').replace(/^0+/, '');
    return phone;
  };

  const getWhatsappPrefillText = () =>
    buildWhatsappMessage({
      template: bike?.whatsapp_prefill_text,
      listingUrl: getWhatsAppListingUrl(`/bikes/${id}`, SITE_URL),
      listingLabel: 'bike',
    });

  const trackLeadEvent = async (action) => {
    forwardLeadToGa4('bike', id, action);
    try {
      const token = await getAccessToken();
      await fetch(`${API_URL}/api/listings/bike/${id}/lead-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action, source: 'bike_detail', payload: { listing_id: id }, metadata: getBotSignals(), ...getWebAnalyticsIdentity() }),
        keepalive: true,
      });
    } catch (error) {
      console.warn('Bike lead tracking failed:', error);
    }
  };

  const getGalleryImages = () => {
    if (!bike?.images?.length) {
      return [];
    }
    return bike.images
      .map((image) => {
        if (typeof image === 'string') return image;
        return image?.display_url || image?.image_url || image?.url || null;
      })
      .filter(Boolean)
      .map((imageUrl) => resolveMediaUrl(imageUrl));
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

  const stepHeroImage = (direction) => {
    const images = getGalleryImages();
    if (!images.length) return;
    setActiveImageIndex((current) => {
      const next = current + direction;
      if (next < 0) return images.length - 1;
      if (next >= images.length) return 0;
      return next;
    });
  };
  const heroSwipeRef = useSwipe({
    onSwipeLeft: () => stepHeroImage(1),
    onSwipeRight: () => stepHeroImage(-1),
    enabled: getGalleryImages().length > 1,
  });

  if (loading) {
    return <ListingSkeleton variant="detail" showHero />;
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

  if (isRedditSourced(bike)) {
    return <RedditListingDetail listing={bike} listingType="bike" />;
  }

  const galleryImages = getGalleryImages();
  const locationMapConfig = getLocationMapConfig();
  const listingArea = bike?.area || bike?.location || null;

  return (
    <div className="cd-container">
      <SeoMeta {...seoData} />
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
            <div className="cd-main-image" ref={heroSwipeRef}>
              {getMainImageUrl() ? (
                <img
                  src={getMainImageUrl()}
                  alt={getDisplayTitle()}
                  style={{ cursor: 'zoom-in' }}
                  onClick={() => setLightboxOpen(true)}
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
                  <span className="cd-placeholder-kicker"><span className="cd-placeholder-kicker-dph">DPH</span> <span className="cd-placeholder-kicker-classifieds">Classifieds</span></span>
                  <span className="cd-placeholder-title">{getDisplayTitle()}</span>
                </div>
              )}
              {galleryImages.length > 1 && (
                <>
                  <button
                    type="button"
                    className="cd-hero-arrow cd-hero-arrow-prev"
                    onClick={(e) => { e.stopPropagation(); stepHeroImage(-1); }}
                    aria-label="Previous photo"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="cd-hero-arrow cd-hero-arrow-next"
                    onClick={(e) => { e.stopPropagation(); stepHeroImage(1); }}
                    aria-label="Next photo"
                  >
                    ›
                  </button>
                </>
              )}
              {galleryImages.length > 0 && (
                <div className="cd-photo-count">
                  {galleryImages.length > 1
                    ? `${activeImageIndex + 1} / ${galleryImages.length}`
                    : `${galleryImages.length} photo`}
                </div>
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

              {isRedditSourced(bike) ? (
                <div className="cd-cta-buttons">
                  <RedditSourcePanel car={bike} listingType="bike" listingId={id} />
                  <SavedListingToggleButton
                    listingType="bike"
                    listingId={id}
                    listingData={bike}
                    className="saved-listing-button-detail"
                    label="Save listing"
                    showLabel
                  />
                </div>
              ) : (
              <div className="cd-cta-buttons">
                <a
                  href={`tel:${bike?.contact_phone || ''}`}
                  className="cd-button cd-button-primary"
                  onClick={(event) => {
                    if (!handleCallClick()) {
                      event.preventDefault();
                      return;
                    }
                    trackLeadEvent('call_click');
                  }}
                >
                  Call Seller
                </a>
                <a
                  href={`https://wa.me/${formatWhatsappNumber()}?text=${encodeURIComponent(getWhatsappPrefillText())}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cd-button cd-button-secondary"
                  onClick={(event) => {
                    if (!handleWhatsappClick()) {
                      event.preventDefault();
                      return;
                    }
                    trackLeadEvent('whatsapp_click');
                  }}
                >
                  WhatsApp
                </a>
                <SavedListingToggleButton
                  listingType="bike"
                  listingId={id}
                  listingData={bike}
                  className="saved-listing-button-detail"
                  label="Save listing"
                  showLabel
                />
              </div>
              )}
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
                  (isRedditSourced(bike) ? 'DPH Classifieds' : (bike?.seller_name || bike?.contact_name || bike?.user_email || '')).charAt(0).toUpperCase()
                )}
              </div>
              <div className="cd-seller-info">
                <div className="cd-seller-name">
                  {isRedditSourced(bike) ? 'DPH Classifieds' : (bike?.seller_name || bike?.contact_name || 'Private Seller')}
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
              <div className="cd-location-subtitle" style={{ marginTop: '0.75rem' }}>
                Area: {listingArea || 'Not specified'}
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

        <ReportButton listingId={id} listingType="bike" />
      </div>
      {lightboxOpen && (
        <ImageLightbox images={getGalleryImages()} startIndex={activeImageIndex} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
};

export default BikeDetailRedesigned;
