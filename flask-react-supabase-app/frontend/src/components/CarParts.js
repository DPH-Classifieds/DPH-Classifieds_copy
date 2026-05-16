import React, { useState, useEffect } from 'react';
import SearchableSelect from './ui/searchable-select';
import { Link } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import { resolveMediaUrl } from '../utils/media';
import '../styles/CarParts.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const LISTING_PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const getListingImageUrl = (part) => {
  const candidate =
    part?.image ||
    part?.display_url ||
    part?.image_url ||
    part?.images?.[0]?.display_url ||
    part?.images?.[0]?.image_url ||
    part?.images?.[0]?.url ||
    null;
  return resolveMediaUrl(candidate);
};

const CarParts = () => {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    query: '',
    category: 'all',
    sortBy: 'newest'
  });

  useEffect(() => {
    const fetchCarParts = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_URL}/api/parts`, {
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch car parts: ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data)) {
          throw new Error('Unexpected response for parts list.');
        }
        setParts(data);
      } catch (err) {
        setError('Failed to load car parts. Please try again later.');
        console.error('Error fetching car parts:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCarParts();
  }, []);

  const handleFilterChange = (event) => {
    const { name, value } = event.target;
    setFilters((prev) => ({
      ...prev,
      [name]: value
    }));
  };

  const getPartCategory = (part) => (part.category || part.part_type || '').trim();

  const availableCategories = Array.from(
    new Set(parts.map((part) => getPartCategory(part)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const filteredParts = [...parts]
    .filter((part) => {
      const query = filters.query.trim().toLowerCase();
      const category = getPartCategory(part);
      const name = (part.name || part.part_name || '').toLowerCase();
      const description = (part.description || '').toLowerCase();

      if (filters.category !== 'all' && category.toLowerCase() !== filters.category.toLowerCase()) {
        return false;
      }

      if (!query) {
        return true;
      }

      return name.includes(query) || description.includes(query) || category.toLowerCase().includes(query);
    })
    .sort((left, right) => {
      const leftPrice = Number(left.price ?? 0);
      const rightPrice = Number(right.price ?? 0);
      const leftDate = new Date(left.created_at || 0);
      const rightDate = new Date(right.created_at || 0);

      switch (filters.sortBy) {
        case 'price-low':
          return leftPrice - rightPrice;
        case 'price-high':
          return rightPrice - leftPrice;
        case 'oldest':
          return leftDate - rightDate;
        case 'newest':
        default:
          return rightDate - leftDate;
      }
    });

  if (loading) {
    return (
      <LoadingSpinner message="Loading car parts..." size="large" />
    );
  }

  if (error) {
    return (
      <div className="car-parts-container error">
        <p className="error-message">{error}</p>
        <button className="retry-button" onClick={() => window.location.reload()}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="car-parts-container">
      <div className="car-parts-header">
        <h1>Car Parts & Accessories</h1>
        <p>Find quality automotive parts for your vehicle</p>
      </div>
      
      <div className="car-parts-filters">
        <div className="search-bar">
          <input
            type="text"
            name="query"
            placeholder="Search parts, brands, or categories..."
            value={filters.query}
            onChange={handleFilterChange}
          />
        </div>
        <div className="filter-options">
          <SearchableSelect
            name="category"
            value={filters.category}
            onChange={handleFilterChange}
          >
            <option value="all">All Categories</option>
            {availableCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </SearchableSelect>
          <SearchableSelect
            name="sortBy"
            value={filters.sortBy}
            onChange={handleFilterChange}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
          </SearchableSelect>
        </div>
      </div>

      <p className="car-parts-results-count">
        {filteredParts.length} part{filteredParts.length === 1 ? '' : 's'} found
      </p>
      
      <div className="car-parts-grid">
        {filteredParts.map(part => (
            <div key={part.id} className="part-card">
            <div className="part-image">
              <img
                src={getListingImageUrl(part) || LISTING_PLACEHOLDER_IMAGE}
                alt={part.name || part.part_name}
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.onerror = null;
                  event.currentTarget.src = LISTING_PLACEHOLDER_IMAGE;
                }}
              />
            </div>
            <div className="part-details">
              <h3>{part.name || part.part_name}</h3>
              {getPartCategory(part) && <p className="part-category">{getPartCategory(part)}</p>}
              {part.description && <p className="part-description">{part.description}</p>}
              <div className="part-price-actions">
                {part.price !== undefined && (
                  <span className="part-price">AED {Number(part.price).toLocaleString()}</span>
                )}
                <div className="part-actions">
                  <Link to={`/car-parts/${part.id}`} className="view-details-btn">
                    View Details
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {filteredParts.length === 0 && (
        <div className="no-parts">
          <p>No car parts found. Please try a different search or check back later.</p>
        </div>
      )}
    </div>
  );
};

export default CarParts; 
