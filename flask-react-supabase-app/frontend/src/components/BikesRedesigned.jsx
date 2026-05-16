import React, { useState, useEffect, useMemo } from 'react';
import SearchableSelect from './ui/searchable-select';
import { Link } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import { resolveMediaUrl } from '../utils/media';
import { fetchJsonWithCache, readJsonSessionCache } from '../utils/fetchCache';
import './BikesRedesigned.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const LISTING_PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const BikesRedesigned = () => {
  const [bikes, setBikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    type: 'all',
    brand: 'all',
    priceMin: '',
    priceMax: '',
    yearMin: '',
    yearMax: '',
    engineMin: '',
    engineMax: '',
    cylinders: 'all',
    wheels: 'all',
    sortBy: 'newest'
  });

  const getImageUrl = (image) => {
    if (!image) return null;

    if (typeof image === 'string') {
      return resolveMediaUrl(image);
    }

    const imageUrl = image.display_url || image.image_url || image.url;
    return resolveMediaUrl(imageUrl);
  };

  useEffect(() => {
    const fetchBikes = async () => {
      try {
        const url = `${API_URL}/api/bikes`;
        const cached = readJsonSessionCache(url);
        if (Array.isArray(cached)) {
          setBikes(cached);
          setLoading(false);
        } else {
          setLoading(true);
        }

        const response = await fetchJsonWithCache(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch bikes: ${response.status}`);
        }
        if (!Array.isArray(response.data)) {
          throw new Error('Unexpected response for bikes list.');
        }
        setBikes(response.data);
        setError(null);
      } catch (err) {
        console.error('Error fetching bikes:', err);
        setError('Failed to load bikes. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchBikes();
  }, []);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    const numericMinZeroFields = ['priceMin', 'priceMax', 'engineMin', 'engineMax'];
    const numericYearFields = ['yearMin', 'yearMax'];

    let sanitizedValue = value;
    if (numericMinZeroFields.includes(name) && value !== '') {
      const parsedValue = Number(value);
      sanitizedValue = Number.isNaN(parsedValue) ? '' : Math.max(0, parsedValue);
    }
    if (numericYearFields.includes(name) && value !== '') {
      const parsedValue = Number(value);
      sanitizedValue = Number.isNaN(parsedValue) ? '' : Math.max(1886, parsedValue);
    }

    setFilters(prev => ({
      ...prev,
      [name]: sanitizedValue
    }));
  };

  const applyFilters = () => {
    return bikes.filter(bike => {
      const bikePrice = Number(bike.price ?? bike.expected_selling_price ?? 0);

      if (filters.type !== 'all' && bike.bike_type !== filters.type && bike.type !== filters.type) {
        return false;
      }

      if (filters.brand !== 'all' && 
          bike.make !== filters.brand && 
          bike.manufacturer !== filters.brand && 
          bike.bike_brand !== filters.brand) {
        return false;
      }

      if (filters.priceMin && bikePrice < Number(filters.priceMin)) {
        return false;
      }

      if (filters.priceMax && bikePrice > Number(filters.priceMax)) {
        return false;
      }

      if (filters.yearMin) {
        const year = Number(bike.year ?? bike.make_year);
        if (year < Number(filters.yearMin)) {
          return false;
        }
      }

      if (filters.yearMax) {
        const year = Number(bike.year ?? bike.make_year);
        if (year > Number(filters.yearMax)) {
          return false;
        }
      }

      if (filters.engineMin) {
        const engine = Number(bike.engine ?? bike.engine_size ?? bike.engine_capacity ?? 0);
        if (engine < Number(filters.engineMin)) {
          return false;
        }
      }

      if (filters.engineMax) {
        const engine = Number(bike.engine ?? bike.engine_size ?? bike.engine_capacity ?? 0);
        if (engine > Number(filters.engineMax)) {
          return false;
        }
      }

      if (filters.cylinders !== 'all' && bike.cylinders !== Number(filters.cylinders)) {
        return false;
      }

      if (filters.wheels !== 'all' && bike.wheels !== Number(filters.wheels)) {
        return false;
      }

      return true;
    }).sort((a, b) => {
      const aPrice = Number(a.price ?? a.expected_selling_price ?? 0);
      const bPrice = Number(b.price ?? b.expected_selling_price ?? 0);
      const aYear = Number(a.year ?? a.make_year ?? 0);
      const bYear = Number(b.year ?? b.make_year ?? 0);
      const aDate = new Date(a.created_at || 0);
      const bDate = new Date(b.created_at || 0);

      switch (filters.sortBy) {
        case 'price-low':
          return aPrice - bPrice;
        case 'price-high':
          return bPrice - aPrice;
        case 'year-new':
          return aYear - bYear;
        case 'year-old':
          return bYear - aYear;
        case 'newest':
        default:
          return bDate - aDate;
      }
    });
  };

  const filteredBikes = applyFilters();
  const availableBrands = useMemo(() => {
    const brands = bikes
      .map((bike) => bike.make || bike.manufacturer || bike.bike_brand || '')
      .filter(Boolean);
    return Array.from(new Set(brands)).sort((a, b) => a.localeCompare(b));
  }, [bikes]);

  if (loading) {
    return <LoadingSpinner message="Loading bikes..." size="large" />;
  }

  if (error) {
    return (
      <div className="biked-error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()} className="biked-back-button">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="biked-container">
      <div className="biked-max-width">
        <div className="biked-header">
          <h1 className="biked-title">Motorcycles</h1>
          <p className="biked-subtitle">Browse our extensive collection of motorcycles</p>
        </div>

        <div className="biked-filters">
          <div className="biked-filter-row">
            <div className="biked-filter-group">
              <label htmlFor="type">Type</label>
              <SearchableSelect 
                id="type" 
                name="type" 
                value={filters.type} 
                onChange={handleFilterChange}
              >
                <option value="all">All Types</option>
                <option value="Sport">Sport</option>
                <option value="Cruiser">Cruiser</option>
                <option value="Adventure">Adventure</option>
                <option value="Naked">Naked</option>
                <option value="Touring">Touring</option>
                <option value="Off-road">Off-road</option>
                <option value="Dual Sport">Dual Sport</option>
                <option value="Scooter">Scooter</option>
                <option value="Commuter">Commuter</option>
                <option value="Electric">Electric</option>
              </SearchableSelect>
            </div>

            <div className="biked-filter-group">
              <label htmlFor="brand">Brand</label>
              <SearchableSelect 
                id="brand" 
                name="brand" 
                value={filters.brand} 
                onChange={handleFilterChange}
              >
                <option value="all">All Brands</option>
                {availableBrands.map((brand) => (
                  <option key={brand} value={brand}>{brand}</option>
                ))}
              </SearchableSelect>
            </div>

            <div className="biked-filter-group">
              <label htmlFor="sortBy">Sort</label>
              <SearchableSelect 
                id="sortBy" 
                name="sortBy" 
                value={filters.sortBy} 
                onChange={handleFilterChange}
              >
                <option value="newest">Newest</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="year-new">Year: Newest First</option>
                <option value="year-old">Year: Oldest First</option>
              </SearchableSelect>
            </div>
          </div>

          <div className="biked-filter-row">
            <div className="biked-filter-group">
              <label htmlFor="priceMin">Min Price (AED)</label>
              <input 
                type="number" 
                id="priceMin" 
                name="priceMin" 
                placeholder="Min Price" 
                value={filters.priceMin} 
                onChange={handleFilterChange}
                min="0"
              />
            </div>

            <div className="biked-filter-group">
              <label htmlFor="priceMax">Max Price (AED)</label>
              <input 
                type="number" 
                id="priceMax" 
                name="priceMax" 
                placeholder="Max Price" 
                value={filters.priceMax} 
                onChange={handleFilterChange}
                min="0"
              />
            </div>

            <div className="biked-filter-group">
              <label htmlFor="yearMin">Min Year</label>
              <input 
                type="number" 
                id="yearMin" 
                name="yearMin" 
                placeholder="Min Year" 
                value={filters.yearMin} 
                onChange={handleFilterChange}
                min="1886"
              />
            </div>

            <div className="biked-filter-group">
              <label htmlFor="yearMax">Max Year</label>
              <input 
                type="number" 
                id="yearMax" 
                name="yearMax" 
                placeholder="Max Year" 
                value={filters.yearMax} 
                onChange={handleFilterChange}
                max={new Date().getFullYear()}
              />
            </div>
          </div>

          <div className="biked-filter-row">
            <div className="biked-filter-group">
              <label htmlFor="engineMin">Min Engine (cc)</label>
              <input 
                type="number" 
                id="engineMin" 
                name="engineMin" 
                placeholder="e.g., 250" 
                value={filters.engineMin} 
                onChange={handleFilterChange}
                min="0"
              />
            </div>

            <div className="biked-filter-group">
              <label htmlFor="engineMax">Max Engine (cc)</label>
              <input 
                type="number" 
                id="engineMax" 
                name="engineMax" 
                placeholder="e.g., 1200" 
                value={filters.engineMax} 
                onChange={handleFilterChange}
                min="0"
              />
            </div>

            <div className="biked-filter-group">
              <label htmlFor="cylinders">Cylinders</label>
              <SearchableSelect 
                id="cylinders" 
                name="cylinders" 
                value={filters.cylinders} 
                onChange={handleFilterChange}
              >
                <option value="all">All Cylinders</option>
                <option value="1">1 Cylinder</option>
                <option value="2">2 Cylinders</option>
                <option value="3">3 Cylinders</option>
                <option value="4">4 Cylinders</option>
                <option value="6">6 Cylinders</option>
              </SearchableSelect>
            </div>

            <div className="biked-filter-group">
              <label htmlFor="wheels">Wheels</label>
              <SearchableSelect 
                id="wheels" 
                name="wheels" 
                value={filters.wheels} 
                onChange={handleFilterChange}
              >
                <option value="all">All</option>
                <option value="2">2 Wheels</option>
                <option value="3">3 Wheels (Trike)</option>
              </SearchableSelect>
            </div>
          </div>
        </div>

        <div className="biked-results">
          <span className="biked-results-count">{filteredBikes.length} motorcycles</span>
        </div>

        <div className="biked-grid">
          {filteredBikes.length > 0 ? (
            filteredBikes.map(bike => (
              <div key={bike.id} className="biked-card">
                <div className="biked-card-image">
                  {bike.images && bike.images.length > 0 ? (
                    <img 
                      src={getImageUrl(bike.images[0])} 
                      alt={`${bike.make || bike.manufacturer || ''} ${bike.model || ''}`}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = LISTING_PLACEHOLDER_IMAGE;
                      }}
                    />
                  ) : (
                    <div className="biked-no-image">No Image Available</div>
                  )}
                  <div className="biked-price">AED {Number(bike.price ?? bike.expected_selling_price ?? 0).toLocaleString()}</div>
                </div>

                <div className="biked-card-content">
                  <h3 className="biked-card-title">{bike.title || `${bike.make || bike.manufacturer || ''} ${bike.model || ''} ${bike.year || bike.make_year || ''}`.trim()}</h3>
                  <div className="biked-card-specs">
                    <span className="biked-spec-year">{bike.year || bike.make_year || 'N/A'}</span>
                    <span className="biked-spec-engine">{bike.engine || bike.engine_size || bike.engine_capacity || 'N/A'}</span>
                  </div>
                  <p className="biked-card-location">{bike.location || 'Location N/A'}</p>
                  <Link to={`/bikes/${bike.id}`} className="biked-view-button">
                    View Details
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <div className="biked-no-results">
              <h3>No motorcycles found</h3>
              <p>No motorcycles match your current filters. Please try different criteria.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BikesRedesigned;
