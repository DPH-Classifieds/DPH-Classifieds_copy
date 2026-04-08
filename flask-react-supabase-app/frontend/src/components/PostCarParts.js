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
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewImages, setPreviewImages] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [formData, setFormData] = useState({
    part_name: '',
    part_type: '',
    condition: 'New',
    compatible_makes: [],
    compatible_models: [],
    price: '',
    location: '',
    description: '',
    is_dealer: false
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

  const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
  const MAX_IMAGES = 10;

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
      
      // Prepare JSON payload
      const payload = {
        name: formData.part_name,
        part_type: formData.part_type,
        condition: formData.condition,
        price: parseFloat(formData.price),
        location: formData.location,
        description: formData.description,
        is_dealer: formData.is_dealer,
        images: imageUrls
      };
      
      console.log('Submitting to API using apiClient on port 8000...');
      
      // Use the apiClient which handles auth tokens automatically
      const response = await apiClient.post('/api/parts', payload);
      
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

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Are you a dealer?</label>
            <div className="toggle-container" style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
              <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
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
              <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
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
            </div>
            <small className="form-text text-muted">Select "Yes" if you are posting this listing as a parts dealer</small>
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
