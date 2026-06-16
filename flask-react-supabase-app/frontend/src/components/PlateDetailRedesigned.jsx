import React, { useState, useEffect, useMemo } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/supabaseClient';
import ListingSkeleton from './ListingSkeleton';
import ReportButton from './ReportButton';
import SavedListingToggleButton from './SavedListingToggleButton';
import SeoMeta from './SeoMeta';
import './CarDetailRedesigned.css';
import { buildListingSeo } from '../utils/seo';
import { buildWhatsappMessage, getWhatsAppListingUrl } from '../utils/whatsapp';
import { ensureContactAccess } from '../utils/contactAccess';
import { forwardLeadToGa4 } from '../utils/analytics';
import { resolveMediaUrl } from '../utils/media';
import useSwipe from '../hooks/useSwipe';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const SITE_URL = process.env.REACT_APP_SITE_URL || 'https://dphclassifieds.com';
const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const PlateDetailRedesigned = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const location = useLocation();
  const preloadedPlate = location.state?.listing ?? null;
  const [plate, setPlate] = useState(() => preloadedPlate);
  const [loading, setLoading] = useState(() => !preloadedPlate);
  const [error, setError] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const [loanCalculator, setLoanCalculator] = useState({
    platePrice: 0,
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
      buildListingSeo('plate', plate || preloadedPlate || {}, {
        canonicalPath: `/plates/${id}`,
        location: (plate || preloadedPlate)?.city || 'UAE',
      }),
    [plate, id, preloadedPlate]
  );

  useEffect(() => {
    const fetchPlateDetails = async () => {
      if (!preloadedPlate) {
        setLoading(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await axios.get(`${API_URL}/api/plates/${id}`, { headers });

        setPlate(response.data);

        const price = response.data.price || 0;
        setLoanCalculator(prev => ({
          ...prev,
          platePrice: price,
          downPayment: Math.round(price * 0.2)
        }));
      } catch (err) {
        console.error('Error fetching plate details:', err);
        if (!preloadedPlate) {
          setError('Failed to load plate details. Please try again later.');
        }
      } finally {
        if (!preloadedPlate) {
          setLoading(false);
        }
      }
    };

    fetchPlateDetails();
  }, [id, preloadedPlate]);

  useEffect(() => {
    const { platePrice, downPayment, loanTerm, interestRate } = loanCalculator;
    const principal = platePrice - downPayment;
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

  const handleCallClick = () => ensureContactAccess({
    user,
    navigate,
    nextRoute: `${location.pathname}${location.search}`,
  });

  const handleWhatsappClick = () => ensureContactAccess({
    user,
    navigate,
    nextRoute: `${location.pathname}${location.search}`,
  });

  const formatPrice = (price) => {
    if (!price) return 'Price on request';
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      maximumFractionDigits: 0
    }).format(price);
  };

  const formatWhatsappNumber = () => {
    const phone = (plate?.contact_phone || '').replace(/\D/g, '').replace(/^0+/, '');
    return phone;
  };

  const getWhatsappPrefillText = () =>
    buildWhatsappMessage({
      template: plate?.whatsapp_prefill_text,
      listingUrl: getWhatsAppListingUrl(`/plates/${id}`, SITE_URL),
      listingLabel: 'plate',
    });

  const trackLeadEvent = async (action) => {
    forwardLeadToGa4('plate', id, action);
    try {
      const token = await getAccessToken();
      await fetch(`${API_URL}/api/listings/plate/${id}/lead-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action, source: 'plate_detail', payload: { listing_id: id } }),
      });
    } catch (error) {
      console.warn('Plate lead tracking failed:', error);
    }
  };

  const getGalleryImages = () => {
    if (!plate?.images?.length) {
      return [];
    }
    return plate.images
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
    return `${plate?.city || ''} ${plate?.code || ''} ${plate?.number || ''}`.trim() || plate?.listing_title || 'Untitled listing';
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

  if (!plate) {
    return (
      <div className="cd-error-container">
        <h2>Plate Not Found</h2>
        <p>The plate listing you're looking for doesn't exist or has been removed.</p>
        <Link to="/plates" className="cd-back-button">Back to Listings</Link>
      </div>
    );
  }

  const galleryImages = getGalleryImages();
  const listingArea = plate?.area || null;

  return (
    <div className="cd-container">
      <SeoMeta {...seoData} />
      <div className="cd-max-width">
        <nav className="cd-breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/plates">License Plates</Link>
          <span>/</span>
          <span>{plate?.city || 'City'}</span>
          <span>/</span>
          <span className="cd-breadcrumb-current">{plate?.code || 'Code'}</span>
        </nav>

        <div className="cd-title-block">
          <h1 className="cd-title">{getDisplayTitle()}</h1>
          <div className="cd-meta-strip">
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              {plate?.city || 'UAE'}
            </span>
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              Posted {plate?.created_at ? new Date(plate.created_at).toLocaleDateString() : 'Recently'}
            </span>
            <span className="cd-meta-item">
              <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              Ref: {plate?.id?.slice(0, 8) || 'N/A'}
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

            <div className="cd-card cd-description-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Plate Information</h3>
              </div>
              <div className="cd-specs-list">
                {[
                  ['City', plate?.city],
                  ['Code', plate?.code],
                  ['Number', plate?.number],
                  ['Format', plate?.plate_format],
                  ['Digits', plate?.digits ? `${plate.digits} Digits` : 'N/A'],
                  ['Price', formatPrice(plate?.price)]
                ].map(([label, value]) => (
                  <div key={label} className="cd-spec-row">
                    <span className="cd-spec-label">{label}</span>
                    <span className="cd-spec-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="cd-hero-right">
            <div className="cd-price-card">
              <span className="cd-price-label">Listed Price</span>
              <div className="cd-price-value">{formatPrice(plate?.price)}</div>
              <div className="cd-price-usd">
                ≈ USD {(plate?.price / 3.67).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>

              <div className="cd-badges">
                {plate?.digits === 5 && (
                  <span className="cd-badge cd-badge-success">5 Digits</span>
                )}
                {plate?.digits === 4 && (
                  <span className="cd-badge cd-badge-info">4 Digits</span>
                )}
                {plate?.digits === 3 && (
                  <span className="cd-badge cd-badge-warning">3 Digits</span>
                )}
              </div>

              <div className="cd-divider"></div>

              <div className="cd-cta-buttons">
                <a 
                  href={`tel:${plate?.contact_phone || ''}`}
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
                  listingType="plate"
                  listingId={id}
                  listingData={plate}
                  className="saved-listing-button-detail"
                  label="Save listing"
                  showLabel
                />
              </div>
            </div>

            <div className="cd-seller-card">
              <div className="cd-seller-avatar">
                {plate?.seller_profile_photo ? (
                  <img 
                    src={plate.seller_profile_photo} 
                    alt="Seller" 
                    className="seller-avatar-image"
                  />
                ) : (
                  (plate?.seller_name || plate?.contact_name || plate?.user_email || '').charAt(0).toUpperCase()
                )}
              </div>
              <div className="cd-seller-info">
                <div className="cd-seller-name">
                  {plate?.seller_name || plate?.contact_name || 'Private Seller'}
                </div>
              </div>
              <div className="cd-divider"></div>
              <div className="cd-seller-location">
                <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                {plate?.city || 'UAE'}
              </div>
            </div>
          </aside>
        </div>

        <div className="cd-content-grid">
          <div className="cd-content-left">
            <div className="cd-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Description</h3>
              </div>
              <div className="cd-description">
                {plate?.description || 'No description provided.'}
              </div>
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
                <span>{plate?.city || 'UAE'}</span>
              </div>
              <div className="cd-location-subtitle">
                Exact seller location
              </div>
              <div className="cd-map-placeholder">
                <svg className="cd-icon cd-icon-map-pin" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 3.87 3.13 7 7 7s7-3.13 7-7c0-3.87-3.13-7-7-7zm0 9c-1.38 0-2.5 1.12-2.5-2.5s1.12 2.5 2.5 5.5c1.38 0 2.5-1.12 2.5-2.5s-1.12-2.5-2.5-5.5zm0 7.92c1.54 0 2.5-1.12 2.5-2.5s-1.12 2.5-2.5-5.5c0-1.54-1.12-2.5-2.5-2.5zm-1.18 6L5.64 13.36c-.78.78-.78-2.05 0-2.83.83-.83 1.18-.83 2.05.83 2.83-.78.78 2.05-2.83-.83z"/>
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
                  <label className="cd-loan-label">Plate price (AED)</label>
                  <input 
                    type="number"
                    className="cd-loan-input-field"
                    value={loanCalculator.platePrice}
                    onChange={(e) => handleLoanChange('platePrice', Number(e.target.value))}
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

        <ReportButton listingId={id} listingType="plate" />
      </div>
    </div>
  );
};

export default PlateDetailRedesigned;
