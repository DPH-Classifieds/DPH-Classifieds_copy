import React, { useState, useEffect } from 'react';
import SearchableSelect from './ui/searchable-select';
import { Link } from 'react-router-dom';
import UAELicensePlate from './UAELicensePlate';
import ListingSkeleton from './ListingSkeleton';
import { fetchJsonWithCache, readJsonSessionCache } from '../utils/fetchCache';
import BrowseSellCta from './BrowseSellCta';
import './PlatesRedesigned.css';
import { buildListingRouteState } from '../utils/listingRouteState';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const LIST_PAGE_SIZE = 24;

const PlatesRedesigned = () => {
  const [plates, setPlates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    city: 'All cities',
    code: 'All codes',
    digits: '',
    contains: '',
    priceMin: '',
    priceMax: '',
    startsWith: '',
    endsWith: '',
    format: 'Any format',
    sortBy: 'newest'
  });

  const cityOptions = [
    'All cities',
    'Dubai',
    'Abu Dhabi',
    'Sharjah',
    'Ajman',
    'Ras Al Khaimah',
    'Fujairah',
    'Umm Al Quwain'
  ];

  const formatOptions = [
    'Any format',
    'Contains digit repeated 2 times',
    'Contains digit repeated 3 times',
    'Contains digit repeated 4 times',
    'x????x (5 Digits)',
    'xyzyx (5 Digits)',
    'xxxX (5 Digits)',
    '???xxx (5 Digits)',
    'XXX?? (5 Digits)',
    'x??X (4 Digits)',
    'xyyx (4 Digits)',
    'xyxy (4 Digits)',
    '??xx? (4 Digits)',
    'xxxy (4 Digits)',
    'ХУУУ (4 Digits)',
    'XXXX (4 Digits)',
    'xyx (3 Digits)',
    'xyy (3 Digits)',
    'xyy (3 Digits)',
    '???xx? (5 Digits)',
    'xXXXx (5 Digits)',
    'x??X (3 Digits)',
    'xyyx (4 Digits)',
    'xyxy (4 Digits)',
    'xyy (3 Digits)',
    'xyy (3 Digits)',
    '???xx? (4 Digits)',
    'xxxy (4 Digits)',
    'ХУУУ (4 Digits)',
    'XXXX (3 Digits)',
    'xyy (3 Digits)'
  ];

  useEffect(() => {
    const fetchPlates = async ({ reset = true, offset = 0 } = {}) => {
      try {
        const url = `${API_URL}/api/plates?limit=${LIST_PAGE_SIZE}&offset=${Math.max(0, offset)}&order=created_at.desc`;
        const cached = readJsonSessionCache(url);
        if (Array.isArray(cached)) {
          const cachedApproved = cached.filter((plate) => plate.status === 'approved');
          setHasMore(cachedApproved.length === LIST_PAGE_SIZE);
          setPlates((prev) => (reset ? cachedApproved : [...prev, ...cachedApproved]));
        }

        const response = await fetchJsonWithCache(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch plates: ${response.status}`);
        }

        const data = response.data;

        if (!Array.isArray(data)) {
          throw new Error('Unexpected response for plates list.');
        }
        
        const approvedPlates = data.filter((plate) => plate.status === 'approved');
        setHasMore(approvedPlates.length === LIST_PAGE_SIZE);
        setPlates((prev) => (reset ? approvedPlates : [...prev, ...approvedPlates]));
        setError(null);
      } catch (err) {
        console.error('Error fetching plates:', err);
        setError('Failed to load plates. Please try again later.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    };

    fetchPlates({ reset: true, offset: 0 });
  }, []);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    
    let sanitizedValue = value;
    
    if (name === 'priceMin' && value !== '') {
      const parsedValue = Number(value);
      sanitizedValue = Number.isNaN(parsedValue) ? '' : Math.max(0, parsedValue);
    }
    
    if (name === 'priceMax' && value !== '') {
      const parsedValue = Number(value);
      sanitizedValue = Number.isNaN(parsedValue) ? '' : Math.max(0, parsedValue);
    }
    
    if (name === 'startsWith' && value !== '') {
      sanitizedValue = value.replace(/\D/g, '');
    }
    
    if (name === 'endsWith' && value !== '') {
      sanitizedValue = value.replace(/\D/g, '');
    }

    setFilters(prev => ({
      ...prev,
      [name]: sanitizedValue
    }));
  };

  const applyFilters = () => {
    return plates.filter(plate => {
      const platePrice = Number(plate.price ?? 0);

      if (filters.city !== 'All cities' && plate.city !== filters.city) {
        return false;
      }

      if (filters.code !== 'All codes' && plate.code !== filters.code) {
        return false;
      }

      if (filters.digits && plate.digits !== Number(filters.digits)) {
        return false;
      }

      if (filters.priceMin && platePrice < Number(filters.priceMin)) {
        return false;
      }

      if (filters.priceMax && platePrice > Number(filters.priceMax)) {
        return false;
      }

      if (filters.contains) {
        const plateNumber = plate.number.toString();
        if (!plateNumber.includes(filters.contains)) {
          return false;
        }
      }

      if (filters.startsWith) {
        const plateNumber = plate.number.toString();
        if (!plateNumber.startsWith(filters.startsWith)) {
          return false;
        }
      }

      if (filters.endsWith) {
        const plateNumber = plate.number.toString();
        if (!plateNumber.endsWith(filters.endsWith)) {
          return false;
        }
      }

      return true;
    }).sort((a, b) => {
      const aPrice = Number(a.price ?? 0);
      const bPrice = Number(b.price ?? 0);
      const aDate = new Date(a.created_at || 0);
      const bDate = new Date(b.created_at || 0);

      switch (filters.sortBy) {
        case 'price-low':
          return aPrice - bPrice;
        case 'price-high':
          return bPrice - aPrice;
        case 'newest':
        default:
          return bDate - aDate;
      }
    });
  };

  const sortedPlates = applyFilters();

  if (loading) {
    return <ListingSkeleton variant="grid" count={6} showHeader showFilters />;
  }

  if (error) {
    return (
      <div className="platesd-error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()} className="platesd-back-button">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="platesd-container">
      <div className="platesd-max-width">
        <div className="platesd-header">
          <h1 className="platesd-title">License Plates</h1>
          <p className="platesd-subtitle">Find your perfect plate from our extensive collection</p>
        </div>

        <div className="platesd-filters">
          <div className="platesd-filter-row">
            <div className="platesd-filter-group">
              <label htmlFor="city">City</label>
              <SearchableSelect 
                id="city" 
                name="city" 
                value={filters.city} 
                onChange={handleFilterChange}
              >
                {cityOptions.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </SearchableSelect>
            </div>

            <div className="platesd-filter-group">
              <label htmlFor="code">Code</label>
              <SearchableSelect 
                id="code" 
                name="code" 
                value={filters.code} 
                onChange={handleFilterChange}
              >
                <option value="All codes">All Codes</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="E">E</option>
                <option value="F">F</option>
                <option value="G">G</option>
                <option value="H">H</option>
                <option value="I">I</option>
                <option value="J">J</option>
                <option value="K">K</option>
                <option value="L">L</option>
                <option value="M">M</option>
                <option value="N">N</option>
                <option value="O">O</option>
                <option value="P">P</option>
                <option value="Q">Q</option>
                <option value="R">R</option>
                <option value="S">S</option>
                <option value="T">T</option>
                <option value="U">U</option>
                <option value="V">V</option>
                <option value="W">W</option>
                <option value="X">X</option>
                <option value="Y">Y</option>
                <option value="Z">Z</option>
              </SearchableSelect>
            </div>

            <div className="platesd-filter-group">
              <label htmlFor="digits">Digits</label>
              <SearchableSelect 
                id="digits" 
                name="digits" 
                value={filters.digits}
                onChange={handleFilterChange}
              >
                <option value="">Any digits</option>
                <option value="1">1 Digit</option>
                <option value="2">2 Digits</option>
                <option value="3">3 Digits</option>
                <option value="4">4 Digits</option>
                <option value="5">5 Digits</option>
              </SearchableSelect>
            </div>

            <div className="platesd-filter-group">
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
              </SearchableSelect>
            </div>
          </div>

          <div className="platesd-filter-row">
            <div className="platesd-filter-group">
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

            <div className="platesd-filter-group">
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

            <div className="platesd-filter-group">
              <label htmlFor="contains">Contains</label>
              <input 
                type="text" 
                id="contains" 
                placeholder="e.g., 900" 
                value={filters.contains}
                onChange={handleFilterChange}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>

            <div className="platesd-filter-group">
              <label htmlFor="format">Format</label>
              <SearchableSelect 
                id="format" 
                name="format" 
                value={filters.format} 
                onChange={handleFilterChange}
              >
                {formatOptions.map(format => (
                  <option key={format} value={format}>{format}</option>
                ))}
              </SearchableSelect>
            </div>
          </div>

          <div className="platesd-filter-row">
            <div className="platesd-filter-group">
              <label htmlFor="startsWith">Starts With</label>
              <input 
                type="text" 
                id="startsWith" 
                placeholder="e.g., 123" 
                value={filters.startsWith}
                onChange={handleFilterChange}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>

            <div className="platesd-filter-group">
              <label htmlFor="endsWith">Ends With</label>
              <input 
                type="text" 
                id="endsWith" 
                placeholder="e.g., 000" 
                value={filters.endsWith}
                onChange={handleFilterChange}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>
          </div>
        </div>

        <div className="platesd-results">
          <span className="platesd-results-count">{sortedPlates.length} license plates</span>
        </div>

      <div className="platesd-grid">
        {sortedPlates.length > 0 ? (
            sortedPlates.map(plate => (
              <Link
                key={plate.id}
                to={`/plates/${plate.id}`}
                state={buildListingRouteState(plate)}
                className="platesd-card-link"
              >
                <div className="platesd-card">
                  <div className="platesd-card-plate">
                    <UAELicensePlate
                      city={plate.city}
                      code={plate.code}
                      number={plate.number}
                      className={plate.status === 'sold' ? 'sold' : ''}
                    />
                  </div>
                  <div className="platesd-card-details">
                    <h3 className="platesd-card-title">{plate.city} {plate.code} {plate.number}</h3>
                    <div className="platesd-card-info">
                      <span className="platesd-card-format">{plate.plate_format || 'Standard'}</span>
                      <span className="platesd-card-digits">{plate.digits} Digits</span>
                    </div>
                    <p className="platesd-card-price">AED {plate.price?.toLocaleString() || 'N/A'}</p>
                    <p className="platesd-card-location">{plate.city}</p>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="platesd-no-results">
              <h3>No license plates found</h3>
              <p>No license plates match your current filters. Please try different criteria.</p>
            </div>
          )}
      </div>

      {hasMore && plates.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <button
            type="button"
            className="platesd-back-button"
            disabled={loadingMore}
            onClick={() => {
              const nextOffset = plates.length;
              setLoadingMore(true);
              fetchJsonWithCache(
                `${API_URL}/api/plates?limit=${LIST_PAGE_SIZE}&offset=${nextOffset}&order=created_at.desc`
              )
                .then((response) => {
                  if (!response.ok) {
                    throw new Error(`Failed to fetch plates: ${response.status}`);
                  }
                  const data = Array.isArray(response.data) ? response.data : [];
                  const approvedPlates = data.filter((plate) => plate.status === 'approved');
                  setHasMore(approvedPlates.length === LIST_PAGE_SIZE);
                  setPlates((prev) => [...prev, ...approvedPlates]);
                })
                .catch((err) => {
                  console.error('Error fetching more plates:', err);
                  setError('Failed to load plates. Please try again later.');
                })
                .finally(() => setLoadingMore(false));
            }}
          >
            {loadingMore ? 'Loading more...' : 'Load more plates'}
          </button>
        </div>
      )}

      <BrowseSellCta category="plates" />
    </div>
    </div>
  );
};

export default PlatesRedesigned;
