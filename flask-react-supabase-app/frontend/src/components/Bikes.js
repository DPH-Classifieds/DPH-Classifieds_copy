import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/Bikes.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Bikes = () => {
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
  // Helper function to get proper image URL
  const getImageUrl = (image) => {
    if (!image) return null;

    if (typeof image === 'string') {
      return image.startsWith('/') ? `${API_URL}${image}` : image;
    }
    
    // Try all possible image URL fields
    const imageUrl = image.image_url || image.url;
    
    // Check if the URL is a relative URL that needs the API base URL
    if (imageUrl && imageUrl.startsWith('/')) {
      return `${API_URL}${imageUrl}`;
    }
    
    return imageUrl;
  };

  useEffect(() => {
    const fetchBikes = async () => {
      try {
        setLoading(true);
        // Fetch bikes from the API
        const response = await apiClient.get('/api/bikes');
        console.log('Bikes API response:', response);
        
        if (!Array.isArray(response)) {
          throw new Error('Unexpected response for bikes list.');
        }
        setBikes(response);
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
      const bikeYear = Number(bike.year ?? bike.make_year ?? 0);

      // Apply bike type filter
      if (filters.type !== 'all' && bike.type !== filters.type && bike.bike_category !== filters.type) {
        return false;
      }
      
      // Apply brand filter
      if (filters.brand !== 'all') {
        const bikeBrand = bike.make || bike.manufacturer || bike.bike_brand || '';
        if (bikeBrand.toLowerCase() !== filters.brand.toLowerCase()) {
          return false;
        }
      }
      
      // Apply price min filter
      if (filters.priceMin && bikePrice < Number(filters.priceMin)) {
        return false;
      }
      
      // Apply price max filter
      if (filters.priceMax && bikePrice > Number(filters.priceMax)) {
        return false;
      }
      
      // Apply year min filter
      if (filters.yearMin && bikeYear < Number(filters.yearMin)) {
        return false;
      }
      
      // Apply year max filter
      if (filters.yearMax && bikeYear > Number(filters.yearMax)) {
        return false;
      }
      
      // Apply engine size min filter
      if (filters.engineMin) {
        const engineSize = parseInt((bike.engine || bike.engine_capacity || '0').replace(/\D/g, ''));
        if (engineSize < Number(filters.engineMin)) {
          return false;
        }
      }
      
      // Apply engine size max filter
      if (filters.engineMax) {
        const engineSize = parseInt((bike.engine || bike.engine_capacity || '0').replace(/\D/g, ''));
        if (engineSize > Number(filters.engineMax)) {
          return false;
        }
      }
      
      // Apply cylinders filter
      if (filters.cylinders !== 'all' && bike.cylinders && bike.cylinders !== Number(filters.cylinders)) {
        return false;
      }
      
      // Apply wheels filter
      if (filters.wheels !== 'all' && bike.wheels && bike.wheels !== Number(filters.wheels)) {
        return false;
      }
      
      return true;
    }).sort((a, b) => {
      // Apply sorting
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
          return bYear - aYear;
        case 'year-old':
          return aYear - bYear;
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
      <div className="bikes-container error">
        <p className="error-message">{error}</p>
        <button className="retry-button" onClick={() => window.location.reload()}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="bikes-container">
      <div className="bikes-header">
        <h1>Motorcycle Listings</h1>
        <p>Find your perfect ride from our extensive collection of motorcycles</p>
      </div>
      
      <div className="bikes-filters">
        <div className="filter-row">
          <div className="filter-group">
            <label htmlFor="type">Bike Type</label>
            <select 
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
            </select>
          </div>
          
          <div className="filter-group">
            <label htmlFor="brand">Brand</label>
            <select 
              id="brand" 
              name="brand" 
              value={filters.brand} 
              onChange={handleFilterChange}
            >
              <option value="all">All Brands</option>
              {availableBrands.map((brand) => (
                <option key={brand} value={brand}>{brand}</option>
              ))}
            </select>
          </div>
          
          <div className="filter-group">
            <label htmlFor="sortBy">Sort By</label>
            <select 
              id="sortBy" 
              name="sortBy" 
              value={filters.sortBy} 
              onChange={handleFilterChange}
            >
              <option value="newest">Newest Listing</option>
              <option value="price-low">Price: Low to High</option>
              <option value="price-high">Price: High to Low</option>
              <option value="year-new">Year: Newest First</option>
              <option value="year-old">Year: Oldest First</option>
            </select>
          </div>
        </div>
        
        <div className="filter-row">
          <div className="filter-group">
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
          
          <div className="filter-group">
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
          
          <div className="filter-group">
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
          
          <div className="filter-group">
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
        
        <div className="filter-row">
          <div className="filter-group">
            <label htmlFor="engineMin">Min Engine Size (cc)</label>
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
          
          <div className="filter-group">
            <label htmlFor="engineMax">Max Engine Size (cc)</label>
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
          
          <div className="filter-group">
            <label htmlFor="cylinders">Cylinders</label>
            <select 
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
            </select>
          </div>
          
          <div className="filter-group">
            <label htmlFor="wheels">Wheels</label>
            <select 
              id="wheels" 
              name="wheels" 
              value={filters.wheels} 
              onChange={handleFilterChange}
            >
              <option value="all">All</option>
              <option value="2">2 Wheels</option>
              <option value="3">3 Wheels (Trike)</option>
            </select>
          </div>
        </div>
      </div>
      
      <div className="bikes-results">
        <div className="results-count">
          Showing {filteredBikes.length} motorcycles
        </div>
        
        <div className="bikes-grid">
          {filteredBikes.length > 0 ? (
            filteredBikes.map(bike => (
              <div key={bike.id} className="bike-card">
                <div className="bike-image">
                  {bike.images && bike.images.length > 0 ? (
                    <img 
                      src={getImageUrl(bike.images[0])} 
                      alt={`${bike.make || bike.manufacturer || ''} ${bike.model || ''}`.trim() || 'Bike'}
                      onError={(e) => {
                        console.error("Image failed to load:", e.target.src);
                        e.target.onerror = null;
                        e.target.src = "https://via.placeholder.com/600x400?text=No+Image+Available";
                      }}
                    />
                  ) : bike.image ? (
                    <img 
                      src={bike.image} 
                      alt={`${bike.make || bike.manufacturer || ''} ${bike.model || ''}`.trim() || 'Bike'}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = "https://via.placeholder.com/600x400?text=No+Image+Available";
                      }}
                    />
                  ) : (
                    <div className="no-image">No Image Available</div>
                  )}
                  <div className="bike-price">
                    AED {Number(bike.price ?? bike.expected_selling_price ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className="bike-details">
                  <h3>{bike.title || `${bike.make || bike.manufacturer || ''} ${bike.model || ''} ${bike.year || bike.make_year || ''}`.trim()}</h3>
                  <div className="bike-specs">
                    <span className="bike-year">{bike.year || bike.make_year || 'N/A'}</span>
                    <span className="bike-engine">{bike.engine || bike.engine_size || bike.engine_capacity || 'N/A'}</span>
                    <span className="bike-mileage">{Number(bike.mileage || bike.kilometer_driven || 0).toLocaleString()} km</span>
                  </div>
                  <div className="bike-location">{bike.location || 'Location N/A'}</div>
                  {bike.description && (
                    <p className="bike-description">{bike.description.substring(0, 120)}...</p>
                  )}
                  <div className="bike-actions">
                    <Link to={`/bikes/${bike.id}`} className="view-details-btn">
                      View Details
                    </Link>
                    <button className="save-btn">Save</button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="no-bikes">
              <p>No motorcycles match your current filters. Please try different criteria.</p>
            </div>
          )}
        </div>
      </div>
      
      <div className="bike-sell-cta">
        <div className="cta-content">
          <h2>Sell Your Motorcycle</h2>
          <p>List your motorcycle for free and reach thousands of interested buyers.</p>
          <Link to="/post-bike" className="sell-bike-btn">Post Your Motorcycle</Link>
        </div>
      </div>
    </div>
  );
};

export default Bikes; 
