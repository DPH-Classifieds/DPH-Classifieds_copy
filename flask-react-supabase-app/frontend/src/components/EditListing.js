import React, { useRef, useState, useEffect } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useParams, useNavigate } from 'react-router-dom';
import { getAccessToken } from '../utils/supabaseClient';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import ImageFramingModal from './ImageFramingModal';
import { countryCodes, defaultCountryCode } from '../utils/countryCodes';
import {
  CYLINDER_OPTIONS,
  DOOR_OPTIONS,
  SERVICE_HISTORY_OPTIONS,
  UAE_EMIRATES,
  WARRANTY_OPTIONS,
  getAreasForEmirate,
  getYearOptions
} from '../utils/listingConstants';
import '../styles/CreateListing.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_IMAGE_CROP = { focalX: 50, focalY: 50, zoom: 1 };
const MAX_DESCRIPTION_WORDS = 300;

const EditListing = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const formRef = useRef(null);
  
  const [formData, setFormData] = useState({
    listing_title: '',
    car_manufacturer: '',
    car_model: '',
    car_variant: '',
    make_year: '',
    kilometer_driven: '',
    color: '',
    cylinders: '',
    doors: '',
    warranty: '',
    service_history: '',
    expected_selling_price: '',
    car_description: '',
    car_location: '',
    area: '',
    emirate: 'Dubai',
    country_code: defaultCountryCode,
    car_owner_phone_number: '',
    contact_email: '',
    whatsapp_prefill_text: '',
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
  const [newImagePreviews, setNewImagePreviews] = useState([]);
  const [newImageCropSettings, setNewImageCropSettings] = useState([]);
  const [otherFuelType, setOtherFuelType] = useState('');
  const [showFramingModal, setShowFramingModal] = useState(false);
  const [activeFramingIndex, setActiveFramingIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const yearOptions = getYearOptions();

  const countWords = (text) => (text.trim().match(/\S+/g) || []).length;
  const limitWords = (text, maxWords) => {
    const words = text.trim().match(/\S+/g) || [];
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(' ');
  };
  const descriptionWordCount = countWords(formData.car_description || '');
  const areaOptions = getAreasForEmirate(formData.emirate);

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
      const fuelValue = data.fuel_type || '';
      const hasCustomFuel = typeof fuelValue === 'string' && fuelValue.toLowerCase().startsWith('other - ');
      const parsedOtherFuelType = hasCustomFuel ? fuelValue.slice(8).trim() : '';
      
      // Format the data for the form
      setFormData({
        listing_title: data.listing_title || '',
        car_manufacturer: data.car_manufacturer || '',
        car_model: data.car_model || '',
        car_variant: data.trim || data.car_variant || '',
        make_year: data.make_year || '',
        kilometer_driven: data.kilometer_driven || data.mileage || '',
        color: data.color || data.exterior_color || '',
        cylinders: data.cylinders || '',
        doors: data.doors || '',
        warranty: data.warranty || '',
        service_history: data.service_history || '',
        expected_selling_price: data.expected_selling_price || '',
        car_description: data.car_description || data.description || '',
        car_location: data.car_location || data.location || '',
        area: data.area || '',
        emirate: data.emirate || data.car_city || 'Dubai',
        country_code: data.country_code || defaultCountryCode,
        car_owner_phone_number: data.car_owner_phone_number || data.contact_phone || '',
        contact_email: data.contact_email || data.user_email || '',
        whatsapp_prefill_text: data.whatsapp_prefill_text || '',
        vin_number: data.vin_number || '',
        body_type: data.body_type || '',
        fuel_type: hasCustomFuel ? 'Other' : fuelValue,
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
      setOtherFuelType(parsedOtherFuelType);
      
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
    clearFieldHighlights();

    if (name === 'emirate') {
      const nextAreas = getAreasForEmirate(value);
      setFormData((prev) => ({
        ...prev,
        emirate: value,
        area: nextAreas.includes(prev.area) ? prev.area : ''
      }));
      return;
    }
    
    if (type === 'checkbox') {
      setFormData({
        ...formData,
        [name]: checked
      });
    } else if (
      name === 'make_year' ||
      name === 'kilometer_driven' ||
      name === 'expected_selling_price'
    ) {
      setFormData({
        ...formData,
        [name]: value === '' ? '' : Number(value)
      });
    } else {
      if (name === 'car_description') {
        setFormData({
          ...formData,
          [name]: limitWords(value, MAX_DESCRIPTION_WORDS)
        });
        return;
      }

      if (name === 'fuel_type' && value !== 'Other') {
        setOtherFuelType('');
      }

      setFormData({
        ...formData,
        [name]: value
      });
    }
  };

  useEffect(() => {
    return () => {
      newImagePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [newImagePreviews]);
  
  const handleImageChange = (e) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files);
    if (!files.length) {
      setNewImages([]);
      setNewImagePreviews([]);
      setNewImageCropSettings([]);
      return;
    }

    if (files.length > 10) {
      setError('You can only upload up to 10 images at a time.');
      return;
    }

    const invalidTypeFile = files.find((file) => !SUPPORTED_IMAGE_TYPES.includes((file.type || '').toLowerCase()));
    if (invalidTypeFile) {
      setError('Only JPG, PNG, WEBP, and GIF images are supported.');
      return;
    }

    const oversizedFile = files.find((file) => file.size > MAX_IMAGE_SIZE_BYTES);
    if (oversizedFile) {
      setError('Each image must be 5MB or smaller.');
      return;
    }

    setError(null);
    setNewImages(files);
    setNewImagePreviews(files.map((file) => URL.createObjectURL(file)));
    setNewImageCropSettings(files.map(() => ({ ...DEFAULT_IMAGE_CROP })));
    setActiveFramingIndex(0);
    setShowFramingModal(true);
  };
  
  const handleDeleteImage = (index) => {
    const updatedImages = [...images];
    updatedImages.splice(index, 1);
    setImages(updatedImages);
  };

  const handleDeleteNewImage = (index) => {
    const updatedNewImages = [...newImages];
    const updatedPreviews = [...newImagePreviews];
    const updatedCropSettings = [...newImageCropSettings];
    updatedNewImages.splice(index, 1);
    updatedPreviews.splice(index, 1);
    updatedCropSettings.splice(index, 1);
    setNewImages(updatedNewImages);
    setNewImagePreviews(updatedPreviews);
    setNewImageCropSettings(updatedCropSettings);
    if (!updatedNewImages.length) {
      setShowFramingModal(false);
      setActiveFramingIndex(0);
    }
  };

  const updateNewImageCropSetting = (index, partialUpdate) => {
    setNewImageCropSettings((prev) =>
      prev.map((setting, currentIndex) =>
        currentIndex === index ? { ...setting, ...partialUpdate } : setting
      )
    );
  };

  const applyCurrentCropToAllNewImages = (sourceIndex) => {
    setNewImageCropSettings((prev) => {
      const sourceSetting = prev[sourceIndex] || DEFAULT_IMAGE_CROP;
      return prev.map(() => ({ ...sourceSetting }));
    });
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();

    const invalidField = getFirstInvalidRequiredField();
    if (invalidField) {
      setError('Please complete the highlighted fields before updating your listing.');
      focusAndHighlightField(invalidField);
      return;
    }

    clearFieldHighlights();
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

      if (formData.fuel_type === 'Other') {
        formDataToSend.set('fuel_type', `Other - ${otherFuelType.trim()}`);
      }
      
      // Add image IDs to keep
      images.forEach(image => {
        formDataToSend.append('keep_image_ids', image.id);
      });
      
      // Add new images
      newImages.forEach(image => {
        formDataToSend.append('images', image);
      });
      if (newImages.length > 0) {
        const cropPayload = newImages.map((_, index) => {
          const crop = newImageCropSettings[index] || DEFAULT_IMAGE_CROP;
          return {
            focalX: crop.focalX ?? 50,
            focalY: crop.focalY ?? 50,
            zoom: crop.zoom ?? 1
          };
        });
        formDataToSend.append('crop_data', JSON.stringify(cropPayload));
      }
      
      const updateAttempts = [
        { endpoint: `/api/cars/${id}`, method: 'PUT' },
        { endpoint: `/api/cars/${id}`, method: 'PATCH' },
        { endpoint: `/api/cars/${id}`, method: 'POST' },
        { endpoint: `/api/cars/${id}/update`, method: 'POST' }
      ];
      let lastError = null;

      for (const attempt of updateAttempts) {
        try {
          await apiClient.request(attempt.endpoint, {
            method: attempt.method,
            body: formDataToSend
          });
          lastError = null;
          break;
        } catch (err) {
          console.warn(`Update attempt ${attempt.method} ${attempt.endpoint} failed:`, err.status);
          lastError = err;
          if (err.status === 405 || err.status === 404) {
            continue;
          }
          throw err;
        }
      }

      if (lastError) {
        throw lastError;
      }
      
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
      
      <form className="create-listing-form" onSubmit={handleSubmit} ref={formRef} noValidate>
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
          </div>
        </div>
        
        <div className="form-section">
          <h2>Vehicle Details</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="kilometer_driven">Mileage (km)</label>
              <input
                type="number"
                id="kilometer_driven"
                name="kilometer_driven"
                value={formData.kilometer_driven}
                onChange={handleChange}
                placeholder="e.g. 35000 km"
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
              <label htmlFor="color">Color</label>
              <input
                type="text"
                id="color"
                name="color"
                value={formData.color}
                onChange={handleChange}
                placeholder="e.g. Midnight Black"
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="cylinders">Cylinders</label>
              <SearchableSelect
                id="cylinders"
                name="cylinders"
                value={formData.cylinders}
                onChange={handleChange}
                required
              >
                <option value="">Select Cylinders</option>
                {CYLINDER_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </SearchableSelect>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="doors">Doors</label>
              <SearchableSelect
                id="doors"
                name="doors"
                value={formData.doors}
                onChange={handleChange}
                required
              >
                <option value="">Select Doors</option>
                {DOOR_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </SearchableSelect>
            </div>

            <div className="form-group">
              <label htmlFor="warranty">Warranty</label>
              <SearchableSelect
                id="warranty"
                name="warranty"
                value={formData.warranty}
                onChange={handleChange}
                required
              >
                <option value="">Select Warranty</option>
                {WARRANTY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </SearchableSelect>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="service_history">Service History</label>
              <SearchableSelect
                id="service_history"
                name="service_history"
                value={formData.service_history}
                onChange={handleChange}
                required
              >
                <option value="">Select Service History</option>
                {SERVICE_HISTORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </SearchableSelect>
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
                required
              />
              <small className="form-text vin-help-text">
                <strong>VIN helps your listing stand out:</strong> verified VIN details increase buyer trust and improve listing quality. <strong>Where to find it:</strong> registration, insurance docs, dashboard, door jamb, or under hood.
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
              <label htmlFor="car_description">Description</label>
              <textarea
                id="car_description"
                name="car_description"
                value={formData.car_description}
                onChange={handleChange}
                placeholder="Describe your car in detail, including condition, features, history, etc."
                rows="6"
                required
              ></textarea>
              <small className="form-text description-word-counter">
                {descriptionWordCount}/{MAX_DESCRIPTION_WORDS} words
              </small>
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
              <label htmlFor="emirate">Emirate</label>
              <SearchableSelect
                id="emirate"
                name="emirate"
                value={formData.emirate}
                onChange={handleChange}
                required
              >
                {UAE_EMIRATES.map((emirate) => (
                  <option key={emirate} value={emirate}>{emirate}</option>
                ))}
              </SearchableSelect>
            </div>

            <div className="form-group">
              <label htmlFor="area">Area</label>
              {areaOptions.length > 0 ? (
                <SearchableSelect
                  id="area"
                  name="area"
                  value={formData.area}
                  onChange={handleChange}
                  required
                >
                  <option value="">Select Area</option>
                  {areaOptions.map((area) => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </SearchableSelect>
              ) : (
                <input
                  type="text"
                  id="area"
                  name="area"
                  value={formData.area}
                  onChange={handleChange}
                  placeholder="Area"
                  required
                />
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_location">Location Details</label>
              <input
                type="text"
                id="car_location"
                name="car_location"
                value={formData.car_location}
                onChange={handleChange}
                placeholder="e.g. Building / Street / Landmark"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="car_owner_phone_number">Phone</label>
              <div className="phone-input-group">
                <SearchableSelect
                  id="country_code"
                  name="country_code"
                  className="country-code-select"
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
                  id="car_owner_phone_number"
                  name="car_owner_phone_number"
                  value={formData.car_owner_phone_number}
                  onChange={handleChange}
                  placeholder="e.g. 555-123-4567"
                  className="phone-number-input"
                  required
                />
              </div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="contact_email">Email (optional)</label>
              <input
                type="email"
                id="contact_email"
                name="contact_email"
                value={formData.contact_email}
                onChange={handleChange}
                placeholder="e.g. your@email.com"
              />
            </div>
            <div className="form-group">
              <label htmlFor="whatsapp_prefill_text">WhatsApp Pre-text (Optional)</label>
              <textarea
                id="whatsapp_prefill_text"
                name="whatsapp_prefill_text"
                value={formData.whatsapp_prefill_text}
                onChange={handleChange}
                rows="3"
                placeholder="Hi, yes it's available. When would you like to view it?"
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
              <div className="image-preview-container listing-framing-grid">
                {images.map((image, index) => (
                  <div key={image.id} className="image-preview listing-framing-preview">
                    <img
                      src={image.display_url || image.image_url || image.url}
                      alt={`Car ${index + 1}`}
                      style={{
                        objectPosition: `${Number.isFinite(Number(image.focal_x)) ? Number(image.focal_x) : 50}% ${Number.isFinite(Number(image.focal_y)) ? Number(image.focal_y) : 50}%`
                      }}
                    />
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
              <button
                type="button"
                className="frame-all-btn"
                onClick={() => {
                  setActiveFramingIndex(0);
                  setShowFramingModal(true);
                }}
              >
                Adjust Photo Framing
              </button>
              <div className="image-preview-container listing-framing-grid">
                {newImages.map((image, index) => (
                  <div key={index} className="image-preview listing-framing-preview">
                    <img
                      src={newImagePreviews[index]}
                      alt={`New ${index + 1}`}
                      style={{
                        objectPosition: `${newImageCropSettings[index]?.focalX ?? 50}% ${newImageCropSettings[index]?.focalY ?? 50}%`,
                        transform: `scale(${newImageCropSettings[index]?.zoom ?? 1})`,
                        transformOrigin: 'center'
                      }}
                    />
                    <button
                      type="button"
                      className="remove-image-btn"
                      onClick={() => handleDeleteNewImage(index)}
                      aria-label="Remove new image"
                    >
                      ×
                    </button>
                    <button
                      type="button"
                      className="frame-btn"
                      onClick={() => {
                        setActiveFramingIndex(index);
                        setShowFramingModal(true);
                      }}
                    >
                      Frame
                    </button>
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

      <ImageFramingModal
        isOpen={showFramingModal}
        images={newImagePreviews.map((previewUrl, index) => ({
          previewUrl,
          name: newImages[index]?.name || `Photo ${index + 1}`
        }))}
        cropSettings={newImageCropSettings}
        activeIndex={activeFramingIndex}
        onActiveIndexChange={setActiveFramingIndex}
        onUpdateCrop={updateNewImageCropSetting}
        onApplyCurrentToAll={applyCurrentCropToAllNewImages}
        onClose={() => setShowFramingModal(false)}
        title="Adjust New Image Frames"
      />
    </div>
  );
};

export default EditListing; 
