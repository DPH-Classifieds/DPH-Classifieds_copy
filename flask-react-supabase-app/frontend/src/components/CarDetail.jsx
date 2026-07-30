import React, { useState, useEffect, useMemo } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/supabaseClient';
import { getCurrentUser } from '../utils/authService';
import { resolveMediaUrl } from '../utils/media';
import useSwipe from '../hooks/useSwipe';
import ListingSkeleton from './ListingSkeleton';
import ReportButton from './ReportButton';
import PhoneVerificationFlow from './PhoneVerificationFlow';
import SavedListingToggleButton from './SavedListingToggleButton';
import RedditSourcePanel, { isRedditSourced } from './RedditSourcePanel';
import RedditCarDetail from './RedditCarDetail';
import SeoMeta from './SeoMeta';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import './CarDetailRedesigned.css';
import { buildListingSeo } from '../utils/seo';
import { buildWhatsappMessage, getWhatsAppListingUrl } from '../utils/whatsapp';
import { ensureContactAccess } from '../utils/contactAccess';
import { forwardLeadToGa4 } from '../utils/analytics';
import { getWebAnalyticsIdentity } from '../utils/analyticsIdentity';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const SITE_URL = process.env.REACT_APP_SITE_URL || 'https://dphclassifieds.com';
const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';
const UAE_CITY_COORDINATES = {
  'abu dhabi': [24.4539, 54.3773],
  dubai: [25.2048, 55.2708],
  sharjah: [25.3463, 55.4209],
  ajman: [25.4052, 55.5136],
  'umm al quwain': [25.5647, 55.5552],
  'ras al khaimah': [25.7895, 55.9432],
  fujairah: [25.1288, 56.3265]
};

const EXTRA_BOOLEAN_LABELS = {
  climate_control: 'Climate Control',
  dvd_player: 'DVD Player',
  keyless_entry: 'Keyless Entry',
  navigation_system: 'Navigation System',
  premium_sound_system: 'Premium Sound System',
  cooled_seats: 'Cooled Seats',
  front_wheel_drive: 'Front Wheel Drive',
  leather_seats: 'Leather Seats',
  parking_sensors: 'Parking Sensors',
  rear_view_camera: 'Rear View Camera',
};

const CarDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, updateUser } = useAuth();
  const preloadedCar = location.state?.listing ?? null;
  const [car, setCar] = useState(() => preloadedCar);
  const [loading, setLoading] = useState(() => !preloadedCar);
  const [error, setError] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [viewerProfile, setViewerProfile] = useState(null);
  const [showPhoneVerifyModal, setShowPhoneVerifyModal] = useState(false);
  const [vinVisible, setVinVisible] = useState(false);
  const [verificationPhone, setVerificationPhone] = useState('');
  const [phoneVerificationSession, setPhoneVerificationSession] = useState(null);
  const seoData = useMemo(
    () =>
      buildListingSeo('car', car || preloadedCar || {}, {
        canonicalPath: `/cars/${id}`,
        location: (car || preloadedCar)?.car_city || 'UAE',
      }),
    [car, id, preloadedCar]
  );

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
      if (!preloadedCar) {
        setLoading(true);
      }
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
        if (!preloadedCar) {
          setError('Failed to load car details. Please try again later.');
        }
      } finally {
        if (!preloadedCar) {
          setLoading(false);
        }
      }
    };
    
    fetchCarDetails();
  }, [id, preloadedCar]);

  useEffect(() => {
    const fetchViewerProfile = async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          setViewerProfile(null);
          return;
        }

        const response = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          setViewerProfile(null);
          return;
        }
        const data = await response.json();
        setViewerProfile(data);
        if (data?.phone) {
          setVerificationPhone((prev) => prev || data.phone);
        }
      } catch (profileError) {
        console.warn('Failed to fetch viewer profile:', profileError);
      }
    };

    fetchViewerProfile();
  }, [user?.id]);

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
    const phone = (car?.car_owner_phone_number || car?.contact_phone || '').replace(/\D/g, '').replace(/^0+/, '');
    return phone;
  };

  const getWhatsappPrefillText = () =>
    buildWhatsappMessage({
      template: car?.whatsapp_prefill_text,
      listingUrl: getWhatsAppListingUrl(`/cars/${id}`, SITE_URL),
      listingLabel: 'car',
    });

  const trackLeadEvent = async (action, payload = {}) => {
    forwardLeadToGa4('car', id, action);
    try {
      const token = await getAccessToken();
      await fetch(`${API_URL}/api/listings/car/${id}/lead-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action,
          source: 'car_detail',
          payload,
          ...getWebAnalyticsIdentity(),
        }),
        keepalive: true,
      });
    } catch (trackingError) {
      console.warn('Lead tracking failed:', trackingError);
    }
  };

  const maskVin = (vin) => {
    if (!vin) return 'Not provided';
    const cleaned = String(vin).trim();
    if (cleaned.length <= 4) return cleaned;
    return `${'•'.repeat(Math.max(0, cleaned.length - 4))}${cleaned.slice(-4)}`;
  };

  const getGalleryImages = () => {
    const rawImages = Array.isArray(car?.images)
      ? car.images
      : Array.isArray(car?.car_images)
        ? car.car_images
        : [];

    const fallbackImages = rawImages.length > 0
      ? rawImages
      : [car?.display_url, car?.image_url, car?.url].filter(Boolean);

    if (!fallbackImages.length) {
      return [];
    }

    return fallbackImages
      .map((image) => {
        if (!image) return null;

        if (typeof image === 'string') {
          const resolved = resolveMediaUrl(image);
          if (!resolved) return null;
          return {
            id: resolved,
            displayUrl: resolved,
            originalUrl: resolved,
            hasDisplayVariant: false,
            focalX: 50,
            focalY: 50,
          };
        }

        const displayUrl = resolveMediaUrl(image.display_url || image.image_url || image.url);
        const originalUrl = resolveMediaUrl(image.image_url || image.url || image.display_url);
        if (!displayUrl && !originalUrl) return null;

        const focalX = Number.isFinite(Number(image.focal_x)) ? Number(image.focal_x) : 50;
        const focalY = Number.isFinite(Number(image.focal_y)) ? Number(image.focal_y) : 50;

        return {
          id: image.id || `${displayUrl || originalUrl}`,
          displayUrl: displayUrl || originalUrl,
          originalUrl: originalUrl || displayUrl,
          hasDisplayVariant: Boolean(image.display_url),
          focalX,
          focalY,
          cropped_at: image.cropped_at || null
        };
      })
      .filter(Boolean);
  };

  const getMainImage = () => {
    const images = getGalleryImages();
    if (!images.length) return null;
    return images[activeImageIndex] || images[0];
  };

  const getMainImageUrl = () => {
    const mainImage = getMainImage();
    if (!mainImage) return null;
    return mainImage.displayUrl || mainImage.originalUrl;
  };

  const getMainImageObjectPosition = () => {
    const mainImage = getMainImage();
    if (!mainImage || mainImage.hasDisplayVariant) return undefined;
    if (mainImage.cropped_at) return undefined;
    return `${mainImage.focalX}% ${mainImage.focalY}%`;
  };

  const getThumbnailUrl = (image) => {
    if (!image) return null;
    return image.displayUrl || image.originalUrl;
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

  const getDisplayExtras = () => {
    if (Array.isArray(car?.extras) && car.extras.length > 0) {
      return car.extras;
    }

    return Object.entries(EXTRA_BOOLEAN_LABELS)
      .filter(([key]) => Boolean(car?.[key]))
      .map(([, label]) => label);
  };

  const goBack = () => {
    navigate(-1);
  };

  const openLightboxAt = (index) => {
    const images = getGalleryImages();
    if (!images.length) return;
    const safe = Math.max(0, Math.min(index, images.length - 1));
    setActiveImageIndex(safe);
    setLightboxOpen(true);
  };

  const closeLightbox = () => setLightboxOpen(false);

  const stepLightbox = (direction) => {
    const images = getGalleryImages();
    if (!images.length) return;
    setActiveImageIndex((current) => {
      const next = current + direction;
      if (next < 0) return images.length - 1;
      if (next >= images.length) return 0;
      return next;
    });
  };

  const isOwner = Boolean(user?.id && car?.user_id && user.id === car.user_id);
  const isPhoneVerified = Boolean(viewerProfile?.phone_verified || user?.phone_verified);
  const canViewVin = isOwner || isPhoneVerified;
  const visibleVin = vinVisible ? (car?.vin_number || 'Not provided') : maskVin(car?.vin_number);

  const handleCallClick = (event) => {
    if (!ensureContactAccess({ user, navigate, nextRoute: `${location.pathname}${location.search}` })) {
      event?.preventDefault?.();
      return false;
    }
    trackLeadEvent('call_click', { listing_id: id });
    return true;
  };

  const handleWhatsappClick = (event) => {
    if (!ensureContactAccess({ user, navigate, nextRoute: `${location.pathname}${location.search}` })) {
      event?.preventDefault?.();
      return false;
    }
    trackLeadEvent('whatsapp_click', { listing_id: id });
    return true;
  };

  const handleVinReveal = async () => {
    await trackLeadEvent('vin_open', { listing_id: id });
    if (!user?.id) {
      navigate(`/login?redirect=${encodeURIComponent(`/cars/${id}`)}`);
      return;
    }
    if (canViewVin) {
      setVinVisible(true);
      await trackLeadEvent('vin_reveal', { listing_id: id, source: 'direct_unlock' });
      return;
    }
    setShowPhoneVerifyModal(true);
  };

  const heroSwipeRef = useSwipe({
    onSwipeLeft: () => stepLightbox(1),
    onSwipeRight: () => stepLightbox(-1),
    enabled: getGalleryImages().length > 1,
  });
  const lightboxSwipeRef = useSwipe({
    onSwipeLeft: () => stepLightbox(1),
    onSwipeRight: () => stepLightbox(-1),
    enabled: lightboxOpen && getGalleryImages().length > 1,
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

  if (!car) {
    return (
      <div className="cd-error-container">
        <h2>Car Not Found</h2>
        <p>The car listing you're looking for doesn't exist or has been removed.</p>
        <Link to="/cars" className="cd-back-button">Back to Listings</Link>
      </div>
    );
  }

  // Reddit imports carry minimal data — render the clean, focused view instead
  // of the full seller/spec/loan page (which would be mostly empty).
  if (isRedditSourced(car)) {
    return <RedditCarDetail car={car} />;
  }

  const galleryImages = getGalleryImages();
  const locationMapConfig = getLocationMapConfig();
  const listingArea = car?.area || car?.car_location || null;
  const displayExtras = getDisplayExtras();

  return (
    <div className="cd-container">
      <SeoMeta {...seoData} />
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
      <div className="cd-main-image" ref={heroSwipeRef}>
        {getMainImageUrl() ? (
          <img
            src={getMainImageUrl()}
            alt={getDisplayTitle()}
            loading="lazy"
            decoding="async"
            width="800"
            height="500"
            style={{ objectPosition: getMainImageObjectPosition() }}
            onClick={() => openLightboxAt(activeImageIndex)}
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
                    onClick={(e) => { e.stopPropagation(); stepLightbox(-1); }}
                    aria-label="Previous photo"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="cd-hero-arrow cd-hero-arrow-next"
                    onClick={(e) => { e.stopPropagation(); stepLightbox(1); }}
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
                {galleryImages.map((image, index) => (
                  <div 
                    key={`${image.id}-${index}`}
                    className={`cd-thumbnail ${index === activeImageIndex ? 'cd-thumbnail-active' : ''}`}
                    onClick={() => setActiveImageIndex(index)}
                    onDoubleClick={() => openLightboxAt(index)}
                  >
                    <img src={getThumbnailUrl(image)} alt={`Thumbnail ${index + 1}`} />
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
                {car?.regional_spec?.includes('GCC') && (
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

              {isRedditSourced(car) ? (
                <div className="cd-cta-buttons">
                  <RedditSourcePanel car={car} />
                  <SavedListingToggleButton
                    listingType="car"
                    listingId={id}
                    listingData={car}
                    className="saved-listing-button-detail"
                    label="Save listing"
                    showLabel
                  />
                </div>
              ) : (
                <div className="cd-cta-buttons">
                  <a
                    href={`tel:${car?.car_owner_phone_number || car?.contact_phone || ''}`}
                    className="cd-button cd-button-primary"
                    onClick={handleCallClick}
                  >
                    Call Seller
                  </a>
                  <a
                    href={`https://wa.me/${formatWhatsappNumber()}?text=${encodeURIComponent(getWhatsappPrefillText())}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cd-button cd-button-secondary"
                    onClick={handleWhatsappClick}
                  >
                    WhatsApp
                  </a>
                  <SavedListingToggleButton
                    listingType="car"
                    listingId={id}
                    listingData={car}
                    className="saved-listing-button-detail"
                    label="Save listing"
                    showLabel
                  />
                </div>
              )}
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
                  (isRedditSourced(car) ? 'DPH Classifieds' : (car?.seller_name || car?.dealer_name || car?.contact_name || car?.user_email || '')).charAt(0).toUpperCase()
                )}
              </div>
              <div className="cd-seller-info">
                <div className="cd-seller-name">
                  {isRedditSourced(car) ? 'DPH Classifieds' : (car?.seller_name || car?.dealer_name || car?.contact_name || 'Private Seller')}
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

        {lightboxOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image viewer"
            onClick={closeLightbox}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99999,
              background: 'rgba(0,0,0,0.86)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 18,
            }}
          >
            <div
              ref={lightboxSwipeRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'relative',
                width: 'min(1100px, 96vw)',
                maxHeight: '90vh',
                touchAction: 'pan-y',
              }}
            >
              <button
                type="button"
                onClick={closeLightbox}
                aria-label="Close image viewer"
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(10,10,10,0.7)',
                  color: '#fff',
                  fontSize: 22,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>

              <button
                type="button"
                onClick={() => stepLightbox(-1)}
                aria-label="Previous image"
                style={{
                  position: 'absolute',
                  left: -10,
                  top: '50%',
                  transform: 'translate(-100%, -50%)',
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(10,10,10,0.7)',
                  color: '#fff',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ‹
              </button>

              <button
                type="button"
                onClick={() => stepLightbox(1)}
                aria-label="Next image"
                style={{
                  position: 'absolute',
                  right: -10,
                  top: '50%',
                  transform: 'translate(100%, -50%)',
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(10,10,10,0.7)',
                  color: '#fff',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ›
              </button>

              <img
                src={getMainImage()?.originalUrl || getMainImageUrl()}
                alt={getDisplayTitle()}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: '90vh',
                  objectFit: 'contain',
                  borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.14)',
                }}
              />
            </div>
          </div>
        )}

        <div className="cd-content-grid">
          <div className="cd-content-left">
            <div className="cd-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">VIN / Chassis Number</h3>
              </div>
              <div className="cd-vin-block">
                <span className="cd-vin-label">Vehicle Identification Number</span>
                <div className="cd-vin-value" onClick={handleVinReveal} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') handleVinReveal(); }}>
                  {visibleVin}
                </div>
                {!canViewVin && (
                  <button type="button" className="cd-button cd-button-secondary" onClick={handleVinReveal}>
                    Verify phone to reveal VIN
                  </button>
                )}
                {canViewVin && !vinVisible && (
                  <span
                    onClick={handleVinReveal}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => { if (event.key === 'Enter') handleVinReveal(); }}
                    style={{ cursor: 'pointer', fontSize: 12, color: '#8bd6b4', opacity: 0.7, textDecoration: 'underline', marginTop: 4, display: 'inline-block' }}
                  >
                    Click to reveal
                  </span>
                )}
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
                  ['Engine', car?.engine_capacity || 'N/A'],
                  ['Doors', car?.doors || 'N/A'],
                  ['Seating Capacity', car?.seating_capacity || 'N/A'],
                  ['Steering Side', car?.steering_side || 'N/A'],
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
              {displayExtras.length > 0 ? (
                <div className="cd-extras-grid">
                  {displayExtras.map((extra, index) => (
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
                {locationMapConfig?.approximate ? 'Approximate city location' : 'Pinned listing location'}
              </div>
              {locationMapConfig ? (
                <div className="cd-map-placeholder">
                  <MapContainer
                    center={locationMapConfig.center}
                    zoom={locationMapConfig.zoom}
                    scrollWheelZoom={false}
                    dragging={!locationMapConfig.approximate}
                    zoomControl={!locationMapConfig.approximate}
                    doubleClickZoom={false}
                    attributionControl
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; OpenStreetMap contributors &copy; CARTO'
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />
                    <Marker position={locationMapConfig.center} />
                  </MapContainer>
                </div>
              ) : (
                <div className="cd-map-placeholder">
                  <svg className="cd-icon cd-icon-map-pin" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                </div>
              )}
              <div className="cd-location-subtitle" style={{ marginTop: '0.75rem' }}>
                Area: {listingArea || 'Not specified'}
              </div>
              {car?.car_location && (
                <div className="cd-location-subtitle">
                  Address: {car.car_location}
                </div>
              )}
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

	        {showPhoneVerifyModal && (
	          <PhoneVerificationFlow
	            mode="modal"
	            open={showPhoneVerifyModal}
	            title="Phone verification required"
	            description="Verify your phone to reveal contact details (and VIN where applicable)."
	            phone={verificationPhone || viewerProfile?.phone || user?.phone || ''}
	            countryCode={viewerProfile?.country_code || user?.country_code || '+971'}
	            purpose="vin_reveal"
	            listingId={id}
	            verificationId={phoneVerificationSession?.verificationId || null}
	            onClose={() => {
	              setShowPhoneVerifyModal(false);
	              setPhoneVerificationSession(null);
	            }}
	            onVerified={async (result) => {
	              setPhoneVerificationSession(null);
	              setShowPhoneVerifyModal(false);
	              setVinVisible(true);
	              setViewerProfile((prev) => ({
	                ...(prev || {}),
	                phone_verified: true,
	              }));
	              // Refresh global user state so phone_verified is up-to-date
	              try {
	                const { user: refreshedUser } = await getCurrentUser(true);
	                if (refreshedUser && refreshedUser.id) {
	                  updateUser(refreshedUser);
	                }
	              } catch (err) {
	                console.error('Failed to refresh user after phone verification:', err);
	              }
	              await trackLeadEvent('vin_reveal', { listing_id: id, verification: result?.verification });
	            }}
	            autoStart
	          />
	        )}
      </div>
    </div>
  );
};

export default CarDetail;
