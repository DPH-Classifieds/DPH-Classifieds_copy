import React, { useState, useEffect } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useParams, useNavigate } from 'react-router-dom';
import { getAccessToken } from '../utils/supabaseClient';
import LoadingSpinner from './LoadingSpinner';
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
    contact_email: '',
    vin_number: '',
    body_type: '',
    fuel_type: '',
    transmission_type: '',
    regional_spec: '',
    seating_capacity: '',
    horsepower: '',
    engine_capacity: '',
    steering_side: '',
    is_insured: false,
    // Features/Extras
    climate_control: false,
    dvd_player: false,
    keyless_entry: false,
    navigation_system: false,
    premium_sound_system: false,
    cooled_seats: false,
    front_wheel_drive: false,
    leather_seats: false,
    parking_sensors: false,
    rear_view_camera: false
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
        car_variant: data.trim || data.car_variant || '',
        make_year: data.make_year || '',
        mileage: data.kilometer_driven || data.mileage || '',
        exterior_color: data.exterior_color || '',
        interior_color: data.interior_color || '',
        expected_selling_price: data.expected_selling_price || '',
        description: data.car_description || data.description || '',
        location: data.car_city || data.car_location || data.location || '',
        contact_phone: data.car_owner_phone_number || data.contact_phone || '',
        contact_email: data.contact_email || data.user_email || '',
        vin_number: data.vin_number || '',
        body_type: data.body_type || '',
        fuel_type: data.fuel_type || '',
        transmission_type: data.transmission_type || '',
        regional_spec: data.regional_spec || '',
        seating_capacity: data.seating_capacity || '',
        horsepower: data.horsepower || '',
        engine_capacity: data.engine_capacity || '',
        steering_side: data.steering_side || '',
        is_insured: data.is_insured || false,
        climate_control: data.climate_control || false,
        dvd_player: data.dvd_player || false,
        keyless_entry: data.keyless_entry || false,
        navigation_system: data.navigation_system || false,
        premium_sound_system: data.premium_sound_system || false,
        cooled_seats: data.cooled_seats || false,
        front_wheel_drive: data.front_wheel_drive || false,
        leather_seats: data.leather_seats || false,
        parking_sensors: data.parking_sensors || false,
        rear_view_camera: data.rear_view_camera || false
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
    const { name, value, type, checked } = e.target;
    
    if (type === 'checkbox') {
      setFormData({
        ...formData,
        [name]: checked
      });
    } else if (name === 'make_year' || name === 'mileage' || name === 'expected_selling_price') {
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
      <LoadingSpinner message="Loading listing data..." size="large" />
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
                min="1886"
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
              <label htmlFor="expected_selling_price">Price (AED)</label>
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
            <div className="form-group">
              <label htmlFor="vin_number">
                <span 
                  className="vin-label-tooltip"
                  title="VIN (Vehicle Identification Number) is a unique 17-character code that identifies your vehicle. You can find it on your vehicle registration document, insurance papers, or on the driver's side dashboard (visible through windshield), driver's side door jamb, or under the hood."
                  style={{ 
                    cursor: 'help',
                    borderBottom: '1px dotted #666'
                  }}
                >
                  VIN
                </span>
              </label>
              <input
                type="text"
                id="vin_number"
                name="vin_number"
                value={formData.vin_number}
                onChange={(e) => handleChange({...e, target: {...e.target, value: e.target.value.toUpperCase()}})}
                placeholder="Vehicle Identification Number (17 characters)"
                maxLength="17"
                style={{ textTransform: 'uppercase' }}
              />
              <small className="form-text text-muted">
                <strong>Where to find:</strong> Registration, insurance docs, dashboard, door jamb, or under hood
              </small>
            </div>
            
            <div className="form-group">
              <label htmlFor="body_type">Body Type</label>
              <SearchableSelect
                id="body_type"
                name="body_type"
                value={formData.body_type}
                onChange={handleChange}
              >
                <option value="">Select Body Type</option>
                <option value="Sedan">Sedan</option>
                <option value="SUV">SUV</option>
                <option value="Hatchback">Hatchback</option>
                <option value="Coupe">Coupe</option>
                <option value="Convertible">Convertible</option>
                <option value="Wagon">Wagon</option>
                <option value="Van">Van</option>
                <option value="Truck">Truck</option>
                <option value="Other">Other</option>
              </SearchableSelect>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="fuel_type">Fuel Type</label>
              <SearchableSelect
                id="fuel_type"
                name="fuel_type"
                value={formData.fuel_type}
                onChange={handleChange}
              >
                <option value="">Select Fuel Type</option>
                <option value="Petrol">Petrol</option>
                <option value="Diesel">Diesel</option>
                <option value="Electric">Electric</option>
                <option value="Hybrid">Hybrid</option>
                <option value="Other">Other</option>
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="transmission_type">Transmission</label>
              <SearchableSelect
                id="transmission_type"
                name="transmission_type"
                value={formData.transmission_type}
                onChange={handleChange}
              >
                <option value="">Select Transmission</option>
                <option value="Automatic">Automatic</option>
                <option value="Manual">Manual</option>
              </SearchableSelect>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="regional_spec">Regional Spec</label>
              <SearchableSelect
                id="regional_spec"
                name="regional_spec"
                value={formData.regional_spec}
                onChange={handleChange}
              >
                <option value="">Select Regional Spec</option>
                <option value="GCC">GCC</option>
                <option value="North American">North American</option>
                <option value="European">European</option>
                <option value="Japanese">Japanese</option>
                <option value="Korean">Korean</option>
                <option value="Chinese">Chinese</option>
                <option value="Other">Other</option>
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="steering_side">Steering Side</label>
              <SearchableSelect
                id="steering_side"
                name="steering_side"
                value={formData.steering_side}
                onChange={handleChange}
              >
                <option value="">Select Steering Side</option>
                <option value="Left">Left</option>
                <option value="Right">Right</option>
              </SearchableSelect>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="seating_capacity">Seating Capacity</label>
              <SearchableSelect
                id="seating_capacity"
                name="seating_capacity"
                value={formData.seating_capacity}
                onChange={handleChange}
              >
                <option value="">Select Seating</option>
                <option value="2">2 Seats</option>
                <option value="4">4 Seats</option>
                <option value="5">5 Seats</option>
                <option value="6">6 Seats</option>
                <option value="7">7 Seats</option>
                <option value="8">8 Seats</option>
                <option value="9+">9+ Seats</option>
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="horsepower">Horsepower</label>
              <input
                type="text"
                id="horsepower"
                name="horsepower"
                value={formData.horsepower}
                onChange={handleChange}
                placeholder="e.g. 250 HP"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="engine_capacity">Engine Capacity</label>
              <input
                type="text"
                id="engine_capacity"
                name="engine_capacity"
                value={formData.engine_capacity}
                onChange={handleChange}
                placeholder="e.g. 2.5L or 2500cc"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="is_insured">
                <input
                  type="checkbox"
                  id="is_insured"
                  name="is_insured"
                  checked={formData.is_insured}
                  onChange={handleChange}
                />
                <span>Vehicle is Insured</span>
              </label>
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
          <h2>Features & Extras</h2>
          
          <div className="features-grid">
            <div className="feature-item">
              <label htmlFor="climate_control">
                <input
                  type="checkbox"
                  id="climate_control"
                  name="climate_control"
                  checked={formData.climate_control}
                  onChange={handleChange}
                />
                <span>Climate Control</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="dvd_player">
                <input
                  type="checkbox"
                  id="dvd_player"
                  name="dvd_player"
                  checked={formData.dvd_player}
                  onChange={handleChange}
                />
                <span>DVD Player</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="keyless_entry">
                <input
                  type="checkbox"
                  id="keyless_entry"
                  name="keyless_entry"
                  checked={formData.keyless_entry}
                  onChange={handleChange}
                />
                <span>Keyless Entry</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="navigation_system">
                <input
                  type="checkbox"
                  id="navigation_system"
                  name="navigation_system"
                  checked={formData.navigation_system}
                  onChange={handleChange}
                />
                <span>Navigation System</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="premium_sound_system">
                <input
                  type="checkbox"
                  id="premium_sound_system"
                  name="premium_sound_system"
                  checked={formData.premium_sound_system}
                  onChange={handleChange}
                />
                <span>Premium Sound System</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="cooled_seats">
                <input
                  type="checkbox"
                  id="cooled_seats"
                  name="cooled_seats"
                  checked={formData.cooled_seats}
                  onChange={handleChange}
                />
                <span>Cooled Seats</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="front_wheel_drive">
                <input
                  type="checkbox"
                  id="front_wheel_drive"
                  name="front_wheel_drive"
                  checked={formData.front_wheel_drive}
                  onChange={handleChange}
                />
                <span>Front Wheel Drive</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="leather_seats">
                <input
                  type="checkbox"
                  id="leather_seats"
                  name="leather_seats"
                  checked={formData.leather_seats}
                  onChange={handleChange}
                />
                <span>Leather Seats</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="parking_sensors">
                <input
                  type="checkbox"
                  id="parking_sensors"
                  name="parking_sensors"
                  checked={formData.parking_sensors}
                  onChange={handleChange}
                />
                <span>Parking Sensors</span>
              </label>
            </div>
            
            <div className="feature-item">
              <label htmlFor="rear_view_camera">
                <input
                  type="checkbox"
                  id="rear_view_camera"
                  name="rear_view_camera"
                  checked={formData.rear_view_camera}
                  onChange={handleChange}
                />
                <span>Rear View Camera</span>
              </label>
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
                    <img src={image.image_url || image.url} alt={`Car ${index + 1}`} />
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
                accept=".jpg,.jpeg,.png,.webp,.gif"
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
