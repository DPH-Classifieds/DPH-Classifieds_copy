import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/PostForms.css';

const PostBike = () => {
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [formData, setFormData] = useState({
    bike_brand: '',
    bike_model: '',
    year: '',
    bike_category: '',
    engine_capacity: '',
    mileage: '',
    color: '',
    condition: 'Good',
    price: '',
    location: '',
    description: '',
    vin_number: '',
    is_dealer: false,
    cylinders: '',
    wheels: '2',
    features: [],
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
    
    if (type === 'checkbox') {
      // Handle features checkboxes
      if (name === 'features') {
        setFormData(prev => {
          const newFeatures = [...prev.features];
          if (checked) {
            newFeatures.push(value);
          } else {
            const index = newFeatures.indexOf(value);
            if (index !== -1) {
              newFeatures.splice(index, 1);
            }
          }
          return { ...prev, features: newFeatures };
        });
      } else {
        setFormData(prev => ({ ...prev, [name]: checked }));
      }
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
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
      // Create form data for API submission
      const apiFormData = new FormData();
      
      // Add all form fields to the FormData
      for (const key in formData) {
        if (key === 'features') {
          // Convert features array to JSON string
          apiFormData.append(key, JSON.stringify(formData[key]));
        } else if (key !== 'images') {
          apiFormData.append(key, formData[key]);
        }
      }
      
      // Add images
      formData.images.forEach((image, index) => {
        apiFormData.append(`image_${index}`, image);
      });
      
      console.log('Submitting to API using apiClient on port 8000...');
      
      // Use the apiClient which handles auth tokens automatically
      const response = await apiClient.post('/api/bikes', apiFormData);
      
      console.log('Bike listing submitted successfully:', response);
      setSuccess(true);
      
      // Navigate after success message is shown
      setTimeout(() => {
        navigate('/my-listings');
      }, 2000);
    } catch (err) {
      console.error('API submission error:', err);
      
      // More specific error handling
      let errorMessage = err.response?.data?.error || 'Failed to submit bike listing';
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
        <p>Your bike listing has been successfully submitted.</p>
        <p>You will be redirected to your listings page shortly...</p>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      {showAuthModal && <AuthModal />}
      
      <div className="post-form-header">
        <h1>Post a Bike for Sale</h1>
        <p>Fill in the details below to list your bike on our marketplace</p>
      </div>
      
      {error && (
        <div className="form-error-message">
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="post-form">
        <div className="form-section">
          <h2>Basic Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="bike_brand">Brand *</label>
              <input
                type="text"
                id="bike_brand"
                name="bike_brand"
                value={formData.bike_brand}
                onChange={handleChange}
                required
                placeholder="e.g., Yamaha"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="bike_model">Model *</label>
              <input
                type="text"
                id="bike_model"
                name="bike_model"
                value={formData.bike_model}
                onChange={handleChange}
                required
                placeholder="e.g., MT-09"
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
                onInput={(e) => {
                  // Prevent values outside valid range
                  const currentYear = new Date().getFullYear();
                  if (e.target.value < 1900) e.target.value = 1900;
                  if (e.target.value > currentYear) e.target.value = currentYear;
                }}
                required
                placeholder="e.g., 2022"
                min="1900"
                max={new Date().getFullYear()}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="bike_category">Category *</label>
              <select
                id="bike_category"
                name="bike_category"
                value={formData.bike_category}
                onChange={handleChange}
                required
              >
                <option value="">Select Category</option>
                <option value="Sport">Sport</option>
                <option value="Cruiser">Cruiser</option>
                <option value="Touring">Touring</option>
                <option value="Adventure">Adventure</option>
                <option value="Naked">Naked</option>
                <option value="Dual Sport">Dual Sport</option>
                <option value="Off-road">Off-road</option>
                <option value="Scooter">Scooter</option>
                <option value="Commuter">Commuter</option>
                <option value="Electric">Electric</option>
              </select>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="condition">Condition *</label>
              <select
                id="condition"
                name="condition"
                value={formData.condition}
                onChange={handleChange}
                required
              >
                <option value="Good">Good</option>
                <option value="Used">Used</option>
                <option value="New">New</option>
                <option value="Like New">Like New</option>
                <option value="Project/Needs Work">Project/Needs Work</option>
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="color">Color *</label>
              <input
                type="text"
                id="color"
                name="color"
                value={formData.color}
                onChange={handleChange}
                required
                placeholder="e.g., Matte Black"
              />
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Performance & Specifications</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="engine_capacity">Engine Capacity *</label>
              <input
                type="text"
                id="engine_capacity"
                name="engine_capacity"
                value={formData.engine_capacity}
                onChange={handleChange}
                required
                placeholder="e.g., 890cc"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="mileage">Mileage (km) *</label>
              <input
                type="number"
                id="mileage"
                name="mileage"
                value={formData.mileage}
                onChange={handleChange}
                required
                placeholder="e.g., 3500"
                min="0"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="cylinders">Number of Cylinders</label>
              <select
                id="cylinders"
                name="cylinders"
                value={formData.cylinders}
                onChange={handleChange}
              >
                <option value="">Select Cylinders</option>
                <option value="1">1 Cylinder</option>
                <option value="2">2 Cylinders</option>
                <option value="3">3 Cylinders</option>
                <option value="4">4 Cylinders</option>
                <option value="6">6 Cylinders</option>
                <option value="8">8 Cylinders</option>
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="wheels">Number of Wheels</label>
              <select
                id="wheels"
                name="wheels"
                value={formData.wheels}
                onChange={handleChange}
              >
                <option value="2">2 Wheels (Motorcycle)</option>
                <option value="3">3 Wheels (Trike)</option>
              </select>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="vin_number">
                <span 
                  className="vin-label-tooltip"
                  title="VIN (Vehicle Identification Number) is a unique 17-character code that identifies your bike. You can find it on your vehicle registration document, insurance papers, on the frame neck (under handlebars), on the frame near the engine, or on the engine casing."
                  style={{ 
                    cursor: 'help',
                    borderBottom: '1px dotted #666'
                  }}
                >
                  VIN
                </span> <span className="text-muted">(Vehicle Identification Number)</span>
              </label>
              <input
                type="text"
                id="vin_number"
                name="vin_number"
                value={formData.vin_number}
                onChange={(e) => {
                  const upperValue = e.target.value.toUpperCase();
                  handleChange({ target: { name: 'vin_number', value: upperValue } });
                }}
                placeholder="e.g., 1HGCM82633A123456"
                style={{ textTransform: 'uppercase' }}
                maxLength="17"
              />
              <div className="form-text">
                <strong>Where to find your VIN:</strong> Check your bike registration, insurance documents, frame neck (under handlebars), frame near the engine, or on the engine casing.
              </div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="price">Price (AED) *</label>
              <input
                type="number"
                id="price"
                name="price"
                value={formData.price}
                onChange={handleChange}
                onInput={(e) => {
                  // Prevent negative values
                  if (e.target.value < 1) e.target.value = '';
                }}
                required
                placeholder="e.g., 25000"
                min="1"
                step="1"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="location">Location *</label>
              <input
                type="text"
                id="location"
                name="location"
                value={formData.location}
                onChange={handleChange}
                required
                placeholder="e.g., Dubai"
              />
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Features & Equipment</h2>
          
          <div className="checkbox-group">
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_abs"
                name="features_abs"
                checked={formData.features.includes('ABS')}
                onChange={handleChange}
              />
              <label htmlFor="features_abs">ABS</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_traction_control"
                name="features_traction_control"
                checked={formData.features.includes('Traction Control')}
                onChange={handleChange}
              />
              <label htmlFor="features_traction_control">Traction Control</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_cruise_control"
                name="features_cruise_control"
                checked={formData.features.includes('Cruise Control')}
                onChange={handleChange}
              />
              <label htmlFor="features_cruise_control">Cruise Control</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_heated_grips"
                name="features_heated_grips"
                checked={formData.features.includes('Heated Grips')}
                onChange={handleChange}
              />
              <label htmlFor="features_heated_grips">Heated Grips</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_quick_shifter"
                name="features_quick_shifter"
                checked={formData.features.includes('Quick Shifter')}
                onChange={handleChange}
              />
              <label htmlFor="features_quick_shifter">Quick Shifter</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_rider_modes"
                name="features_rider_modes"
                checked={formData.features.includes('Rider Modes')}
                onChange={handleChange}
              />
              <label htmlFor="features_rider_modes">Rider Modes</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_led_lights"
                name="features_led_lights"
                checked={formData.features.includes('LED Lights')}
                onChange={handleChange}
              />
              <label htmlFor="features_led_lights">LED Lights</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_bluetooth"
                name="features_bluetooth"
                checked={formData.features.includes('Bluetooth Connectivity')}
                onChange={handleChange}
              />
              <label htmlFor="features_bluetooth">Bluetooth Connectivity</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_usb_charging"
                name="features_usb_charging"
                checked={formData.features.includes('USB Charging')}
                onChange={handleChange}
              />
              <label htmlFor="features_usb_charging">USB Charging</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_touring_screen"
                name="features_touring_screen"
                checked={formData.features.includes('Touring Screen')}
                onChange={handleChange}
              />
              <label htmlFor="features_touring_screen">Touring Screen</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_saddlebags"
                name="features_saddlebags"
                checked={formData.features.includes('Saddlebags/Panniers')}
                onChange={handleChange}
              />
              <label htmlFor="features_saddlebags">Saddlebags/Panniers</label>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Description</h2>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="description">Description *</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                required
                rows="5"
                placeholder="Provide detailed information about your bike, including its condition, history, modifications, and any additional features"
              ></textarea>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Are you a dealer?</label>
              <div className="radio-group" style={{ display: 'flex', gap: '20px', marginTop: '8px' }}>
                <label className="radio-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="is_dealer"
                    value="yes"
                    checked={formData.is_dealer === true}
                    onChange={() => setFormData(prev => ({ ...prev, is_dealer: true }))}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                  />
                  <span>Yes</span>
                </label>
                <label className="radio-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="is_dealer"
                    value="no"
                    checked={formData.is_dealer === false}
                    onChange={() => setFormData(prev => ({ ...prev, is_dealer: false }))}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                  />
                  <span>No</span>
                </label>
              </div>
              <small className="form-text text-muted">Select "Yes" if you are posting this listing as a bike dealer</small>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Images</h2>
          <p className="form-note">Upload clear images of your bike. Include different angles, close-ups of any modifications, and any damage or wear.</p>
          
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

export default PostBike; 
