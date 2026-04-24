import React from 'react';
import { Link } from 'react-router-dom';

const LISTING_PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const MarketplaceListingCard = ({ item }) => {
  const sellerName = item.sellerName || 'Marketplace Seller';
  const sellerInitial = sellerName.charAt(0).toUpperCase();
  const moreRoute =
    item.moreRoute ||
    (item.categoryKey === 'cars'
      ? '/cars'
      : item.categoryKey === 'car-parts'
        ? '/car-parts'
        : item.categoryKey === 'plates'
          ? '/plates'
          : '/bikes');

  return (
    <article className="explore-v2-card">
      <Link to={item.route} className="explore-v2-card-media">
        {item.image ? (
          <img
            src={item.image}
            alt={item.title}
            loading="lazy"
            decoding="async"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = LISTING_PLACEHOLDER_IMAGE;
            }}
          />
        ) : (
          <div className="explore-v2-card-fallback">
            <span>{item.categoryLabel}</span>
            <strong>{item.title}</strong>
          </div>
        )}
        <span className="explore-v2-card-badge">{item.categoryLabel}</span>
      </Link>

      <div className="explore-v2-card-copy">
        <div className="explore-v2-card-head">
          <div>
            <p className="explore-v2-card-price">{item.priceLabel}</p>
            <h3>
              <Link to={item.route}>{item.title}</Link>
            </h3>
          </div>
        </div>

        <p className="explore-v2-card-meta">{item.subtitle}</p>
        <p className="explore-v2-card-description">{item.description}</p>

        <div className="explore-v2-seller-row">
          <div className="explore-v2-seller">
            {item.sellerPhoto ? (
              <span className="explore-v2-seller-avatar">
                <img
                  src={item.sellerPhoto}
                  alt={`${sellerName} profile`}
                  className="explore-v2-seller-avatar-image"
                />
              </span>
            ) : (
              <span className="explore-v2-seller-avatar">{sellerInitial}</span>
            )}
            <div>
              <strong>{sellerName}</strong>
              <span>{item.location || 'UAE'}</span>
            </div>
          </div>
        </div>

        <div className="explore-v2-card-actions">
          <Link to={item.route} className="explore-v2-button explore-v2-button-primary">
            View Listing
          </Link>
          <Link to={moreRoute} className="explore-v2-card-link">
            More {item.categoryLabel}s
          </Link>
        </div>
      </div>
    </article>
  );
};

export default MarketplaceListingCard;
