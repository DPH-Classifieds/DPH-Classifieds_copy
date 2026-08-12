import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { resolveMediaUrl } from '../utils/media';
import SeoMeta from './SeoMeta';
import RedditSourcePanel from './RedditSourcePanel';
import SavedListingToggleButton from './SavedListingToggleButton';
import ImageLightbox from './ImageLightbox';
import { buildListingSeo } from '../utils/seo';
import { buildCarPath } from '../utils/listingUrl';
import './CarDetailRedesigned.css';
import './RedditListingDetail.css';

const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const formatPrice = (price) => {
  if (!price) return 'Price on request';
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0,
  }).format(price);
};

const clean = (v) => (v && v !== 'Unspecified' && v !== 'N/A' ? v : null);
const kms = (v) => (Number(v) > 0 ? `${Number(v).toLocaleString()} km` : null);

// Per-type field mapping so one listing view serves cars, bikes, plates & parts.
const TYPE_CONFIG = {
  car: {
    routeBase: '/cars',
    crumbLabel: 'Cars',
    title: (l) => [l.make_year, l.car_manufacturer, l.car_model].filter(Boolean).join(' ').trim(),
    price: (l) => l.expected_selling_price,
    location: (l) => clean(l.car_city),
    description: (l) => l.car_description,
    specs: (l) => [
      ['Make', clean(l.car_manufacturer)],
      ['Model', clean(l.car_model)],
      ['Year', l.make_year || null],
      ['Trim', clean(l.trim)],
      ['Mileage', kms(l.kilometer_driven)],
      ['Regional Spec', clean(l.regional_spec)],
      ['Color', clean(l.color)],
      ['Fuel Type', clean(l.fuel_type)],
      ['Transmission', clean(l.transmission_type)],
      ['VIN', clean(l.vin_number)],
      ['Location', clean(l.car_city)],
    ],
  },
  bike: {
    routeBase: '/bikes',
    crumbLabel: 'Bikes',
    title: (l) => [l.year, l.bike_brand, l.bike_model].filter(Boolean).join(' ').trim(),
    price: (l) => l.price,
    location: (l) => clean(l.location || l.emirate),
    description: (l) => l.description,
    specs: (l) => [
      ['Brand', clean(l.bike_brand)],
      ['Model', clean(l.bike_model)],
      ['Year', l.year || null],
      ['Type', clean(l.bike_type)],
      ['Engine', l.engine_size ? `${l.engine_size} cc` : null],
      ['Mileage', kms(l.mileage)],
      ['Color', clean(l.color)],
      ['Location', clean(l.location || l.emirate)],
    ],
  },
  plate: {
    routeBase: '/plates',
    crumbLabel: 'Plates',
    title: (l) => [l.city, l.code, l.number].filter(Boolean).join(' ').trim() || 'Number Plate',
    price: (l) => l.price,
    location: (l) => clean(l.city),
    description: (l) => l.description,
    specs: (l) => [
      ['City', clean(l.city)],
      ['Code', clean(l.code)],
      ['Number', clean(l.number)],
      ['Digits', l.digits || null],
      ['Format', clean(l.plate_format)],
    ],
  },
  part: {
    routeBase: '/car-parts',
    crumbLabel: 'Car Parts',
    title: (l) => l.name || l.part_type || 'Car Part',
    price: (l) => l.price,
    location: (l) => clean(l.location || l.emirate),
    description: (l) => l.description,
    specs: (l) => [
      ['Name', clean(l.name)],
      ['Type', clean(l.part_type)],
      ['Condition', clean(l.condition)],
      ['Location', clean(l.location || l.emirate)],
    ],
  },
};

const resolveImages = (listing) => {
  const raw =
    (Array.isArray(listing?.images) && listing.images) ||
    (Array.isArray(listing?.car_images) && listing.car_images) ||
    (Array.isArray(listing?.bike_images) && listing.bike_images) ||
    (Array.isArray(listing?.part_images) && listing.part_images) ||
    [];
  const urls = raw.length
    ? raw.map((img) => (typeof img === 'string' ? img : img?.display_url || img?.image_url || img?.url))
    : [listing?.display_url, listing?.image_url, listing?.url];
  return urls.map(resolveMediaUrl).filter(Boolean);
};

const PinIcon = () => (
  <svg className="cd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

// Reddit imports rendered in the same layout as a normal user listing (mobile
// responsive via the shared cd- styles), showing only fields that carry data.
export default function RedditListingDetail({ listing, listingType = 'car' }) {
  const { id } = useParams();
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [shareFeedback, setShareFeedback] = useState('');
  const cfg = TYPE_CONFIG[listingType] || TYPE_CONFIG.car;
  const images = useMemo(() => resolveImages(listing), [listing]);

  const title = cfg.title(listing) || listing?.listing_title || 'Reddit listing';
  const location = cfg.location(listing);
  const description = cfg.description(listing);
  const specRows = cfg.specs(listing).filter(([, v]) => v != null && v !== '');
  const postedDate = listing?.source_created_at || listing?.created_at;
  const canonicalPath = listingType === 'car' ? buildCarPath(listing) : `${cfg.routeBase}/${id}`;
  const shareUrl = `https://www.dphclassifieds.com${canonicalPath}`;

  const handleShare = async () => {
    const shareData = { title, text: `${title}\n${shareUrl}`, url: shareUrl };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error('Sharing is unavailable');
      await navigator.clipboard.writeText(shareUrl);
      setShareFeedback('Link copied');
      window.setTimeout(() => setShareFeedback(''), 2500);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setShareFeedback('Could not share link');
        window.setTimeout(() => setShareFeedback(''), 2500);
      }
    }
  };

  const seoData = useMemo(
    () => buildListingSeo(listingType, listing || {}, { canonicalPath, location: location || 'UAE' }),
    [listing, listingType, canonicalPath, location]
  );

  return (
    <div className="cd-container">
      <SeoMeta {...seoData} />
      <div className="cd-max-width">
        <nav className="cd-breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          <Link to="/explore?category=reddit">Reddit</Link>
          <span>/</span>
          <span className="cd-breadcrumb-current">{cfg.crumbLabel}</span>
        </nav>

        <div className="cd-title-block">
          <h1 className="cd-title">{title}</h1>
          <div className="cd-meta-strip">
            {location ? (
              <span className="cd-meta-item"><PinIcon />{location}</span>
            ) : null}
            <span className="cd-meta-item rcd-source-pill">Imported from r/DubaiPetrolHeads</span>
            {postedDate ? (
              <span className="cd-meta-item">Posted {new Date(postedDate).toLocaleDateString()}</span>
            ) : null}
          </div>
        </div>

        <div className="cd-hero-grid">
          <div className="cd-hero-left">
            <div className="cd-main-image">
              {images[active] ? (
                <img
                  src={images[active]}
                  alt={title}
                  loading="lazy"
                  decoding="async"
                  style={{ cursor: 'zoom-in' }}
                  onClick={() => setLightboxOpen(true)}
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = PLACEHOLDER_IMAGE;
                  }}
                />
              ) : (
                <div className="cd-image-placeholder">
                  <span className="cd-placeholder-kicker">
                    <span className="cd-placeholder-kicker-dph">DPH</span>{' '}
                    <span className="cd-placeholder-kicker-classifieds">Classifieds</span>
                  </span>
                  <span className="cd-placeholder-title">{title}</span>
                </div>
              )}
              {images.length > 0 ? (
                <span className="cd-photo-count">
                  {images.length > 1 ? `${active + 1} / ${images.length}` : '1 photo'}
                </span>
              ) : null}
            </div>

            {images.length > 1 && (
              <div className="cd-gallery-strip">
                {images.map((src, i) => (
                  <div
                    key={`${src}-${i}`}
                    className={`cd-thumbnail ${i === active ? 'cd-thumbnail-active' : ''}`}
                    onClick={() => setActive(i)}
                  >
                    <img src={src} alt={`${title} ${i + 1}`} loading="lazy" />
                  </div>
                ))}
              </div>
            )}

            <div className="cd-card cd-description-card">
              <div className="cd-section-header">
                <h3 className="cd-section-title">Description</h3>
              </div>
              <div className="cd-description rcd-description-body">
                {description || 'No description provided.'}
              </div>
            </div>

            {specRows.length > 0 && (
              <div className="cd-card">
                <div className="cd-section-header">
                  <h3 className="cd-section-title">
                    {listingType === 'car' ? 'Car Specifications' : 'Details'}
                  </h3>
                </div>
                <div className="cd-specs-list">
                  {specRows.map(([label, value]) => (
                    <div key={label} className="cd-spec-row">
                      <span className="cd-spec-label">{label}</span>
                      <span className="cd-spec-value">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <aside className="cd-hero-right">
            <div className="cd-price-card">
              <span className="cd-price-label">Listed Price</span>
              <div className="cd-price-value">{formatPrice(cfg.price(listing))}</div>

              <div className="cd-badges">
                <span className="cd-badge cd-badge-reddit">Reddit</span>
                {String(listing?.regional_spec || '').includes('GCC') && (
                  <span className="cd-badge cd-badge-success">GCC Specs</span>
                )}
              </div>

              <div className="cd-divider"></div>

              <div className="cd-cta-buttons">
                <RedditSourcePanel car={listing} listingType={listingType} listingId={id} />
                <button type="button" className="cd-button cd-button-secondary" onClick={handleShare}>
                  {shareFeedback || 'Share link'}
                </button>
                <SavedListingToggleButton
                  listingType={listingType}
                  listingId={listing.id || id}
                  listingData={listing}
                  className="saved-listing-button-detail"
                  label="Save listing"
                  showLabel
                />
              </div>
            </div>

            <div className="cd-seller-card">
              <div className="cd-seller-avatar">D</div>
              <div className="cd-seller-info">
                <div className="cd-seller-name">DPH Classifieds</div>
              </div>
              <div className="cd-divider"></div>
              <div className="cd-seller-location">
                <PinIcon />
                {location || 'UAE'}
              </div>
            </div>
          </aside>
        </div>
      </div>
      {lightboxOpen && (
        <ImageLightbox images={images} startIndex={active} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
}
