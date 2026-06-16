import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import SavedListingToggleButton from './SavedListingToggleButton';
import useSwipe from '../hooks/useSwipe';

const LISTING_PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const resolveListingType = (item) => {
  if (item.listingType) return item.listingType;
  const key = String(item.categoryKey || '').toLowerCase();
  if (key === 'cars') return 'car';
  if (key === 'bikes') return 'bike';
  if (key === 'car-parts') return 'part';
  if (key === 'plates') return 'plate';
  return null;
};

const MarketplaceListingCard = ({ item, showMoreLink = true }) => {
  const listingType = resolveListingType(item);
  const listingId = item.id;

  const isCarListing = item?.categoryKey === 'cars';
  const carMetaParts = isCarListing
    ? [
        item?.year ? String(item.year) : null,
        item?.kilometers || item?.kilometers === 0
          ? `${Number(item.kilometers).toLocaleString()} km`
          : null,
        item?.location || null,
      ].filter(Boolean)
    : [];

  const galleryImages = useMemo(() => {
    const arr = Array.isArray(item?.images) ? item.images.filter(Boolean) : [];
    if (arr.length) return arr;
    return item?.image ? [item.image] : [];
  }, [item?.images, item?.image]);

  const hasGallery = galleryImages.length > 1;
  const [imageIndex, setImageIndex] = useState(0);

  const stepImage = (direction) => {
    if (!hasGallery) return;
    setImageIndex((current) => {
      const next = current + direction;
      if (next < 0) return galleryImages.length - 1;
      if (next >= galleryImages.length) return 0;
      return next;
    });
  };

  const swipeRef = useSwipe({
    onSwipeLeft: () => stepImage(1),
    onSwipeRight: () => stepImage(-1),
    enabled: hasGallery,
  });

  return (
    <article
      className="explore-v2-card"
      data-listing-type={item.categoryLabel?.toLowerCase()}
      data-listing-id={item.id}
      data-analytics-event="listing_click"
    >
      {listingType && listingId ? (
        <SavedListingToggleButton
          listingType={listingType}
          listingId={listingId}
          listingData={item}
          className="saved-listing-button-card"
          label="Save listing"
        />
      ) : null}
      <Link to={item.route} state={item.routeState} className="explore-v2-card-media" ref={swipeRef}>
        {galleryImages.length > 0 ? (
          hasGallery ? (
            <div
              className="explore-v2-card-track"
              style={{ transform: `translateX(-${imageIndex * 100}%)` }}
            >
              {galleryImages.map((src, idx) => (
                <img
                  key={`${src}-${idx}`}
                  src={src}
                  alt={`${item.title} — view ${idx + 1}`}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = LISTING_PLACEHOLDER_IMAGE;
                  }}
                />
              ))}
            </div>
          ) : (
            <img
              src={galleryImages[0]}
              alt={item.title}
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = LISTING_PLACEHOLDER_IMAGE;
              }}
            />
          )
        ) : (
          <div className="explore-v2-card-fallback">
            <span>{item.categoryLabel}</span>
            <strong>{item.title}</strong>
          </div>
        )}
        <span className="explore-v2-card-badge">{item.categoryLabel}</span>
        {hasGallery ? (
          <span className="explore-v2-card-photo-count">
            {imageIndex + 1} / {galleryImages.length}
          </span>
        ) : null}
        </Link>

      <div className="explore-v2-card-copy">
        <div className="explore-v2-card-head">
          <div>
            <p className="explore-v2-card-price">{item.priceLabel}</p>
            <h3>
              <Link to={item.route} state={item.routeState}>{item.title}</Link>
            </h3>
          </div>
        </div>

        <p className="explore-v2-card-meta">
          {isCarListing ? carMetaParts.join(' • ') : item.subtitle}
        </p>

        {!isCarListing && item.description ? (
          <p className="explore-v2-card-description">{item.description}</p>
        ) : null}

        <div className="explore-v2-card-actions">
          <Link to={item.route} state={item.routeState} className="explore-v2-button explore-v2-button-primary">
            View Listing
          </Link>
        </div>
      </div>
    </article>
  );
};

export default MarketplaceListingCard;
