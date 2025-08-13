import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/Bikes.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Bikes = () => {
  const [bikes, setBikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    type: 'all',
    priceMin: '',
    priceMax: '',
    yearMin: '',
    yearMax: '',
    sortBy: 'newest'
  });
  const { apiClient } = useAuth();

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

  useEffect(() => {
    const fetchBikes = async () => {
      try {
        setLoading(true);
        // Fetch bikes from the API
        const response = await apiClient.get('/api/bikes');
        console.log('Bikes API response:', response);
        setBikes(response || []);
        setError(null);
      } catch (err) {
        setError('Failed to load bikes. Please try again later.');
        console.error('Error fetching bikes:', err);
        
        // Fallback to placeholder data for development
        setBikes([
          {
            id: 1,
            title: 'Ducati Panigale V4',
            manufacturer: 'Ducati',
            model: 'Panigale V4',
            year: 2022,
            type: 'Sport',
            engine: '1103cc',
            mileage: 1200,
            price: 27000,
            location: 'Dubai',
            color: 'Red',
            description: 'Pristine Ducati Panigale V4 with only 1,200 miles. Full service history, never dropped. Comes with Akrapovič exhaust and other premium upgrades.',
            image: 'https://via.placeholder.com/600x400?text=Ducati+Panigale',
            created_at: '2023-06-01T10:00:00Z'
          },
          {
            id: 2,
            title: 'Harley-Davidson Street Glide',
            manufacturer: 'Harley-Davidson',
            model: 'Street Glide',
            year: 2021,
            type: 'Cruiser',
            engine: '1868cc',
            mileage: 5000,
            price: 24500,
            location: 'Abu Dhabi',
            color: 'Black',
            description: 'Beautiful Harley-Davidson Street Glide with low miles. Equipped with premium audio system and touring pack. Perfect for long rides.',
            image: 'https://via.placeholder.com/600x400?text=Harley+Davidson',
            created_at: '2023-05-28T14:30:00Z'
          },
          {
            id: 3,
            title: 'BMW R 1250 GS Adventure',
            manufacturer: 'BMW',
            model: 'R 1250 GS Adventure',
            year: 2023,
            type: 'Adventure',
            engine: '1254cc',
            mileage: 800,
            price: 22000,
            location: 'Dubai',
            color: 'Blue/White',
            description: 'Nearly new BMW R 1250 GS Adventure. Full options including LED headlight, dynamic ESA, and touring package. Perfect condition.',
            image: 'https://via.placeholder.com/600x400?text=BMW+GS+Adventure',
            created_at: '2023-06-05T09:15:00Z'
          },
          {
            id: 4,
            title: 'Kawasaki Ninja 650',
            manufacturer: 'Kawasaki',
            model: 'Ninja 650',
            year: 2020,
            type: 'Sport',
            engine: '649cc',
            mileage: 3500,
            price: 7500,
            location: 'Sharjah',
            color: 'Green',
            description: 'Great condition Kawasaki Ninja 650. Perfect for both beginners and experienced riders. Includes frame sliders and tail tidy.',
            image: 'https://via.placeholder.com/600x400?text=Kawasaki+Ninja',
            created_at: '2023-05-20T11:45:00Z'
          },
          {
            id: 5,
            title: 'Honda Africa Twin',
            manufacturer: 'Honda',
            model: 'Africa Twin',
            year: 2021,
            type: 'Adventure',
            engine: '1084cc',
            mileage: 2200,
            price: 14500,
            location: 'Dubai',
            color: 'Red/Black/White',
            description: 'Honda Africa Twin in excellent condition. DCT model with cruise control and heated grips. Ready for your next adventure.',
            image: 'https://via.placeholder.com/600x400?text=Honda+Africa+Twin',
            created_at: '2023-06-02T16:20:00Z'
          },
          {
            id: 6,
            title: 'Yamaha MT-09',
            manufacturer: 'Yamaha',
            model: 'MT-09',
            year: 2022,
            type: 'Naked',
            engine: '890cc',
            mileage: 1800,
            price: 11000,
            location: 'Abu Dhabi',
            color: 'Matte Black',
            description: 'Powerful Yamaha MT-09 with low mileage. Includes quick shifter and Akrapovič exhaust. Excellent handling and performance.',
            image: 'https://via.placeholder.com/600x400?text=Yamaha+MT-09',
            created_at: '2023-05-25T13:10:00Z'
          }
        ]);
      } finally {
        setLoading(false);
      }
    };

    fetchBikes();
  }, [apiClient]);

  const handleFilterChange = (e) => {
    const { name, value } = e.target;
    setFilters(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const applyFilters = () => {
    return bikes.filter(bike => {
      // Apply bike type filter
      if (filters.type !== 'all' && bike.type !== filters.type) {
        return false;
      }
      
      // Apply price min filter
      if (filters.priceMin && bike.price < Number(filters.priceMin)) {
        return false;
      }
      
      // Apply price max filter
      if (filters.priceMax && bike.price > Number(filters.priceMax)) {
        return false;
      }
      
      // Apply year min filter
      if (filters.yearMin && bike.year < Number(filters.yearMin)) {
        return false;
      }
      
      // Apply year max filter
      if (filters.yearMax && bike.year > Number(filters.yearMax)) {
        return false;
      }
      
      return true;
    }).sort((a, b) => {
      // Apply sorting
      switch (filters.sortBy) {
        case 'price-low':
          return a.price - b.price;
        case 'price-high':
          return b.price - a.price;
        case 'year-new':
          return b.year - a.year;
        case 'year-old':
          return a.year - b.year;
        case 'newest':
        default:
          return new Date(b.created_at) - new Date(a.created_at);
      }
    });
  };

  const filteredBikes = applyFilters();

  if (loading) {
    return (
      <div className="bikes-container loading">
        <div className="loading-spinner"></div>
        <p>Loading bikes...</p>
      </div>
    );
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
            />
          </div>
        </div>
        
        <div className="filter-row">
          <div className="filter-group">
            <label htmlFor="yearMin">Min Year</label>
            <input 
              type="number" 
              id="yearMin" 
              name="yearMin" 
              placeholder="Min Year" 
              value={filters.yearMin} 
              onChange={handleFilterChange}
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
            />
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
                      alt={`${bike.make} ${bike.model}`}
                      onError={(e) => {
                        console.error("Image failed to load:", e.target.src);
                        e.target.onerror = null;
                        e.target.src = "https://via.placeholder.com/600x400?text=No+Image+Available";
                      }}
                    />
                  ) : bike.image ? (
                    <img 
                      src={bike.image} 
                      alt={`${bike.make || bike.manufacturer} ${bike.model}`}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = "https://via.placeholder.com/600x400?text=No+Image+Available";
                      }}
                    />
                  ) : (
                    <div className="no-image">No Image Available</div>
                  )}
                  <div className="bike-price">AED {bike.price.toLocaleString()}</div>
                </div>
                <div className="bike-details">
                  <h3>{bike.title || `${bike.make || bike.manufacturer} ${bike.model} ${bike.year}`}</h3>
                  <div className="bike-specs">
                    <span className="bike-year">{bike.year}</span>
                    <span className="bike-engine">{bike.engine || bike.engine_size}</span>
                    <span className="bike-mileage">{(bike.mileage || bike.kilometer_driven || 0).toLocaleString()} km</span>
                  </div>
                  <div className="bike-location">{bike.location}</div>
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
          <Link to="/create-listing" className="sell-bike-btn">Post Your Motorcycle</Link>
        </div>
      </div>
    </div>
  );
};

export default Bikes; 