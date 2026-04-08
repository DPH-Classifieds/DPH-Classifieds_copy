import React, { useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getAccessToken } from '../utils/authService';
import { countryCodes, defaultCountryCode } from '../utils/countryCodes';
import '../styles/CreateListing.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const CreateListing = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    car_manufacturer: '',
    car_model: '',
    make_year: '',
    trim: '',
    expected_selling_price: '',
    car_city: '',
    mileage: '',
    fuel_type: '',
    transmission: '',
    color: '',
    interior_color: '',
    engine: '',
    vin_number: '',
    car_description: '',
    country_code: defaultCountryCode,
    contact_phone: '',
    contact_email: ''
  });
  
  // List of manufacturers for dropdown
  const manufacturers = [
    'Toyota', 'Honda', 'Ford', 'Chevrolet', 'Nissan', 
    'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Hyundai', 
    'Kia', 'Mazda', 'Subaru', 'Lexus', 'Acura',
    'Jeep', 'Ram', 'Dodge', 'Chrysler', 'GMC',
    'Buick', 'Cadillac', 'Lincoln', 'Infiniti', 'Volvo',
    'Land Rover', 'Jaguar', 'Porsche', 'Tesla', 'Other'
  ].sort();
  
  // Cities list for dropdown
  const cities = [
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
    'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose',
    'Austin', 'Jacksonville', 'Fort Worth', 'Columbus', 'San Francisco',
    'Charlotte', 'Indianapolis', 'Seattle', 'Denver', 'Washington',
    'Boston', 'El Paso', 'Nashville', 'Detroit', 'Oklahoma City',
    'Portland', 'Las Vegas', 'Memphis', 'Louisville', 'Baltimore'
  ].sort();
  
  // Fuel types for dropdown
  const fuelTypes = [
    'Gasoline', 'Diesel', 'Hybrid', 'Electric', 'Plug-in Hybrid',
    'Natural Gas', 'Flex Fuel', 'Other'
  ];
  
  // Transmission types for dropdown
  const transmissionTypes = [
    'Automatic', 'Manual'
  ];
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const token = await getAccessToken();
      
      if (!token) {
        setError('You must be logged in to create a listing');
        setLoading(false);
        return;
      }
      
      // Format the data for submission
      const submitData = { ...formData };
      
      // Convert numeric fields
      if (submitData.make_year) submitData.make_year = parseInt(submitData.make_year);
      if (submitData.expected_selling_price) submitData.expected_selling_price = parseFloat(submitData.expected_selling_price);
      if (submitData.mileage) submitData.mileage = parseInt(submitData.mileage);
      
      // Make authenticated request
      const response = await axios.post(`${API_URL}/api/cars`, submitData, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      setSuccess(true);
      
      // Navigate to the new listing after a brief delay
      setTimeout(() => {
        navigate(`/cars/${response.data.id}`);
      }, 2000);
    } catch (err) {
      console.error('Error creating listing:', err);
      setError(err.response?.data?.error || 'Failed to create listing. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  if (success) {
    return (
      <div className="success-message">
        <h2>Listing Created Successfully!</h2>
        <p>Your car listing has been submitted. Redirecting...</p>
      </div>
    );
  }
  
  return (
    <div className="create-listing-container">
      <h1>Create New Car Listing</h1>
      
      {error && (
        <div className="form-error-message">
          <p>{error}</p>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="create-listing-form">
        <div className="form-section">
          <h2>Car Details</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_manufacturer">Manufacturer *</label>
              <SearchableSelect 
                id="car_manufacturer" 
                name="car_manufacturer" 
                value={formData.car_manufacturer} 
                onChange={handleChange}
                required
              >
                <option value="">Select Manufacturer</option>
                {manufacturers.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="car_model">Model *</label>
              <input 
                type="text" 
                id="car_model" 
                name="car_model" 
                value={formData.car_model} 
                onChange={handleChange} 
                placeholder="e.g., Camry, Civic, etc."
                required
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="make_year">Year *</label>
              <input 
                type="number" 
                id="make_year" 
                name="make_year" 
                value={formData.make_year} 
                onChange={handleChange} 
                placeholder="Year of manufacture"
                min="1886"
                max="2099"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="trim">Trim Level</label>
              <input 
                type="text" 
                id="trim" 
                name="trim" 
                value={formData.trim} 
                onChange={handleChange} 
                placeholder="e.g., LE, EX, etc."
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="expected_selling_price">Price (AED) *</label>
              <input 
                type="number" 
                id="expected_selling_price" 
                name="expected_selling_price" 
                value={formData.expected_selling_price} 
                onChange={handleChange} 
                placeholder="Expected selling price"
                min="0"
                step="0.01"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="car_city">City</label>
              <SearchableSelect 
                id="car_city" 
                name="car_city" 
                value={formData.car_city} 
                onChange={handleChange}
              >
                <option value="">Select City</option>
                {cities.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </SearchableSelect>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Vehicle Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="mileage">Mileage</label>
              <input 
                type="number" 
                id="mileage" 
                name="mileage" 
                value={formData.mileage} 
                onChange={handleChange} 
                placeholder="Current odometer reading"
                min="0"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="fuel_type">Fuel Type</label>
              <SearchableSelect 
                id="fuel_type" 
                name="fuel_type" 
                value={formData.fuel_type} 
                onChange={handleChange}
              >
                <option value="">Select Fuel Type</option>
                {fuelTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </SearchableSelect>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="transmission">Transmission</label>
              <SearchableSelect 
                id="transmission" 
                name="transmission" 
                value={formData.transmission} 
                onChange={handleChange}
              >
                <option value="">Select Transmission</option>
                {transmissionTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="engine">Engine</label>
              <input 
                type="text" 
                id="engine" 
                name="engine" 
                value={formData.engine} 
                onChange={handleChange} 
                placeholder="e.g., 2.5L 4-cylinder"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="color">Exterior Color</label>
              <input 
                type="text" 
                id="color" 
                name="color" 
                value={formData.color} 
                onChange={handleChange} 
                placeholder="e.g., Red, Blue, etc."
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
                placeholder="e.g., Black, Tan, etc."
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="engine">Engine</label>
              <input 
                type="text" 
                id="engine" 
                name="engine" 
                value={formData.engine} 
                onChange={handleChange} 
                placeholder="e.g., 2.0L Turbo, V6 3.5L"
              />
            </div>
            
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
                </span> <span className="text-muted">(Vehicle Identification Number)</span>
              </label>
              <input 
                type="text" 
                id="vin_number" 
                name="vin_number" 
                value={formData.vin_number} 
                onChange={(e) => {
                  const upperValue = e.target.value.toUpperCase();
                  setFormData(prev => ({ ...prev, vin_number: upperValue }));
                }}
                placeholder="e.g., 1HGCM82633A123456"
                style={{ textTransform: 'uppercase' }}
                maxLength="17"
              />
              <small className="form-text text-muted">
                <strong>Where to find your VIN:</strong> Check your vehicle registration, insurance documents, driver's side dashboard (visible through windshield), driver's side door jamb, or under the hood.
              </small>
            </div>
          </div>
          
          <div className="form-group full-width">
            <label htmlFor="car_description">Description</label>
            <textarea 
              id="car_description" 
              name="car_description" 
              value={formData.car_description} 
              onChange={handleChange} 
              placeholder="Provide details about your car's condition, features, history, etc."
              rows="5"
            />
          </div>
        </div>
        
        <div className="form-section">
          <h2>Contact Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="contact_phone">Phone Number *</label>
              <div className="phone-input-group">
                <SearchableSelect 
                  className="country-code-select"
                  name="country_code"
                  value={formData.country_code}
                  onChange={handleChange}
                >
                  {countryCodes.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.flag} {country.code}
                    </option>
                  ))}
                </SearchableSelect>
                <input 
                  type="tel" 
                  id="contact_phone" 
                  name="contact_phone" 
                  className="phone-number-input"
                  value={formData.contact_phone} 
                  onChange={handleChange} 
                  placeholder="Enter phone number"
                  required
                />
              </div>
              <small className="form-text text-muted">
                Select your country code and enter your phone number
              </small>
            </div>
            
            <div className="form-group">
              <label htmlFor="contact_email">Email</label>
              <input 
                type="email" 
                id="contact_email" 
                name="contact_email" 
                value={formData.contact_email} 
                onChange={handleChange} 
                placeholder="Your contact email"
              />
            </div>
          </div>
        </div>
        
        <div className="form-actions">
          <button 
            type="button" 
            className="cancel-button" 
            onClick={() => navigate('/')}
          >
            Cancel
          </button>
          <button 
            type="submit" 
            className="submit-button" 
            disabled={loading}
          >
            {loading ? 'Creating Listing...' : 'Create Listing'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateListing; 
