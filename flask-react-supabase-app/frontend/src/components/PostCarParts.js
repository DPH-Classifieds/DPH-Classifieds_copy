import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/PostForms.css';

const PostCarParts = () => {
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [formData, setFormData] = useState({
    part_name: '',
    part_type: '',
    condition: 'New',
    compatible_makes: [],
    compatible_models: [],
    price: '',
    location: '',
    description: '',
    images: []
  });

  // Check if user is logged in when component loads
  useEffect(() => {
    const checkAuth = async () => {
      await syncWithSupabase();
    };
    
    checkAuth();
    
    if (!isLoading && !user) {
      console.log('User not authenticated, showing auth modal');
      setShowAuthModal(true);
    } else if (user) {
      console.log('User authenticated:', user.email);
      setShowAuthModal(false);
    }
  }, [user, isLoading, syncWithSupabase]);

  // Authentication modal component
  const AuthModal = () => {
    return (
      <div className="auth-modal-overlay">
        <div className="auth-modal">
          <h2>Authentication Required</h2>
          <p>Please log in or sign up to post a listing.</p>
          <div className="auth-modal-buttons">
            <button 
              onClick={() => navigate('/login')}
              className="btn btn-primary"
            >
              Log In
            </button>
            <button 
              onClick={() => navigate('/signup')}
              className="btn btn-secondary"
            >
              Sign Up
            </button>
          </div>
        </div>
      </div>
    );
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    setFormData(prev => ({
      ...prev,
      images: [...prev.images, ...files]
    }));
  };

  const removeImage = (index) => {
    setFormData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Check authentication first
    if (!user) {
      console.log('User not authenticated, showing auth modal');
      setShowAuthModal(true);
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      // Prepare form data
      const apiFormData = new FormData(e.target);
      
      // Get compatible makes and models as arrays
      const compatibleMakes = Array.from(
        document.querySelectorAll('input[name="compatible_makes"]:checked')
      ).map(input => input.value);
      
      const compatibleModels = Array.from(
        document.querySelectorAll('input[name="compatible_models"]:checked')
      ).map(input => input.value);
      
      // Add arrays as JSON strings
      apiFormData.delete('compatible_makes');
      apiFormData.delete('compatible_models');
      apiFormData.append('compatible_makes', JSON.stringify(compatibleMakes));
      apiFormData.append('compatible_models', JSON.stringify(compatibleModels));
      
      // Add images from file inputs
      const images = document.getElementById('part_images').files;
      for (let i = 0; i < images.length; i++) {
        apiFormData.append(`image_${i}`, images[i]);
      }
      
      console.log('Submitting to API using apiClient on port 8000...');
      
      // Use the apiClient which handles auth tokens automatically
      const response = await apiClient.post('/api/parts', apiFormData);
      
      console.log('Car parts listing submitted successfully:', response);
      setSuccess(true);
      
      // Navigate after success message is shown
      setTimeout(() => {
        navigate('/my-listings');
      }, 2000);
    } catch (err) {
      console.error('API submission error:', err);
      
      // More specific error handling
      let errorMessage = err.response?.data?.error || 'Failed to submit car parts listing';
      const status = err.response?.status || err.status;
      if (status === 401) {
        errorMessage = 'Authentication failed. Please log in again.';
      } else if (status === 403) {
        errorMessage = 'You do not have permission to perform this action.';
      } else if (status === 404) {
        errorMessage = 'API endpoint not found. Please contact support.';
      } else if (status === 500) {
        errorMessage = 'Server error. Please try again later.';
      } else if (err.message && !err.response?.data?.error) {
        errorMessage = `${errorMessage}: ${err.message}`;
      }
      
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your car parts listing has been successfully submitted.</p>
        <p>You will be redirected to your listings page shortly...</p>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      {showAuthModal && <AuthModal />}
      
      <div className="post-form-header">
        <h1>Post Car Parts for Sale</h1>
        <p>Fill in the details below to list your car parts on our marketplace</p>
      </div>
      
      {error && (
        <div className="form-error-message">
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="post-form">
        <div className="form-section">
          <h2>Car Part Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="item">Item Description *</label>
              <input
                type="text"
                id="item"
                name="item"
                value={formData.item}
                onChange={handleChange}
                required
                placeholder="e.g., Headlight Assembly, Brake Pads, etc."
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="make">Make *</label>
              <input
                type="text"
                id="make"
                name="make"
                value={formData.make}
                onChange={handleChange}
                required
                placeholder="e.g., BMW, Toyota, Honda"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="model">Model *</label>
              <input
                type="text"
                id="model"
                name="model"
                value={formData.model}
                onChange={handleChange}
                required
                placeholder="e.g., X5, Camry, Civic"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="year">Year *</label>
              <input
                type="number"
                id="year"
                name="year"
                value={formData.year}
                onChange={handleChange}
                required
                placeholder="e.g., 2018"
                min="1900"
                max={new Date().getFullYear()}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="price">Price (AED) *</label>
              <input
                type="number"
                id="price"
                name="price"
                value={formData.price}
                onChange={handleChange}
                required
                placeholder="e.g., 500"
                min="0"
              />
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Images</h2>
          <p className="form-note">Upload clear images of the part from multiple angles.</p>
          
          <div className="image-upload-container">
            <label className="image-upload-label">
              <span>Select Images</span>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageChange}
                className="image-upload-input"
              />
            </label>
            
            <div className="image-preview-container">
              {formData.images.length > 0 ? (
                formData.images.map((image, index) => (
                  <div key={index} className="image-preview-item">
                    <img 
                      src={URL.createObjectURL(image)} 
                      alt={`Preview ${index}`} 
                      className="image-preview"
                    />
                    <button 
                      type="button" 
                      className="remove-image-btn"
                      onClick={() => removeImage(index)}
                    >
                      ✕
                    </button>
                  </div>
                ))
              ) : (
                <div className="no-images-message">
                  No images selected
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="form-actions">
          <button 
            type="submit" 
            className="submit-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Listing'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PostCarParts; 
