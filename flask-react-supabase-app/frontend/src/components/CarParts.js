import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/CarParts.css';

const CarParts = () => {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { apiClient } = useAuth();

  useEffect(() => {
    const fetchCarParts = async () => {
      try {
        setLoading(true);
        // In a real implementation, you would fetch car parts from your API
        // const response = await apiClient.get('/api/car-parts');
        // setParts(response.data);
        
        // For now, we'll use placeholder data
        setTimeout(() => {
          setParts([
            {
              id: 1,
              name: 'Engine Oil Filter',
              price: 15.99,
              description: 'High-quality oil filter for most vehicle makes and models',
              image: 'https://via.placeholder.com/300x200?text=Oil+Filter',
              category: 'Engine Parts'
            },
            {
              id: 2,
              name: 'Brake Pads (Set of 4)',
              price: 45.99,
              description: 'Premium ceramic brake pads for improved stopping power',
              image: 'https://via.placeholder.com/300x200?text=Brake+Pads',
              category: 'Brake System'
            },
            {
              id: 3,
              name: 'LED Headlight Bulbs',
              price: 29.99,
              description: 'Ultra-bright LED replacement bulbs, 6000K white light',
              image: 'https://via.placeholder.com/300x200?text=LED+Headlights',
              category: 'Lighting'
            },
            {
              id: 4,
              name: 'Air Filter',
              price: 12.99,
              description: 'Replacement air filter for improved engine performance',
              image: 'https://via.placeholder.com/300x200?text=Air+Filter',
              category: 'Engine Parts'
            },
            {
              id: 5,
              name: 'Windshield Wiper Blades',
              price: 19.99,
              description: 'All-season silicone wiper blades for clear visibility',
              image: 'https://via.placeholder.com/300x200?text=Wiper+Blades',
              category: 'Exterior Accessories'
            },
            {
              id: 6,
              name: 'Car Battery',
              price: 89.99,
              description: '12V maintenance-free battery with 3-year warranty',
              image: 'https://via.placeholder.com/300x200?text=Car+Battery',
              category: 'Electrical System'
            }
          ]);
          setLoading(false);
        }, 500);
      } catch (err) {
        setError('Failed to load car parts. Please try again later.');
        setLoading(false);
        console.error('Error fetching car parts:', err);
      }
    };

    fetchCarParts();
  }, [apiClient]);

  if (loading) {
    return (
      <div className="car-parts-container loading">
        <div className="loading-spinner"></div>
        <p>Loading car parts...</p>
      </div>
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
          <input type="text" placeholder="Search parts..." />
          <button>Search</button>
        </div>
        <div className="filter-options">
          <select defaultValue="">
            <option value="" disabled>Select Category</option>
            <option value="all">All Categories</option>
            <option value="engine">Engine Parts</option>
            <option value="brakes">Brake System</option>
            <option value="electrical">Electrical System</option>
            <option value="lighting">Lighting</option>
            <option value="exterior">Exterior Accessories</option>
            <option value="interior">Interior Accessories</option>
          </select>
          <select defaultValue="newest">
            <option value="newest">Newest First</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
            <option value="popular">Most Popular</option>
          </select>
        </div>
      </div>
      
      <div className="car-parts-grid">
        {parts.map(part => (
          <div key={part.id} className="part-card">
            <div className="part-image">
              <img src={part.image} alt={part.name} />
            </div>
            <div className="part-details">
              <h3>{part.name}</h3>
              <p className="part-category">{part.category}</p>
              <p className="part-description">{part.description}</p>
              <div className="part-price-actions">
                <span className="part-price">${part.price.toFixed(2)}</span>
                <div className="part-actions">
                  <button className="add-to-cart">Add to Cart</button>
                  <Link to={`/car-parts/${part.id}`} className="view-details">
                    Details
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {parts.length === 0 && (
        <div className="no-parts">
          <p>No car parts found. Please try a different search or check back later.</p>
        </div>
      )}
    </div>
  );
};

export default CarParts; 