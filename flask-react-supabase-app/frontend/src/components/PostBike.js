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

  const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
  const MAX_IMAGES = 10;
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewImages, setPreviewImages] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const processFiles = (files) => {
    const validFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (selectedFiles.length + validFiles.length >= MAX_IMAGES) {
        setError(`Maximum ${MAX_IMAGES} images allowed`);
        break;
      }
      if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
        setError(`Invalid file type: ${file.name}. Supported: JPG, PNG, WEBP, GIF`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        setError(`File too large: ${file.name}. Max size: 5MB`);
        continue;
      }
      validFiles.push(file);
    }
    return validFiles;
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    const validFiles = processFiles(files);
    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
      const newPreviews = validFiles.map(file => URL.createObjectURL(file));
      setPreviewImages(prev => [...prev, ...newPreviews]);
    }
    e.target.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const validFiles = processFiles(files);
    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
      const newPreviews = validFiles.map(file => URL.createObjectURL(file));
      setPreviewImages(prev => [...prev, ...newPreviews]);
    }
  };

  const removeImage = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviewImages(prev => prev.filter((_, i) => i !== index));
  };

  const uploadImages = async () => {
    if (selectedFiles.length === 0) {
      throw new Error('At least one image is required');
    }
    const uploadFormData = new FormData();
    selectedFiles.forEach(file => {
      uploadFormData.append('images', file);
    });
    const response = await apiClient.post('/api/upload-images', uploadFormData);
    return response.urls || [];
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Check authentication first
    if (!user) {
      console.log('User not authenticated, showing auth modal');
      setShowAuthModal(true);
      return;
    }

    if (selectedFiles.length === 0) {
      setError('Please upload at least one image');
      setIsSubmitting(false);
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      // First upload images
      const imageUrls = await uploadImages();
      
      if (!imageUrls.length) {
        setError('Failed to upload bike images. Please try again.');
        setIsSubmitting(false);
        return;
      }

      const payload = {
        bike_brand: formData.bike_brand,
        bike_model: formData.bike_model,
        make: formData.bike_brand,
        model: formData.bike_model,
        year: Number(formData.year),
        bike_category: formData.bike_category,
        bike_type: formData.bike_category,
        engine_capacity: formData.engine_capacity,
        mileage: Number(formData.mileage),
        color: formData.color,
        condition: formData.condition,
        price: Number(formData.price),
        location: formData.location,
        description: formData.description,
        vin_number: formData.vin_number,
        is_dealer: formData.is_dealer,
        cylinders: formData.cylinders ? Number(formData.cylinders) : null,
        wheels: formData.wheels ? Number(formData.wheels) : null,
        features: formData.features,
        images: imageUrls
      };
      
      console.log('Submitting to API using apiClient on port 8000...');
      
      // Use the apiClient which handles auth tokens automatically
      const response = await apiClient.post('/api/bikes', payload);
      
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
                  if (e.target.value < 1886) e.target.value = 1886;
                  if (e.target.value > currentYear) e.target.value = currentYear;
                }}
                required
                placeholder="e.g., 2022"
                min="1886"
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
                  if (e.target.value < 0) e.target.value = '';
                }}
                required
                placeholder="e.g., 25000"
                min="0"
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
                name="features"
                value="ABS"
                checked={formData.features.includes('ABS')}
                onChange={handleChange}
              />
              <label htmlFor="features_abs">ABS</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_traction_control"
                name="features"
                value="Traction Control"
                checked={formData.features.includes('Traction Control')}
                onChange={handleChange}
              />
              <label htmlFor="features_traction_control">Traction Control</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_cruise_control"
                name="features"
                value="Cruise Control"
                checked={formData.features.includes('Cruise Control')}
                onChange={handleChange}
              />
              <label htmlFor="features_cruise_control">Cruise Control</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_heated_grips"
                name="features"
                value="Heated Grips"
                checked={formData.features.includes('Heated Grips')}
                onChange={handleChange}
              />
              <label htmlFor="features_heated_grips">Heated Grips</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_quick_shifter"
                name="features"
                value="Quick Shifter"
                checked={formData.features.includes('Quick Shifter')}
                onChange={handleChange}
              />
              <label htmlFor="features_quick_shifter">Quick Shifter</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_rider_modes"
                name="features"
                value="Rider Modes"
                checked={formData.features.includes('Rider Modes')}
                onChange={handleChange}
              />
              <label htmlFor="features_rider_modes">Rider Modes</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_led_lights"
                name="features"
                value="LED Lights"
                checked={formData.features.includes('LED Lights')}
                onChange={handleChange}
              />
              <label htmlFor="features_led_lights">LED Lights</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_bluetooth"
                name="features"
                value="Bluetooth Connectivity"
                checked={formData.features.includes('Bluetooth Connectivity')}
                onChange={handleChange}
              />
              <label htmlFor="features_bluetooth">Bluetooth Connectivity</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_usb_charging"
                name="features"
                value="USB Charging"
                checked={formData.features.includes('USB Charging')}
                onChange={handleChange}
              />
              <label htmlFor="features_usb_charging">USB Charging</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_touring_screen"
                name="features"
                value="Touring Screen"
                checked={formData.features.includes('Touring Screen')}
                onChange={handleChange}
              />
              <label htmlFor="features_touring_screen">Touring Screen</label>
            </div>
            
            <div className="checkbox-item">
              <input
                type="checkbox"
                id="features_saddlebags"
                name="features"
                value="Saddlebags/Panniers"
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
              <div className="dealer-toggle" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                <label className="toggle-switch" style={{ position: 'relative', display: 'inline-block', width: '52px', height: '28px' }}>
                  <input
                    type="checkbox"
                    checked={formData.is_dealer === true}
                    onChange={(e) => setFormData(prev => ({ ...prev, is_dealer: e.target.checked }))}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span className="toggle-slider" style={{ position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: formData.is_dealer ? '#4CAF50' : '#ccc', transition: '0.3s', borderRadius: '28px' }}>
                    <span style={{ position: 'absolute', content: '', height: '22px', width: '22px', left: formData.is_dealer ? '27px' : '3px', bottom: '3px', backgroundColor: 'white', transition: '0.3s', borderRadius: '50%' }}></span>
                  </span>
                </label>
                <span style={{ fontSize: '14px', color: formData.is_dealer ? '#4CAF50' : '#666', fontWeight: formData.is_dealer ? '600' : '400' }}>
                  {formData.is_dealer ? 'Yes, I am a dealer' : 'No, I am a private seller'}
                </span>
              </div>
              <small className="form-text text-muted">Toggle to indicate if you are posting this listing as a bike dealer</small>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Images</h2>
          <p className="form-note">Upload clear images of your bike. Include different angles, close-ups of any modifications, and any damage or wear.</p>
          
          <div className="image-upload-container">
            <div 
              className={`image-upload-container ${isDragOver ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="upload-area">
                <div className="upload-icon" aria-hidden="true"></div>
                <h4>Drag & Drop Images Here</h4>
                <p>or</p>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.gif"
                  multiple
                  onChange={handleFileChange}
                  className="file-input"
                  required
                />
                <button type="button" className="browse-btn">
                  Browse Files
                </button>
                <p className="upload-hint">Maximum 10 images • JPG, PNG, WEBP, GIF • 5MB each</p>
              </div>
              
              {previewImages.length > 0 && (
                <div className="image-previews mt-3">
                  <div className="row">
                    {previewImages.map((preview, index) => (
                      <div className="col-md-3 mb-2" key={index}>
                        <div className="preview-thumbnail">
                          <img src={preview} alt={`Preview ${index + 1}`} className="img-thumbnail" />
                          <button 
                            type="button" 
                            className="btn btn-sm btn-danger remove-image"
                            onClick={() => removeImage(index)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
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
