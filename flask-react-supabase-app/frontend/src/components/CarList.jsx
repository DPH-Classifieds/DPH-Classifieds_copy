import React, { useState, useEffect, useCallback } from 'react';
import SearchableSelect from './ui/searchable-select';
import SeoMeta from './SeoMeta';
import MarketplaceListingCard from './MarketplaceListingCard';
import BrowseSellCta from './BrowseSellCta';
import ListingSkeleton from './ListingSkeleton';
import { carMakes, carModels, carTrims } from '../utils/carData';
import { resolveMediaUrl } from '../utils/media';
import { fetchJsonWithCache, readJsonSessionCache } from '../utils/fetchCache';
import { buildListingRouteState } from '../utils/listingRouteState';
import { buildCarPath } from '../utils/listingUrl';
import { buildStaticSeo } from '../utils/seo';
import './CarList.css';
import './ExplorePage.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const LIST_PAGE_SIZE = 12;

const CarList = () => {
  const [cars, setCarsState] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const seoData = buildStaticSeo({
    title: 'Used Cars for Sale in UAE | DPH Classifieds',
    description:
      'Search verified UAE car listings with make, model, trim, year, price, and city filters on DPH Classifieds.',
    path: '/cars',
    keywords: ['used cars UAE', 'Dubai cars for sale', 'UAE car listings', 'buy cars Dubai'],
  });
  
  // Safe wrapper to ensure cars is always an array
  const setCars = (data) => {
    if (typeof data === 'function') {
      setCarsState(data);
      return;
    }
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
    car_trim: '',
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
    exclude_reddit: false,
    extras: []
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [sortOption, setSortOption] = useState('created_at.desc');
  const [filtersOpenMobile, setFiltersOpenMobile] = useState(false);

  // Keep a full year range so filtering is not limited by currently loaded listings
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1886 + 1 }, (_, index) => currentYear - index);
  const [availableModels, setAvailableModels] = useState([]);
  const [availableTrims, setAvailableTrims] = useState([]);
  const [customTrim, setCustomTrim] = useState(false);
  
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
    const imageUrl = image.display_url || image.image_url || image.url || image;
    return resolveMediaUrl(imageUrl);
  };

  const normalizeMarketplaceItem = (car) => {
    const title =
      car.listing_title ||
      [car.car_manufacturer, car.car_model].filter(Boolean).join(' ').trim() ||
      'Car listing';

    return {
      id: car.id,
      categoryKey: 'cars',
      categoryLabel: 'Car',
      listingType: 'car',
      route: buildCarPath(car),
      routeState: buildListingRouteState(car),
      title,
      priceLabel: formatPrice(car.expected_selling_price),
      image: car.images && car.images.length > 0 ? getImageUrl(car.images[0]) : null,
      year: car.make_year,
      kilometers: car.kilometer_driven,
      location: car.car_city,
    };
  };

  const fetchCars = useCallback(async ({ filterParams = {}, reset = true, offset = 0 } = {}) => {
    if (reset) {
      setLoading(true);
      setError(null);
      setHasMore(false);
      setCars([]);
    } else {
      setLoadingMore(true);
    }
    
    try {
      // Build query parameters from filters
      const params = new URLSearchParams();
      
      // Add sort option
      params.append('order', sortOption);
      params.append('limit', String(LIST_PAGE_SIZE));
      params.append('offset', String(Math.max(0, offset)));
      
      // Add all active filters, excluding empty values
      const activeFilters = { ...filters, ...filterParams };
      Object.entries(activeFilters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
      
      const queryString = params.toString() ? `?${params.toString()}` : '';

      const url = `${API_URL}/api/cars${queryString}`;
      const cached = readJsonSessionCache(url);
      if (Array.isArray(cached)) {
        setCars(cached);
        setLoading(false);
      }

      const requestUrl = url;
      const response = await fetchJsonWithCache(url, {
        onUpdate: reset
          ? (fresh) => {
              if (fresh._sourceUrl !== requestUrl) return;
              const freshCars = Array.isArray(fresh.data) ? fresh.data : [];
              if (freshCars.length > 0) {
                setCars(freshCars);
                setHasMore(freshCars.length >= LIST_PAGE_SIZE);
              }
            }
          : undefined,
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch cars: ${response.status}`);
      }

      const carsData = Array.isArray(response.data) ? response.data : [];
      setHasMore(carsData.length === LIST_PAGE_SIZE);
      if (reset) {
        setCars(carsData);
      } else {
        setCars((prev) => [...prev, ...carsData]);
      }
      
    } catch (err) {
      console.error('Error fetching cars:', err);
      setError('Failed to load cars. Please try again later.');
      if (reset) {
        setCars([]);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filters, sortOption]);
  
  useEffect(() => {
    fetchCars({ reset: true, offset: 0 });
  }, [sortOption, fetchCars]);
  
  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    const nonNegativeFields = ['price_from', 'price_to', 'kilometer_from', 'kilometer_to'];
    let sanitizedValue = value;
    if (nonNegativeFields.includes(name) && value !== '') {
      const numericValue = Number(value);
      sanitizedValue = Number.isNaN(numericValue) ? '' : Math.max(0, numericValue);
    }
    
    // If manufacturer changes, update available models and reset model/trim selection
    if (name === 'car_manufacturer') {
      const models = carModels[sanitizedValue] || [];
      setAvailableModels(models);
      setAvailableTrims([]);
      setCustomTrim(false);
      setFilters(prev => ({ ...prev, car_manufacturer: sanitizedValue, car_model: '', car_trim: '' }));
    } else if (name === 'car_model') {
      // If model changes, update available trims and reset trim selection
      const make = filters.car_manufacturer;
      const trims = carTrims[make]?.[sanitizedValue] || [];
      setAvailableTrims(trims);
      setCustomTrim(false);
      setFilters(prev => ({ ...prev, car_model: sanitizedValue, car_trim: '' }));
    } else {
      setFilters(prev => ({ ...prev, [name]: sanitizedValue }));
    }
  };
  
  const handleSortChange = (e) => {
    setSortOption(e.target.value);
  };

  const activeFilterCount = Object.entries(filters).reduce((count, [key, value]) => {
    if (key === 'extras') {
      return count + (Array.isArray(value) && value.length ? 1 : 0);
    }
    return count + (value ? 1 : 0);
  }, 0);
  
  const applyFilters = (e) => {
    e.preventDefault();
    fetchCars({ reset: true, offset: 0 });
  };
  
  const resetFilters = () => {
    const clearedFilters = {
      car_manufacturer: '',
      car_model: '',
      car_trim: '',
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
      exclude_reddit: false,
      extras: []
    };
    setFilters(clearedFilters);
    setAvailableModels([]);
    setAvailableTrims([]);
    setCustomTrim(false);
    fetchCars({
      reset: true,
      offset: 0,
      filterParams: clearedFilters
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
	    <>
	      <SeoMeta {...seoData} />
	    <div className="car-list-container">
      <h1>Car Listings</h1>
      
      {/* Filter Section */}
	      <div className="car-filters">
	        <div className="filter-header">
	          <h2>Filter Listings</h2>
	          <button
	            type="button"
	            className={`filters-toggle-mobile ${filtersOpenMobile ? 'is-open' : ''}`}
	            aria-expanded={filtersOpenMobile}
	            onClick={() => setFiltersOpenMobile((prev) => !prev)}
	          >
	            <span className="filter-toggle-label">
	              {filtersOpenMobile ? 'Hide Filters' : 'Show Filters'}
	              {activeFilterCount ? ` (${activeFilterCount})` : ''}
	            </span>
	            <span className="filter-toggle-chevron" aria-hidden="true">{filtersOpenMobile ? '▲' : '▼'}</span>
	          </button>
	          <div className="sort-by">
	            <label htmlFor="sortOption">Sort by:</label>
	            <SearchableSelect 
	              id="sortOption" 
              isSearchable={false}
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
            </SearchableSelect>
          </div>
          <label
            className="hide-reddit-toggle"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            <input
              type="checkbox"
              checked={!!filters.exclude_reddit}
              onChange={(e) => {
                const checked = e.target.checked;
                setFilters((prev) => ({ ...prev, exclude_reddit: checked }));
                fetchCars({ reset: true, offset: 0, filterParams: { exclude_reddit: checked } });
              }}
            />
            <span>Hide Reddit listings</span>
          </label>
	        </div>
	        
	        <form onSubmit={applyFilters} className={filtersOpenMobile ? 'filters-open' : ''}>
	          {/* Basic Filters */}
	          <div className="filter-row">
            <div className="filter-group">
              <label htmlFor="car_manufacturer">Make</label>
              <SearchableSelect 
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
              </SearchableSelect>
            </div>
            
            <div className="filter-group">
              <label htmlFor="car_model">Model</label>
              <SearchableSelect 
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
              </SearchableSelect>
            </div>
            
            <div className="filter-group">
              <label htmlFor="car_trim">Trim</label>
              <SearchableSelect 
                id="car_trim" 
                name="car_trim" 
                value={filters.car_trim === 'custom' && customTrim ? '' : filters.car_trim} 
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    setCustomTrim(true);
                    setFilters(prev => ({ ...prev, car_trim: '' }));
                  } else {
                    setCustomTrim(false);
                    handleFilterChange(e);
                  }
                }}
                className="form-select"
                disabled={!filters.car_model}
              >
                <option value="">All Trims</option>
                {availableTrims.map(trim => (
                  <option key={trim} value={trim}>{trim}</option>
                ))}
                <option value="custom">Enter your trim</option>
              </SearchableSelect>
              {customTrim && (
                <input
                  type="text"
                  id="car_trim_custom"
                  placeholder="Enter custom trim"
                  value={filters.car_trim}
                  onChange={handleFilterChange}
                  className="form-input"
                  style={{ marginTop: '8px' }}
                />
              )}
            </div>
            
            <div className="filter-group">
              <label htmlFor="car_city">Emirate</label>
              <SearchableSelect 
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
              </SearchableSelect>
            </div>

            <div className="filter-group">
              <label htmlFor="body_type">Body Type</label>
              <SearchableSelect 
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
              </SearchableSelect>
            </div>
          </div>
          
          <div className="filter-row">
            <div className="filter-group">
              <label htmlFor="make_year_from">Year From</label>
              <SearchableSelect 
                id="make_year_from" 
                name="make_year_from" 
                value={filters.make_year_from} 
                onChange={handleFilterChange}
                isSearchable={false}
                className="form-select"
              >
                <option value="">Min Year (1886)</option>
                {years.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </SearchableSelect>
            </div>
            
            <div className="filter-group">
              <label htmlFor="make_year_to">Year To</label>
              <SearchableSelect 
                id="make_year_to" 
                name="make_year_to" 
                value={filters.make_year_to} 
                onChange={handleFilterChange}
                isSearchable={false}
                className="form-select"
              >
                <option value="">Max Year</option>
                {years.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </SearchableSelect>
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
                  <SearchableSelect 
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
                  </SearchableSelect>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="transmission_type">Transmission</label>
                  <SearchableSelect 
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
                  </SearchableSelect>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="regional_spec">Regional Spec</label>
                  <SearchableSelect 
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
                  </SearchableSelect>
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
                  <SearchableSelect 
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
                  </SearchableSelect>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="seating_capacity">Seating Capacity</label>
                  <SearchableSelect 
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
                  </SearchableSelect>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="horsepower">Horsepower</label>
                  <SearchableSelect 
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
                  </SearchableSelect>
                </div>
                
                <div className="filter-group">
                  <label htmlFor="engine_capacity">Engine Capacity</label>
                  <SearchableSelect 
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
                  </SearchableSelect>
                </div>
              </div>
              
              {/* Car Extras - Redesigned for cleaner UI */}
              <div className="filter-section">
                <div className="filter-section-header">
                  <label>Special Features</label>
                </div>
                
                <div className="extras-grid">
                  {Object.entries(carExtrasCategories).map(([category, extras]) => (
                    <div key={category} className="extras-category">
                      <div className="extras-category-title">
                        {category}
                      </div>
                      <div className="extras-option-list">
                        {extras.map(extra => (
                          <label 
                            key={extra}
                            className={`extras-option ${filters.extras.includes(extra) ? 'is-selected' : ''}`}
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
                              className="extras-option-checkbox"
                            />
                            <span className="extras-option-label">
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
                  <div className="selected-extras-summary">
                    <div className="selected-extras-title">
                      Selected Features ({filters.extras.length}):
                    </div>
                    <div className="selected-extras-list">
                      {filters.extras.map(extra => (
                        <span key={extra} className="selected-extra-pill">
                          {extra}
                          <button
                            type="button"
                            onClick={() => {
                              setFilters(prev => ({
                                ...prev,
                                extras: prev.extras.filter(item => item !== extra)
                              }));
                            }}
                            className="selected-extra-remove"
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
          <button type="button" onClick={() => fetchCars({ reset: true, offset: 0 })}>Retry</button>
        </div>
      )}
      
      {/* Loading State */}
      {loading ? (
        <ListingSkeleton variant="grid" count={8} />
      ) : (
	        <>
	          {/* Car Listings */}
          <div className="explore-v2-grid">
            {cars.length > 0 ? (
              cars.map(car => (
                <MarketplaceListingCard
	                  key={car.id}
	                  item={normalizeMarketplaceItem(car)}
	                  showMoreLink={false}
	                />
              ))
            ) : (
              <div className="no-cars-message">
                <p>No cars found matching your criteria.</p>
                <button type="button" onClick={resetFilters}>Reset Filters</button>
              </div>
            )}
          </div>
          {hasMore && cars.length > 0 && (
            <div className="load-more-wrapper" style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loadingMore}
                onClick={() => fetchCars({ reset: false, offset: cars.length })}
              >
                {loadingMore ? 'Loading more...' : 'Load more cars'}
              </button>
            </div>
          )}
          <BrowseSellCta category="cars" />
        </>
      )}
    </div>
    </>
  );
};

export default CarList; 
