import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import LoadingSpinner from './LoadingSpinner';
import { carMakes, carModels } from '../utils/carData';
import './CarList.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const CarList = () => {
  const [cars, setCarsState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Safe wrapper to ensure cars is always an array
  const setCars = (data) => {
    if (Array.isArray(data)) {
      setCarsState(data);
    } else {
      console.error('Attempted to set cars with non-array data:', typeof data, data);
      setCarsState([]);
    }
  };
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

  // Keep a full year range so filtering is not limited by currently loaded listings
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1886 + 1 }, (_, index) => currentYear - index);
  const [availableModels, setAvailableModels] = useState([]);
  
  // Car specifications arrays
  const bodyTypes = ['Sedan', 'SUV', 'Hatchback', 'Coupe', 'Convertible', 'Wagon', 'Van', 'Truck', 'Other'];
  const fuelTypes = ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'Other'];
  const transmissionTypes = ['Automatic', 'Manual'];
  const regionalSpecs = ['GCC', 'North American', 'European', 'Japanese', 'Korean', 'Chinese', 'Other'];
  const steeringSides = ['Left', 'Right'];
  const seatingCapacities = ['2', '4', '5', '6', '7', '8', '9+'];
  const horsepowerRanges = ['>100', '100-199', '200-299', '300-399', '400-499', '500-599', '600-699', '700-799', '800-899', '900-999', '1000+'];
  const engineCapacities = ['0-999cc', '1000cc-1499cc', '1500cc-1999cc', '2000cc-2999cc', '3000cc-3999cc', '4000cc-4999cc', '5000cc-5999cc', '6000cc-6999cc', '7000cc-7999cc', '8000cc+'];
  // Comprehensive car extras organized by category
  const carExtrasCategories = {
    'Comfort & Convenience': [
      'Dual-zone Climate Control',
      'Tri-zone Climate Control',
      'Ventilated Seats (Cooling Seats)',
      'Heated Seats',
      'Massage Seats',
      'Panoramic Sunroof / Moonroof',
      'Ambient Lighting (Multi-color)',
      'Soft-Close Doors',
      'Heads-Up Display (HUD)',
      'Rear Window Sunshades (Manual)',
      'Rear Window Sunshades (Electric)',
      'Power Tailgate / Hands-Free Trunk',
      'Auto-Dimming Mirrors',
      'Memory Seats and Steering'
    ],
    'Infotainment & Tech': [
      'Apple CarPlay',
      'Android Auto',
      'Rear Entertainment Screens',
      'Bluetooth Audio Streaming',
      'USB-C Fast Charging Ports',
      '360° Surround Camera',
      'Digital Cockpit / Fully Digital Instrument Cluster',
      'Voice Command / AI Assistant',
      'Built-In Spotify / Streaming Apps',
      'Wi-Fi Hotspot'
    ],
    'Safety & Driver Assistance': [
      'Adaptive Cruise Control (Radar Cruise)',
      'Lane Keep Assist / Lane Departure Warning',
      'Blind Spot Monitoring',
      'Automatic Emergency Braking',
      'Traffic Sign Recognition',
      'Rear Cross Traffic Alert',
      'Night Vision Camera',
      'Off-Road Crawl Control / Terrain Response Modes'
    ],
    'Luxury & Styling': [
      'Leather Dashboard Wrapping',
      'Suede / Alcantara Headliner',
      'Carbon Fiber Trim',
      'Woodgrain Trim',
      'Illuminated Door Sills',
      'Chrome Appearance Package',
      'Blackout / Night Package (Black Badges, Black Trim)',
      'Sport Body Kit / Aero Kit'
    ],
    'Off-Road / Performance': [
      'Diff Lock (Rear / Front / Center)',
      'Air Suspension (Height Adjustable)',
      'Skid Plates',
      'Snorkel / Desert Air Intake',
      'Off-Road Camera Modes',
      'All-Terrain Drive Modes (Sand, Rock, Mud, Snow)',
      'Tow Hook / Recovery Package'
    ]
  };

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
      
      console.log('Fetching from:', `${API_URL}/api/cars${queryString}`);
      console.log('API_URL value:', API_URL);
      
      const response = await axios.get(`${API_URL}/api/cars${queryString}`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        validateStatus: function (status) {
          return status < 500; // Accept any status code less than 500
        }
      });
      
      console.log('API Response status:', response.status);
      console.log('API Response data type:', typeof response.data);
      console.log('API Response data:', response.data);
      
      // Check if response is HTML (error page)
      if (typeof response.data === 'string' && response.data.includes('<!doctype html>')) {
        console.error('Received HTML instead of JSON. API might be down or URL is wrong.');
        console.error('Current API_URL:', API_URL);
        throw new Error('API returned HTML instead of JSON. Check if backend is running.');
      }
      
      // Ensure we have an array
      const carsData = Array.isArray(response.data) ? response.data : [];
      console.log('Setting cars data, length:', carsData.length);
      setCars(carsData);
      
    } catch (err) {
      console.error('Error fetching cars:', err);
      console.error('Error details:', err.response?.data || err.message);
      setError('Failed to load cars. Please check if the API is running.');
    } finally {
      setLoading(false);
    }
  }, [filters, sortOption]);
  
  useEffect(() => {
    fetchCars();
  }, [sortOption, fetchCars]);
  
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    const nonNegativeFields = ['price_from', 'price_to', 'kilometer_from', 'kilometer_to'];
    let sanitizedValue = value;
    if (nonNegativeFields.includes(name) && value !== '') {
      const numericValue = Number(value);
      sanitizedValue = Number.isNaN(numericValue) ? '' : Math.max(0, numericValue);
    }
    
    // If manufacturer changes, update available models and reset model selection
    if (name === 'car_manufacturer') {
      const models = carModels[sanitizedValue] || [];
      setAvailableModels(models);
      setFilters(prev => ({ ...prev, car_manufacturer: sanitizedValue, car_model: '' }));
    } else {
      setFilters(prev => ({ ...prev, [name]: sanitizedValue }));
    }
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
                {carMakes.map(make => (
                  <option key={make} value={make}>{make}</option>
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
                disabled={!filters.car_manufacturer}
              >
                <option value="">All Models</option>
                {availableModels.map(model => (
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
                <option value="">Min Year (1886)</option>
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
                min="0"
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
                min="0"
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
                    <option value="">All Regional</option>
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
                    min="0"
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
                    min="0"
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
              
              {/* Car Extras - Redesigned for cleaner UI */}
              <div className="filter-section">
                <div className="filter-section-header">
                  <label>Special Features</label>
                </div>
                
                <div className="extras-grid" style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: '8px',
                  marginTop: '10px'
                }}>
                  {Object.entries(carExtrasCategories).map(([category, extras]) => (
                    <div key={category} style={{ marginBottom: '15px' }}>
                      <div style={{ 
                        fontSize: '13px', 
                        fontWeight: '600', 
                        marginBottom: '8px',
                        color: '#555',
                        borderBottom: '1px solid #e0e0e0',
                        paddingBottom: '4px'
                      }}>
                        {category}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {extras.map(extra => (
                          <label 
                            key={extra}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              cursor: 'pointer',
                              fontSize: '13px',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              transition: 'background-color 0.2s',
                              backgroundColor: filters.extras.includes(extra) ? '#e3f2fd' : 'transparent'
                            }}
                            onMouseEnter={(e) => {
                              if (!filters.extras.includes(extra)) {
                                e.currentTarget.style.backgroundColor = '#f5f5f5';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!filters.extras.includes(extra)) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                          >
                            <input 
                              type="checkbox"
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
                              style={{ marginRight: '8px', cursor: 'pointer' }}
                            />
                            <span style={{ 
                              color: filters.extras.includes(extra) ? '#1976d2' : '#333',
                              fontWeight: filters.extras.includes(extra) ? '500' : '400'
                            }}>
                              {extra}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Selected Extras Summary */}
                {filters.extras.length > 0 && (
                  <div style={{
                    marginTop: '15px',
                    padding: '10px',
                    backgroundColor: '#f0f7ff',
                    borderRadius: '6px',
                    border: '1px solid #b3d9ff'
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: '#1976d2' }}>
                      Selected Features ({filters.extras.length}):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {filters.extras.map(extra => (
                        <span 
                          key={extra}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '4px 10px',
                            backgroundColor: '#fff',
                            border: '1px solid #1976d2',
                            borderRadius: '16px',
                            fontSize: '12px',
                            color: '#1976d2'
                          }}
                        >
                          {extra}
                          <button
                            type="button"
                            onClick={() => {
                              setFilters(prev => ({
                                ...prev,
                                extras: prev.extras.filter(item => item !== extra)
                              }));
                            }}
                            style={{
                              marginLeft: '6px',
                              background: 'none',
                              border: 'none',
                              color: '#1976d2',
                              cursor: 'pointer',
                              fontSize: '14px',
                              padding: '0',
                              lineHeight: '1'
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
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
        <LoadingSpinner message="Loading cars..." size="large" />
      ) : (
        <>
          {/* Car Listings */}
          <div className="car-grid">
            {cars.length > 0 ? (
              cars.map(car => (
                <Link key={car.id} to={`/cars/${car.id}`} className="car-card-link">
                  <div className="car-card">
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
                      <div className="view-details-btn">
                        View Details
                      </div>
                    </div>
                  </div>
                </Link>
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
