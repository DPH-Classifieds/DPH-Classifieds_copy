import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/CarParts.css';

const CarParts = () => {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    const fetchCarParts = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/api/parts');
        if (!Array.isArray(response)) {
          throw new Error('Unexpected response for parts list.');
        }
        setParts(response);
      } catch (err) {
        setError('Failed to load car parts. Please try again later.');
        console.error('Error fetching car parts:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchCarParts();
  }, []);

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
              <img src={part.image || part.image_url || part.images?.[0]?.image_url || part.images?.[0]?.url} alt={part.name || part.part_name} />
            </div>
            <div className="part-details">
              <h3>{part.name || part.part_name}</h3>
              {part.category && <p className="part-category">{part.category}</p>}
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
      
      {parts.length === 0 && (
        <div className="no-parts">
          <p>No car parts found. Please try a different search or check back later.</p>
        </div>
      )}
    </div>
  );
};

export default CarParts; 
