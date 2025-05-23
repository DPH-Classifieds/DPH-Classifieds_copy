import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAccessToken } from '../utils/supabaseClient';
import '../styles/CreateListing.css'; // Reuse the same styles as CreateListing

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const EditListing = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [formData, setFormData] = useState({
    listing_title: '',
    car_manufacturer: '',
    car_model: '',
    car_variant: '',
    make_year: '',
    mileage: '',
    exterior_color: '',
    interior_color: '',
    expected_selling_price: '',
    description: '',
    location: '',
    contact_phone: '',
    contact_email: ''
  });
  
  const [images, setImages] = useState([]);
  const [newImages, setNewImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  
  // Fetch the listing data when component mounts
  useEffect(() => {
    fetchListing();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  
  const fetchListing = async () => {
    try {
      const token = await getAccessToken();
      
      if (!token) {
        throw new Error('Authentication token not found');
      }
      
      const response = await fetch(`${API_URL}/api/cars/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch listing');
      }
      
      const data = await response.json();
      
      // Format the data for the form
      setFormData({
        listing_title: data.listing_title || '',
        car_manufacturer: data.car_manufacturer || '',
        car_model: data.car_model || '',
        car_variant: data.car_variant || '',
        make_year: data.make_year || '',
        mileage: data.mileage || '',
        exterior_color: data.exterior_color || '',
        interior_color: data.interior_color || '',
        expected_selling_price: data.expected_selling_price || '',
        description: data.description || '',
        location: data.location || '',
        contact_phone: data.contact_phone || '',
        contact_email: data.contact_email || ''
      });
      
      // Set the existing images
      if (data.images && data.images.length > 0) {
        setImages(data.images);
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error fetching listing:', err);
      setError('Could not load listing. Please try again later.');
      setLoading(false);
    }
  };
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    
    // Convert numeric values
    if (name === 'make_year' || name === 'mileage' || name === 'expected_selling_price') {
      setFormData({
        ...formData,
        [name]: value === '' ? '' : Number(value)
      });
    } else {
      setFormData({
        ...formData,
        [name]: value
      });
    }
  };
  
  const handleImageChange = (e) => {
    if (e.target.files) {
      setNewImages(Array.from(e.target.files));
    }
  };
  
  const handleDeleteImage = (index) => {
    const updatedImages = [...images];
    updatedImages.splice(index, 1);
    setImages(updatedImages);
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    
    try {
      const token = await getAccessToken();
      
      if (!token) {
        throw new Error('Authentication token not found');
      }
      
      // Create form data to send images
      const formDataToSend = new FormData();
      
      // Add all form fields to the form data
      Object.entries(formData).forEach(([key, value]) => {
        if (value !== '') {
          formDataToSend.append(key, value);
        }
      });
      
      // Add image IDs to keep
      images.forEach(image => {
        formDataToSend.append('keep_image_ids', image.id);
      });
      
      // Add new images
      newImages.forEach(image => {
        formDataToSend.append('images', image);
      });
      
      // Send the PUT request
      const response = await fetch(`${API_URL}/api/cars/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formDataToSend
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update listing');
      }
      
      // Redirect to the listing page on success
      navigate(`/cars/${id}`);
    } catch (err) {
      console.error('Error updating listing:', err);
      setError(err.message || 'Failed to update the listing. Please try again.');
      setSubmitting(false);
    }
  };
  
  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading listing data...</p>
      </div>
    );
  }
  
  return (
    <div className="create-listing-container">
      <h1 className="section-title">Edit Listing</h1>
      
      {error && <div className="alert alert-danger">{error}</div>}
      
      <form className="create-listing-form" onSubmit={handleSubmit}>
        <div className="form-section">
          <h2>Basic Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="listing_title">Listing Title</label>
              <input
                type="text"
                id="listing_title"
                name="listing_title"
                value={formData.listing_title}
                onChange={handleChange}
                placeholder="e.g. 2019 Toyota Camry XSE - Low Miles, Great Condition"
                required
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_manufacturer">Manufacturer</label>
              <input
                type="text"
                id="car_manufacturer"
                name="car_manufacturer"
                value={formData.car_manufacturer}
                onChange={handleChange}
                placeholder="e.g. Toyota"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="car_model">Model</label>
              <input
                type="text"
                id="car_model"
                name="car_model"
                value={formData.car_model}
                onChange={handleChange}
                placeholder="e.g. Camry"
                required
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_variant">Variant/Trim</label>
              <input
                type="text"
                id="car_variant"
                name="car_variant"
                value={formData.car_variant}
                onChange={handleChange}
                placeholder="e.g. XSE"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="make_year">Year</label>
              <input
                type="number"
                id="make_year"
                name="make_year"
                value={formData.make_year}
                onChange={handleChange}
                placeholder="e.g. 2019"
                min="1900"
                max={new Date().getFullYear() + 1}
                required
              />
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Vehicle Details</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="mileage">Mileage</label>
              <input
                type="number"
                id="mileage"
                name="mileage"
                value={formData.mileage}
                onChange={handleChange}
                placeholder="e.g. 35000"
                min="0"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="expected_selling_price">Price ($)</label>
              <input
                type="number"
                id="expected_selling_price"
                name="expected_selling_price"
                value={formData.expected_selling_price}
                onChange={handleChange}
                placeholder="e.g. 25000"
                min="0"
                required
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="exterior_color">Exterior Color</label>
              <input
                type="text"
                id="exterior_color"
                name="exterior_color"
                value={formData.exterior_color}
                onChange={handleChange}
                placeholder="e.g. Midnight Black"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="interior_color">Interior Color</label>
              <input
                type="text"
                id="interior_color"
                name="interior_color"
                value={formData.interior_color}
                onChange={handleChange}
                placeholder="e.g. Black Leather"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="Describe your car in detail, including condition, features, history, etc."
                rows="6"
                required
              ></textarea>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Contact Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="location">Location</label>
              <input
                type="text"
                id="location"
                name="location"
                value={formData.location}
                onChange={handleChange}
                placeholder="e.g. Los Angeles, CA"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="contact_phone">Phone</label>
              <input
                type="tel"
                id="contact_phone"
                name="contact_phone"
                value={formData.contact_phone}
                onChange={handleChange}
                placeholder="e.g. 555-123-4567"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="contact_email">Email</label>
              <input
                type="email"
                id="contact_email"
                name="contact_email"
                value={formData.contact_email}
                onChange={handleChange}
                placeholder="e.g. your@email.com"
                required
              />
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Images</h2>
          
          <div className="current-images">
            <h3>Current Images</h3>
            {images.length === 0 ? (
              <p>No images currently uploaded.</p>
            ) : (
              <div className="image-preview-container">
                {images.map((image, index) => (
                  <div key={image.id} className="image-preview">
                    <img src={image.url} alt={`Car ${index + 1}`} />
                    <button
                      type="button"
                      className="remove-image-btn"
                      onClick={() => handleDeleteImage(index)}
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="images">Add New Images</label>
              <input
                type="file"
                id="images"
                name="images"
                onChange={handleImageChange}
                multiple
                accept="image/*"
              />
              <small className="form-hint">You can select multiple images at once.</small>
            </div>
          </div>
          
          {newImages.length > 0 && (
            <div className="new-images-preview">
              <h3>New Images to Upload</h3>
              <div className="image-preview-container">
                {newImages.map((image, index) => (
                  <div key={index} className="image-preview">
                    <img src={URL.createObjectURL(image)} alt={`New ${index + 1}`} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(-1)}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? 'Updating...' : 'Update Listing'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default EditListing; 