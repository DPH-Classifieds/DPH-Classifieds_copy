import { API_BASE_URL as API_URL } from '../utils/apiBase';
import React, { useRef, useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getAccessToken } from '../utils/authService';
import { countryCodes, defaultCountryCode } from '../utils/countryCodes';
import { getYearOptions } from '../utils/listingConstants';
import { isVinValid } from '../utils/vinValidation';
import '../styles/CreateListing.css';
import '../styles/shell-tokens.css';

const MAX_DESCRIPTION_WORDS = 300;

const CreateListing = () => {
  const navigate = useNavigate();
  const formRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [otherFuelType, setOtherFuelType] = useState('');
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
    'Petrol', 'Diesel', 'Electric', 'Hybrid', 'Other'
  ];
  
  // Transmission types for dropdown
  const transmissionTypes = [
    'Automatic', 'Manual'
  ];
  const yearOptions = getYearOptions();

  const countWords = (text) => (text.trim().match(/\S+/g) || []).length;
  const limitWords = (text, maxWords) => {
    if (!text) return text;
    const matches = Array.from(String(text).matchAll(/\S+/g));
    if (matches.length <= maxWords) return text;
    const cutoff = matches[maxWords]?.index ?? String(text).length;
    return String(text).slice(0, cutoff).trimEnd();
  };
  const descriptionWordCount = countWords(formData.car_description || '');

  const clearFieldHighlights = () => {
    if (!formRef.current) return;
    formRef.current.querySelectorAll('.field-error-highlight').forEach((node) => {
      node.classList.remove('field-error-highlight');
    });
    formRef.current.querySelectorAll('[aria-invalid="true"]').forEach((node) => {
      node.removeAttribute('aria-invalid');
    });
  };

  const focusAndHighlightField = (target) => {
    const fieldElement =
      typeof target === 'string'
        ? formRef.current?.querySelector(`#${target}, [name="${target}"]`)
        : target;
    if (!fieldElement) return;

    clearFieldHighlights();
    fieldElement.setAttribute('aria-invalid', 'true');
    fieldElement.closest('.form-group')?.classList.add('field-error-highlight');

    const searchableSelectWrapper = fieldElement.closest('.searchable-select-wrapper');
    if (searchableSelectWrapper) {
      const control = searchableSelectWrapper.querySelector('.searchable-select__control');
      if (control) {
        control.scrollIntoView({ behavior: 'smooth', block: 'center' });
        control.focus?.();
        control.click();
        return;
      }
    }

    fieldElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fieldElement.focus?.();
  };

  const getFirstInvalidRequiredField = () => {
    if (!formRef.current) return null;
    const requiredFields = Array.from(formRef.current.querySelectorAll('[required]'));
    for (const field of requiredFields) {
      if (field.disabled) continue;
      if (field.type === 'checkbox' && !field.checked) return field;
      if (field.type !== 'checkbox' && String(field.value || '').trim() === '') return field;
    }
    if (formData.fuel_type === 'Other' && !otherFuelType.trim()) {
      return formRef.current.querySelector('#other_fuel_type');
    }
    return null;
  };
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    clearFieldHighlights();

    if (name === 'car_description') {
      setFormData(prev => ({ ...prev, [name]: limitWords(value, MAX_DESCRIPTION_WORDS) }));
      return;
    }

    if (name === 'fuel_type' && value !== 'Other') {
      setOtherFuelType('');
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();

    const invalidField = getFirstInvalidRequiredField();
    if (invalidField) {
      setError('Please complete the highlighted fields before submitting.');
      focusAndHighlightField(invalidField);
      return;
    }

    clearFieldHighlights();
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
      if (submitData.fuel_type === 'Other') {
        submitData.fuel_type = `Other - ${otherFuelType.trim()}`;
      }
      
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
      
      <form onSubmit={handleSubmit} className="create-listing-form" ref={formRef} noValidate>
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
              <SearchableSelect
                id="make_year" 
                name="make_year" 
                value={formData.make_year} 
                onChange={handleChange} 
                required
              >
                <option value="">Select Year</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </SearchableSelect>
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
              <label htmlFor="mileage">Mileage (km)</label>
              <input 
                type="number" 
                id="mileage" 
                name="mileage" 
                value={formData.mileage} 
                onChange={handleChange} 
                placeholder="Current odometer reading in km"
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

          {formData.fuel_type === 'Other' && (
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="other_fuel_type">Specify Fuel Type *</label>
                <input
                  type="text"
                  id="other_fuel_type"
                  name="other_fuel_type"
                  value={otherFuelType}
                  onChange={(event) => {
                    clearFieldHighlights();
                    setOtherFuelType(event.target.value);
                  }}
                  placeholder="Enter specific fuel type"
                  required
                />
              </div>
            </div>
          )}
          
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
              <label htmlFor="vin_number">
                <span 
                  className="vin-label-tooltip"
                  title="VIN (Vehicle Identification Number) is a unique 17-character code that identifies your vehicle. You can find it on your vehicle registration document, insurance papers, or on the driver's side dashboard (visible through windshield), driver's side door jamb, or under the hood."
                  style={{ 
                    cursor: 'help',
                    borderBottom: '1px dotted #666'
                  }}
                >
                  VIN *
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
                className={formData.vin_number.length === 17 ? (isVinValid(formData.vin_number) ? 'is-valid' : 'is-invalid') : ''}
                style={{ textTransform: 'uppercase' }}
                maxLength="17"
                required
              />
              {formData.vin_number.length === 17 && !isVinValid(formData.vin_number) && (
                <small className="text-danger">This VIN appears invalid. You can still post your listing.</small>
              )}
              {formData.vin_number.length === 17 && isVinValid(formData.vin_number) && (
                <small className="text-success">VIN verified ✓</small>
              )}
              {!formData.vin_number && (
                <small className="form-text vin-help-text">
                  <strong>VIN helps your listing stand out:</strong> verified VIN details increase buyer trust and improve listing quality. <strong>Where to find it:</strong> check your registration, insurance documents, dashboard, door jamb, or under the hood.
                </small>
              )}
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
            <small className="form-text description-word-counter">
              {descriptionWordCount}/{MAX_DESCRIPTION_WORDS} words
            </small>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Contact Information</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="contact_phone">Phone Number *</label>
              <div className="phone-input-group">
                <select
                  className="country-code-select"
                  name="country_code"
                  value={formData.country_code}
                  onChange={handleChange}
                  aria-label="Country code"
                >
                  {countryCodes.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.code}
                    </option>
                  ))}
                </select>
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
