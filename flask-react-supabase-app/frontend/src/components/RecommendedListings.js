import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import MarketplaceListingCard from './MarketplaceListingCard';
import LoadingSpinner from './LoadingSpinner';
import { resolveMediaUrl } from '../utils/media';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const formatPrice = (value) => {
  if (value === null || value === undefined || value === '') {
    return 'Price on request';
  }
  const numericValue = Number(String(value).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(numericValue)) {
    return `${value} AED`;
  }
  return `${numericValue.toLocaleString()} AED`;
};

const normalizeRecommendedCar = (item) => {
  const image = resolveMediaUrl(
    item?.images?.[0]?.display_url ||
      item?.images?.[0]?.image_url ||
      item?.images?.[0]?.url ||
      item?.display_url ||
      item?.image_url ||
      item?.image ||
      item?.main_image_url ||
      null
  );

  const title = `${item?.car_year || item?.make_year || ''} ${item?.car_manufacturer || item?.make || ''} ${item?.car_model || item?.model || ''} ${item?.car_trim || item?.trim || ''}`
    .replace(/\s+/g, ' ')
    .trim() || item?.listing_title || item?.title || 'Recommended listing';

  return {
    id: item.id,
    categoryKey: 'cars',
    categoryLabel: 'Car',
    route: `/cars/${item.id}`,
    title,
    priceLabel: formatPrice(item.expected_selling_price || item.price),
    subtitle: [
      item.kilometer_driven || item.kilometer || item.mileage ? `${Number(item.kilometer_driven || item.kilometer || item.mileage).toLocaleString()} km` : null,
      item.fuel_type || item.fuel || 'Specs pending',
      item.car_city || item.city || 'UAE',
    ].filter(Boolean).join(' • '),
    image,
    createdAt: item.created_at,
    description: item.description || 'Fresh inventory from the UAE marketplace.',
    sellerName: item.seller_name || item.user_name || item.username || 'Marketplace Seller',
    sellerPhoto: resolveMediaUrl(item.seller_photo_url || item.profile_photo_url || item.profilePhotoUrl),
    location: item.car_city || item.city || 'UAE',
  };
};

const RecommendedListings = ({ limit = 8 }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadRecommended = async () => {
      setLoading(true);
      try {
        const response = await axios.get(`${API_URL}/api/cars?limit=${limit}&order=created_at.desc`);
        const payload = response.data;
        const cars = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.cars)
            ? payload.cars
            : [];

        if (active) {
          setItems(cars.map(normalizeRecommendedCar));
        }
      } catch (error) {
        console.error('Error loading recommended listings:', error);
        if (active) {
          setItems([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadRecommended();

    return () => {
      active = false;
    };
  }, [limit]);

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="cn-state-card cn-state-card-light">
          <LoadingSpinner message="Loading recommended listings..." compact />
        </div>
      );
    }

    if (!items.length) {
      return null;
    }

    return (
      <div className="cn-market-grid">
        {items.map((item) => (
          <MarketplaceListingCard key={`recommended-${item.id}`} item={item} showMoreLink={false} />
        ))}
      </div>
    );
  }, [items, loading]);

  if (!content) {
    return null;
  }

  return (
    <section className="cn-explore-section">
      <div className="cn-shell">
        <div className="cn-section-heading cn-section-heading-dark">
          <div>
            <span className="cn-kicker">Recommended</span>
            <h2>Fresh listings worth a look.</h2>
          </div>
        </div>
        {content}
      </div>
    </section>
  );
};

export default RecommendedListings;
