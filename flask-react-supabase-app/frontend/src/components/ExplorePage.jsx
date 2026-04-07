import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import { carMakes, carModels } from '../utils/carData';
import './ExplorePage.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const ecosystemCards = [
  {
    title: 'Curated listings',
    description: 'See the freshest cars first with a layout focused on condition, seller context, and route-to-detail speed.'
  },
  {
    title: 'Seller signals',
    description: 'Follow sellers, save promising inventory, and surface verified or high-activity accounts faster.'
  },
  {
    title: 'UAE-ready filters',
    description: 'Browse by make, model, emirate, and price without leaving the main explore surface.'
  }
];

const ExplorePage = () => {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedListings, setSavedListings] = useState([]);
  const [followingSellers, setFollowingSellers] = useState([]);
  const [filters, setFilters] = useState({
    car_manufacturer: '',
    car_model: '',
    car_city: '',
    price_from: '',
    price_to: ''
  });

  const [availableModels, setAvailableModels] = useState([]);
  const emirates = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];

  useEffect(() => {
    fetchCars();
    fetchUserPreferences();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchCars = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          params.append(key, value);
        }
      });

      const queryString = params.toString() ? `?${params.toString()}` : '';
      const response = await axios.get(`${API_URL}/api/cars${queryString}`);
      const carsData = Array.isArray(response.data)
        ? response.data
        : Array.isArray(response.data?.cars)
          ? response.data.cars
          : [];

      setCars(carsData);
    } catch (err) {
      console.error('Error fetching cars:', err);
      setError('Failed to load cars. Please check if the API is running.');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserPreferences = async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        return;
      }

      const response = await axios.get(`${API_URL}/api/user/preferences`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data) {
        setSavedListings(response.data.saved_listings || []);
        setFollowingSellers(response.data.following_sellers || []);
      }
    } catch (err) {
      console.error('Error fetching user preferences:', err);
    }
  };

  const handleFilterChange = (event) => {
    const { name, value } = event.target;

    if (name === 'car_manufacturer') {
      const models = carModels[value] || [];
      setAvailableModels(models);
      setFilters((prev) => ({ ...prev, car_manufacturer: value, car_model: '' }));
      return;
    }

    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const resetFilters = () => {
    setAvailableModels([]);
    setFilters({
      car_manufacturer: '',
      car_model: '',
      car_city: '',
      price_from: '',
      price_to: ''
    });
  };

  const formatPrice = (price) => {
    const numericPrice = Number.parseInt(price, 10);
    if (!numericPrice) {
      return 'Price on request';
    }

    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      maximumFractionDigits: 0
    }).format(numericPrice);
  };

  const formatMileage = (car) => {
    const rawMileage = car.kilometer_driven || car.kilometer || car.mileage;
    const mileage = Number.parseInt(rawMileage, 10);

    if (!mileage) {
      return 'Mileage on request';
    }

    if (mileage >= 1000) {
      return `${(mileage / 1000).toFixed(1)}k km`;
    }

    return `${mileage} km`;
  };

  const getTitle = (car) => {
    const composed = [
      car.make_year || car.car_year,
      car.car_manufacturer || car.make,
      car.car_model || car.model,
      car.trim || car.car_trim
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    return composed || car.listing_title || car.title || 'Untitled listing';
  };

  const getImageUrl = (car) => {
    const firstImage = car.images?.[0];
    const imageUrl = firstImage?.image_url || firstImage?.url || car.image_url || car.main_image_url || null;

    if (imageUrl && imageUrl.startsWith('/')) {
      return `${API_URL}${imageUrl}`;
    }

    return imageUrl;
  };

  const getLocation = (car) => car.car_city || car.city || 'UAE';
  const getFuelType = (car) => car.fuel_type || car.fuel || 'Specs pending';

  const toggleSaveListing = async (carId) => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        alert('Please log in to save listings');
        return;
      }

      const isSaved = savedListings.includes(carId);
      const action = isSaved ? 'unsave' : 'save';

      await axios.post(
        `${API_URL}/api/listings/${carId}/${action}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSavedListings((prev) => (
        isSaved ? prev.filter((id) => id !== carId) : [...prev, carId]
      ));
    } catch (err) {
      console.error('Error toggling save:', err);
    }
  };

  const toggleFollowSeller = async (sellerId) => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) {
        alert('Please log in to follow sellers');
        return;
      }

      const isFollowing = followingSellers.includes(sellerId);
      const action = isFollowing ? 'unfollow' : 'follow';

      await axios.post(
        `${API_URL}/api/sellers/${sellerId}/${action}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setFollowingSellers((prev) => (
        isFollowing ? prev.filter((id) => id !== sellerId) : [...prev, sellerId]
      ));
    } catch (err) {
      console.error('Error toggling follow:', err);
    }
  };

  const hasActiveFilters = Object.values(filters).some(Boolean);

  return (
    <div className="explore-v2">
      <section className="explore-v2-hero">
        <div className="explore-v2-shell">
          <div className="explore-v2-hero-copy">
            <span className="explore-v2-kicker">Explore Marketplace</span>
            <h1>Filter the UAE market without losing the luxury feel.</h1>
            <p>
              A browse-first experience for serious buyers. Find the right car faster, then move straight
              into the live detail pages when something is worth your attention.
            </p>
          </div>

          <div className="explore-v2-hero-stats">
            <div className="explore-v2-stat">
              <strong>{cars.length}</strong>
              <span>Live results</span>
            </div>
            <div className="explore-v2-stat">
              <strong>{savedListings.length}</strong>
              <span>Saved listings</span>
            </div>
            <div className="explore-v2-stat">
              <strong>{followingSellers.length}</strong>
              <span>Followed sellers</span>
            </div>
          </div>
        </div>
      </section>

      <section className="explore-v2-brand-marquee">
        <div className="explore-v2-shell">
          <div className="explore-v2-brand-marquee-track">
            {[...carMakes, ...carMakes].map((make, index) => (
              <span key={`${make}-${index}`} className="explore-v2-brand-item">
                {make}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="explore-v2-feature-band">
        <div className="explore-v2-shell explore-v2-feature-grid">
          {ecosystemCards.map((card) => (
            <article key={card.title} className="explore-v2-feature-card">
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="explore-v2-shell explore-v2-filter-section">
        <div className="explore-v2-filter-header">
          <div>
            <span className="explore-v2-kicker">Filter Inventory</span>
            <h2>Shape the results before you scroll.</h2>
          </div>
          <p>
            Choose a make, narrow the model list, and focus the market down by emirate or pricing.
          </p>
        </div>

        <div className="explore-v2-filter-panel">
          <div className="explore-v2-filter-grid">
            <label className="explore-v2-field">
              <span>Make</span>
              <select
                id="car_manufacturer"
                name="car_manufacturer"
                value={filters.car_manufacturer}
                onChange={handleFilterChange}
              >
                <option value="">All Makes</option>
                {carMakes.map((make) => (
                  <option key={make} value={make}>
                    {make}
                  </option>
                ))}
              </select>
            </label>

            <label className="explore-v2-field">
              <span>Model</span>
              <select
                id="car_model"
                name="car_model"
                value={filters.car_model}
                onChange={handleFilterChange}
                disabled={!filters.car_manufacturer}
              >
                <option value="">All Models</option>
                {availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>

            <label className="explore-v2-field">
              <span>Emirate</span>
              <select
                id="car_city"
                name="car_city"
                value={filters.car_city}
                onChange={handleFilterChange}
              >
                <option value="">All Emirates</option>
                {emirates.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>

            <label className="explore-v2-field">
              <span>Price From</span>
              <input
                type="number"
                id="price_from"
                name="price_from"
                value={filters.price_from}
                onChange={handleFilterChange}
                placeholder="Min AED"
                min="0"
              />
            </label>

            <label className="explore-v2-field">
              <span>Price To</span>
              <input
                type="number"
                id="price_to"
                name="price_to"
                value={filters.price_to}
                onChange={handleFilterChange}
                placeholder="Max AED"
                min="0"
              />
            </label>
          </div>

          <div className="explore-v2-filter-actions">
            <button type="button" className="explore-v2-button explore-v2-button-primary" onClick={fetchCars}>
              Apply Filters
            </button>
            <button type="button" className="explore-v2-button explore-v2-button-secondary" onClick={resetFilters}>
              Reset
            </button>
            {hasActiveFilters ? (
              <span className="explore-v2-filter-note">Filters are set and ready to refine the grid.</span>
            ) : (
              <span className="explore-v2-filter-note">No filters applied yet. You are seeing the wider market.</span>
            )}
          </div>
        </div>
      </section>

      <section className="explore-v2-shell explore-v2-results-section">
        <div className="explore-v2-results-header">
          <div>
            <span className="explore-v2-kicker">Inventory Feed</span>
            <h2>Current results</h2>
          </div>
          <p>{loading ? 'Loading the latest results...' : `${cars.length} listings currently in view.`}</p>
        </div>

        {loading ? (
          <div className="explore-v2-state-card">
            <LoadingSpinner message="Loading cars..." compact />
          </div>
        ) : error ? (
          <div className="explore-v2-state-card explore-v2-state-card-error">
            <p>{error}</p>
            <button type="button" className="explore-v2-button explore-v2-button-primary" onClick={fetchCars}>
              Retry
            </button>
          </div>
        ) : cars.length === 0 ? (
          <div className="explore-v2-state-card">
            <p>No cars matched the current filters.</p>
            <button type="button" className="explore-v2-button explore-v2-button-secondary" onClick={resetFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="explore-v2-grid">
            {cars.map((car) => {
              const sellerId = car.seller_id;
              const sellerInitial = (car.seller_name || car.user_name || 'U').charAt(0).toUpperCase();
              const isSaved = savedListings.includes(car.id);
              const isFollowing = sellerId ? followingSellers.includes(sellerId) : false;

              return (
                <article key={car.id} className="explore-v2-card">
                  <Link to={`/cars/${car.id}`} className="explore-v2-card-media">
                    {getImageUrl(car) ? (
                      <img
                        src={getImageUrl(car)}
                        alt={getTitle(car)}
                        onError={(event) => {
                          event.currentTarget.src = 'https://via.placeholder.com/800x600?text=Image+Unavailable';
                        }}
                      />
                    ) : (
                      <div className="explore-v2-card-placeholder">Image unavailable</div>
                    )}

                    {car.verified ? <span className="explore-v2-card-badge">Verified</span> : null}
                    {car.featured ? <span className="explore-v2-card-badge explore-v2-card-badge-right">Featured</span> : null}
                  </Link>

                  <div className="explore-v2-card-copy">
                    <div className="explore-v2-card-head">
                      <div>
                        <p className="explore-v2-card-price">{formatPrice(car.expected_selling_price || car.price)}</p>
                        <h3>
                          <Link to={`/cars/${car.id}`}>{getTitle(car)}</Link>
                        </h3>
                      </div>
                      <button
                        type="button"
                        className={`explore-v2-icon-button ${isSaved ? 'is-active' : ''}`}
                        onClick={() => toggleSaveListing(car.id)}
                        aria-label={isSaved ? 'Unsave listing' : 'Save listing'}
                      >
                        {isSaved ? 'Saved' : 'Save'}
                      </button>
                    </div>

                    <p className="explore-v2-card-meta">
                      <span>{formatMileage(car)}</span>
                      <span>•</span>
                      <span>{getFuelType(car)}</span>
                      <span>•</span>
                      <span>{getLocation(car)}</span>
                    </p>

                    {car.price_insight ? (
                      <div className="explore-v2-price-insight">{car.price_insight}</div>
                    ) : null}

                    <div className="explore-v2-seller-row">
                      <div className="explore-v2-seller">
                        <span className="explore-v2-seller-avatar">{sellerInitial}</span>
                        <div>
                          <strong>{car.seller_name || 'Anonymous seller'}</strong>
                          <span>{car.seller_verified ? 'Seller verified' : 'Marketplace seller'}</span>
                        </div>
                      </div>

                      {sellerId ? (
                        <button
                          type="button"
                          className={`explore-v2-follow ${isFollowing ? 'is-following' : ''}`}
                          onClick={() => toggleFollowSeller(sellerId)}
                        >
                          {isFollowing ? 'Following' : 'Follow'}
                        </button>
                      ) : null}
                    </div>

                    <div className="explore-v2-card-actions">
                      <Link to={`/cars/${car.id}`} className="explore-v2-button explore-v2-button-primary">
                        View Car
                      </Link>
                      <button type="button" className="explore-v2-button explore-v2-button-secondary">
                        Message
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default ExplorePage;
