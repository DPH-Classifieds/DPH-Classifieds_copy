import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './CarList.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const CarList = () => {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    car_manufacturer: '',
    car_model: '',
    car_city: '',
    make_year_from: '',
    make_year_to: '',
    price_from: '',
    price_to: '',
    body_type: '',
    fuel_type: '',
    transmission_type: '',
    regional_spec: '',
    kilometer_from: '',
    kilometer_to: '',
    steering_side: '',
    seating_capacity: '',
    horsepower: '',
    engine_capacity: '',
    extras: []
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [sortOption, setSortOption] = useState('created_at.desc');

  // Get unique values for filter dropdowns
  const [manufacturers, setManufacturers] = useState([]);
  const [models, setModels] = useState([]);
  const [years, setYears] = useState([]);
  
  // Car specifications arrays
  const bodyTypes = ['Sedan', 'SUV', 'Hatchback', 'Coupe', 'Convertible', 'Wagon', 'Van', 'Truck', 'Other'];
  const fuelTypes = ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'Other'];
  const transmissionTypes = ['Automatic', 'Manual', 'CVT', 'Electric', 'Semi-Automatic', 'Other'];
  const regionalSpecs = ['GCC Specs', 'American Specs', 'European Specs', 'Japanese Specs', 'Korean Specs', 'Chinese Specs', 'Other'];
  const steeringSides = ['Left', 'Right'];
  const seatingCapacities = ['2', '4', '5', '6', '7', '8', '9+'];
  const horsepowerRanges = ['100-150', '150-200', '200-300', '300-400', '400-500', '500-600', '600-700', '700+'];
  const engineCapacities = ['0-1000cc', '1100-2000cc', '2100-3000cc', '3100-4000cc', '4100-5000cc', '5100-6000cc', '6100-7000cc'];
  const extras = ['Climate Control', 'DVD Player', 'Keyless Entry', 'Navigation System', 'Premium Sound System'];
  
  const emirates = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'];
  
  // Helper function to get proper image URL
  const getImageUrl = (image) => {
    if (!image) return null;
    
    // Try all possible image URL fields
    const imageUrl = image.image_url || image.url;
    
    // Check if the URL is a relative URL that needs the API base URL
    if (imageUrl && imageUrl.startsWith('/')) {
      return `${API_URL}${imageUrl}`;
    }
    
    return imageUrl;
  };

  const fetchCars = useCallback(async (filterParams = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      // Build query parameters from filters
      const params = new URLSearchParams();
      
      // Add sort option
      params.append('order', sortOption);
      
      // Add all active filters, excluding empty values
      const activeFilters = { ...filters, ...filterParams };
      Object.entries(activeFilters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
      
      // Add timestamp to avoid caching
      params.append('_t', new Date().getTime());
      
      const queryString = params.toString() ? `?${params.toString()}` : '';
      
      // First try with our real endpoint
      let response;
      try {
        response = await axios.get(`${API_URL}/api/cars${queryString}`);
      } catch (e) {
        console.warn('Failed to fetch from main endpoint, falling back to test endpoint');
        response = await axios.get(`${API_URL}/api/test`);
      }
      
      console.log('API Response:', response.data);
      setCars(response.data);
      
      // Extract unique values for filters
      if (response.data && response.data.length > 0) {
        const uniqueManufacturers = [...new Set(response.data.map(car => car.car_manufacturer).filter(Boolean))];
        const uniqueModels = [...new Set(response.data.map(car => car.car_model).filter(Boolean))];
        const uniqueYears = [...new Set(response.data.map(car => car.make_year).filter(Boolean))];
        
        setManufacturers(uniqueManufacturers.sort());
        setModels(uniqueModels.sort());
        setYears(uniqueYears.sort((a, b) => b - a)); // Sort years in descending order
      }
    } catch (err) {
      console.error('Error fetching cars:', err);
      setError('Failed to load cars. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [filters, sortOption, API_URL]);
  
  useEffect(() => {
    fetchCars();
  }, [sortOption, fetchCars]);
  
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSortChange = (e) => {
    setSortOption(e.target.value);
  };
  
  const applyFilters = (e) => {
    e.preventDefault();
    fetchCars();
  };
  
  const resetFilters = () => {
    setFilters({
      car_manufacturer: '',
      car_model: '',
      car_city: '',
      make_year_from: '',
      make_year_to: '',
      price_from: '',
      price_to: '',
      body_type: '',
      fuel_type: '',
      transmission_type: '',
      regional_spec: '',
      kilometer_from: '',
      kilometer_to: '',
      steering_side: '',
      seating_capacity: '',
      horsepower: '',
      engine_capacity: '',
      extras: []
    });
    fetchCars({
      car_manufacturer: '',
      car_model: '',
      car_city: '',
      make_year_from: '',
      make_year_to: '',
      price_from: '',
      price_to: '',
      body_type: '',
      fuel_type: '',
      transmission_type: '',
      regional_spec: '',
      kilometer_from: '',
      kilometer_to: '',
      steering_side: '',
      seating_capacity: '',
      horsepower: '',
      engine_capacity: '',
      extras: []
    });
  };
  
  // Format price with currency symbol
  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      maximumFractionDigits: 0
    }).format(price);
  };
  
  return (
    <div className="car-list-container">
      <h1>Car Listings</h1>
      
      {/* Filter Section */}
      <div className="car-filters">
        <div className="filter-header">
          <h2>Filter Listings</h2>
          <div className="sort-by">
            <label htmlFor="sortOption">Sort by:</label>
            <select 
              id="sortOption" 
              value={sortOption} 
              onChange={handleSortChange}
              className="sort-select"
            >
              <option value="created_at.desc">Newest First</option>
              <option value="created_at.asc">Oldest First</option>
              <option value="expected_selling_price.asc">Price: Low to High</option>
              <option value="expected_selling_price.desc">Price: High to Low</option>
              <option value="make_year.desc">Year: Newest First</option>
              <option value="make_year.asc">Year: Oldest First</option>
              <option value="kilometer_driven.asc">Mileage: Low to High</option>
              <option value="kilometer_driven.desc">Mileage: High to Low</option>
            </select>
          </div>
        </div>
        
        <form onSubmit={applyFilters}>
          {/* Basic Filters */}
          <div className="filter-row">
            <div className="filter-group">
              <label htmlFor="car_manufacturer">Make</label>
              <select 
                id="car_manufacturer" 
                name="car_manufacturer" 
                value={filters.car_manufacturer} 
                onChange={handleFilterChange}
                className="form-select"
              >
                <option value="">All Makes</option>
                {manufacturers.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            
            <div className="filter-group">
              <label htmlFor="car_model">Model</label>
              <select 
                id="car_model" 
                name="car_model" 
                value={filters.car_model} 
                onChange={handleFilterChange}
                className="form-select"
              >
                <option value="">All Models</option>
                {models.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
            
            <div className="filter-group">
              <label htmlFor="car_city">Emirate</label>
              <select 
                id="car_city" 
                name="car_city" 
                value={filters.car_city} 
                onChange={handleFilterChange}
                className="form-select"
              >
                <option value="">All Emirates</option>
                {emirates.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="body_type">Body Type</label>
              <select 
                id="body_type" 
                name="body_type" 
                value={filters.body_type} 
                onChange={handleFilterChange}
                className="form-select"
              >
                <option value="">All Body Types</option>
                {bodyTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="filter-row">
            <div className="filter-group">
              <label htmlFor="make_year_from">Year From</label>
              <select 
                id="make_year_from" 
                name="make_year_from" 
                value={filters.make_year_from} 
                onChange={handleFilterChange}
                className="form-select"
              >
                <option value="">Min Year</option>
                {years.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            
            <div className="filter-group">
              <label htmlFor="make_year_to">Year To</label>
              <select 
                id="make_year_to" 
                name="make_year_to" 
                value={filters.make_year_to} 
                onChange={handleFilterChange}
                className="form-select"
              >
                <option value="">Max Year</option>
                {years.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            
            <div className="filter-group">
              <label htmlFor="price_from">Price From</label>
              <input 
                type="number" 
                id="price_from" 
                name="price_from" 
                value={filters.price_from} 
                onChange={handleFilterChange}
                placeholder="Min Price"
                className="form-control"
              />
            </div>
            
            <div className="filter-group">
              <label htmlFor="price_to">Price To</label>
              <input 
                type="number" 
                id="price_to" 
                name="price_to" 
                value={filters.price_to} 
                onChange={handleFilterChange}
                placeholder="Max Price"
                className="form-control"
              />
            </div>
          </div>
          
          <div className="advanced-filters-toggle">
            <button type="button" onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}>
              {showAdvancedFilters ? 'Hide Advanced Filters' : 'Show Advanced Filters'} 
              <span>{showAdvancedFilters ? '▲' : '▼'}</span>
            </button>
          </div>
          
          {showAdvancedFilters && (
            <div className="advanced-filters">
              <h3>Advanced Filters</h3>
              
              <div className="filter-row">
                <div className="filter-group">
                  <label htmlFor="fuel_type">Fuel Type</label>
                  <select 
                    id="fuel_type" 
                    name="fuel_type" 
                    value={filters.fuel_type} 
                    onChange={handleFilterChange}
                    className="form-select"
                  >
                    <option value="">All Fuel Types</option>
                    {fuelTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="transmission_type">Transmission</label>
                  <select 
                    id="transmission_type" 
                    name="transmission_type" 
                    value={filters.transmission_type} 
                    onChange={handleFilterChange}
                    className="form-select"
                  >
                    <option value="">All Transmissions</option>
                    {transmissionTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="regional_spec">Regional Spec</label>
                  <select 
                    id="regional_spec" 
                    name="regional_spec" 
                    value={filters.regional_spec} 
                    onChange={handleFilterChange}
                    className="form-select"
                  >
                    <option value="">All Specs</option>
                    {regionalSpecs.map(spec => (
                      <option key={spec} value={spec}>{spec}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="filter-row">
                <div className="filter-group">
                  <label htmlFor="kilometer_from">Kilometers From</label>
                  <input 
                    type="number" 
                    id="kilometer_from" 
                    name="kilometer_from" 
                    value={filters.kilometer_from} 
                    onChange={handleFilterChange}
                    placeholder="Min KM"
                    className="form-control"
                  />
                </div>
                
                <div className="filter-group">
                  <label htmlFor="kilometer_to">Kilometers To</label>
                  <input 
                    type="number" 
                    id="kilometer_to" 
                    name="kilometer_to" 
                    value={filters.kilometer_to} 
                    onChange={handleFilterChange}
                    placeholder="Max KM"
                    className="form-control"
                  />
                </div>
              </div>
              
              <div className="filter-row">
                <div className="filter-group">
                  <label htmlFor="steering_side">Steering Side</label>
                  <select 
                    id="steering_side" 
                    name="steering_side" 
                    value={filters.steering_side} 
                    onChange={handleFilterChange}
                    className="form-select"
                  >
                    <option value="">Any</option>
                    {steeringSides.map(side => (
                      <option key={side} value={side}>{side}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="seating_capacity">Seating Capacity</label>
                  <select 
                    id="seating_capacity" 
                    name="seating_capacity" 
                    value={filters.seating_capacity} 
                    onChange={handleFilterChange}
                    className="form-select"
                  >
                    <option value="">Any</option>
                    {seatingCapacities.map(capacity => (
                      <option key={capacity} value={capacity}>{capacity}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="horsepower">Horsepower</label>
                  <select 
                    id="horsepower" 
                    name="horsepower" 
                    value={filters.horsepower} 
                    onChange={handleFilterChange}
                    className="form-select"
                  >
                    <option value="">Any</option>
                    {horsepowerRanges.map(range => (
                      <option key={range} value={range}>{range}</option>
                    ))}
                  </select>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="engine_capacity">Engine Capacity</label>
                  <select 
                    id="engine_capacity" 
                    name="engine_capacity" 
                    value={filters.engine_capacity} 
                    onChange={handleFilterChange}
                    className="form-select"
                  >
                    <option value="">Any</option>
                    {engineCapacities.map(capacity => (
                      <option key={capacity} value={capacity}>{capacity}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="filter-row">
                <div className="filter-group extras-filter">
                  <label>Extras</label>
                  <div className="extras-checkboxes">
                    {extras.map(extra => (
                      <div key={extra} className="form-check">
                        <input 
                          type="checkbox" 
                          id={`extra-${extra.replace(/\s+/g, '-').toLowerCase()}`}
                          name="extras"
                          value={extra}
                          checked={filters.extras.includes(extra)}
                          onChange={(e) => {
                            const value = e.target.value;
                            const isChecked = e.target.checked;
                            setFilters(prev => ({
                              ...prev,
                              extras: isChecked 
                                ? [...prev.extras, value] 
                                : prev.extras.filter(item => item !== value)
                            }));
                          }}
                          className="form-check-input"
                        />
                        <label 
                          htmlFor={`extra-${extra.replace(/\s+/g, '-').toLowerCase()}`}
                          className="form-check-label"
                        >
                          {extra}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div className="filter-actions">
            <button type="submit" className="btn btn-primary apply-filters">
              Apply Filters
            </button>
            <button type="button" className="btn btn-secondary reset-filters" onClick={resetFilters}>
              Reset Filters
            </button>
          </div>
        </form>
      </div>
      
      {/* Error Message */}
      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => fetchCars()}>Retry</button>
        </div>
      )}
      
      {/* Loading State */}
      {loading ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading cars...</p>
        </div>
      ) : (
        <>
          {/* Car Listings */}
          <div className="car-grid">
            {cars.length > 0 ? (
              cars.map(car => (
                <div key={car.id} className="car-card">
                  <div className="car-image">
                    {car.images && car.images.length > 0 ? (
                      <img 
                        src={getImageUrl(car.images[0])} 
                        alt={car.listing_title || `${car.make_year} ${car.car_manufacturer} ${car.car_model}`}
                        onError={(e) => {
                          console.error("Image failed to load:", e.target.src);
                          e.target.onerror = null;
                          e.target.src = "https://via.placeholder.com/400x300?text=No+Image+Available";
                        }}
                      />
                    ) : (
                      <div className="image-placeholder">No Image Available</div>
                    )}
                    <div className="car-price">{formatPrice(car.expected_selling_price)}</div>
                  </div>
                  <div className="car-content">
                    <h3 className="car-title">{car.listing_title || `${car.make_year} ${car.car_manufacturer} ${car.car_model}`}</h3>
                    <div className="car-details">
                      <p className="car-year">{car.make_year}</p>
                      <div className="car-specs">
                        <span>{car.kilometer_driven?.toLocaleString() || 'N/A'} KM</span>
                        <span>•</span>
                        <span>{car.transmission_type || 'N/A'}</span>
                        <span>•</span>
                        <span>{car.fuel_type || 'N/A'}</span>
                      </div>
                      <p className="car-location">{car.car_city || 'Location not specified'}</p>
                    </div>
                    <Link to={`/cars/${car.id}`} className="view-details-btn">
                      View Details
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="no-cars-message">
                <p>No cars found matching your criteria.</p>
                <button onClick={resetFilters}>Reset Filters</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default CarList; 