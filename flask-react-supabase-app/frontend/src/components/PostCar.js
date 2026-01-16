import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/PostForms.css';
import { carMakes, carModels, carTrims } from '../utils/carData';
import LoadingSpinner from './LoadingSpinner';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Fix Leaflet default icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const PostCar = () => {
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const locationInputRef = useRef(null);
  const [showExtras, setShowExtras] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewImages, setPreviewImages] = useState([]);
  const [mapPosition, setMapPosition] = useState([25.276987, 55.296249]); // Default to Dubai coordinates
  const [marker, setMarker] = useState([25.276987, 55.296249]);
  
  // Enhanced map features state
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const [formData, setFormData] = useState({
    car_manufacturer: '',
    car_model: '',
    trim: '',
    regional_spec: 'GCC Specs',
    make_year: new Date().getFullYear(),
    kilometer_driven: 100,
    body_type: '',
    is_insured: false,
    expected_selling_price: '',
    car_owner_phone_number: '',
    car_city: 'Dubai',
    listing_title: '',
    tour_url: '',
    car_description: '',
    fuel_type: '',
    transmission_type: '',
    seating_capacity: '',
    horsepower: '',
    engine_capacity: '',
    steering_side: '',
    car_location: '',
    latitude: null,
    longitude: null,
    vehicle_type: 'Used',
    vin_number: '',
    is_dealer: false,
    extras: [],
    images: []
  });
  
  // Car specifications arrays
  const bodyTypes = ['Sedan', 'SUV', 'Hatchback', 'Coupe', 'Convertible', 'Wagon', 'Van', 'Truck', 'Other'];
  const fuelTypes = ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'Other'];
  const transmissionTypes = ['Automatic', 'Manual'];
  const regionalSpecs = ['GCC', 'North American', 'European', 'Japanese', 'Korean', 'Chinese', 'Other'];
  const steeringSides = ['Left', 'Right'];
  const seatingCapacities = ['2', '4', '5', '6', '7', '8', '9+'];
  const horsepowerRanges = ['>100', '100-199', '200-299', '300-399', '400-499', '500-599', '600-699', '700-799', '800-899', '900-999', '1000+'];
  const engineCapacities = ['0-999cc', '1000cc-1499cc', '1500cc-1999cc', '2000cc-2999cc', '3000cc-3999cc', '4000cc-4999cc', '5000cc-5999cc', '6000cc-6999cc', '7000cc-7999cc', '8000cc+'];
  // Organized car extras by category
  const carExtrasCategories = {
    'Comfort & Convenience': [
      'Dual-zone Climate Control',
      'Tri-zone Climate Control',
      'Ventilated Seats (Cooling Seats)',
      'Heated Seats',
      'Massage Seats',
      'Panoramic Sunroof / Moonroof',
      'Ambient Lighting (Multi-color)',
      'Soft-Close Doors',
      'Heads-Up Display (HUD)',
      'Wireless Phone Charger',
      'Rear Window Sunshades (Manual)',
      'Rear Window Sunshades (Electric)',
      'Power Tailgate / Hands-Free Trunk',
      'Auto-Dimming Mirrors',
      'Memory Seats and Steering'
    ],
    'Infotainment & Tech': [
      'Apple CarPlay',
      'Android Auto',
      'Rear Entertainment Screens',
      'Bluetooth Audio Streaming',
      'USB-C Fast Charging Ports',
      '360° Surround Camera',
      'Digital Cockpit / Fully Digital Instrument Cluster',
      'Voice Command / AI Assistant',
      'Built-In Spotify / Streaming Apps',
      'Wi-Fi Hotspot'
    ],
    'Safety & Driver Assistance': [
      'Adaptive Cruise Control (Radar Cruise)',
      'Lane Keep Assist / Lane Departure Warning',
      'Blind Spot Monitoring',
      'Automatic Emergency Braking',
      'Traffic Sign Recognition',
      'Rear Cross Traffic Alert',
      'Night Vision Camera',
      'Off-Road Crawl Control / Terrain Response Modes'
    ],
    'Luxury & Styling': [
      'Leather Dashboard Wrapping',
      'Suede / Alcantara Headliner',
      'Carbon Fiber Trim',
      'Woodgrain Trim',
      'Illuminated Door Sills',
      'Chrome Appearance Package',
      'Blackout / Night Package (Black Badges, Black Trim)',
      'Sport Body Kit / Aero Kit'
    ],
    'Off-Road / Performance': [
      'Diff Lock (Rear / Front / Center)',
      'Air Suspension (Height Adjustable)',
      'Skid Plates',
      'Snorkel / Desert Air Intake',
      'Off-Road Camera Modes',
      'All-Terrain Drive Modes (Sand, Rock, Mud, Snow)',
      'Tow Hook / Recovery Package'
    ]
  };

  // Note: carExtras is now organized by categories above

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

  // Update models when manufacturer changes
  useEffect(() => {
    if (formData.car_manufacturer) {
      const models = carModels[formData.car_manufacturer] || [];
      setAvailableModels(models);
      
      // Clear model if it's not available for the selected manufacturer
      if (formData.car_model && !models.includes(formData.car_model)) {
        setFormData(prev => ({ ...prev, car_model: '', trim: '' }));
      }
    } else {
      setAvailableModels([]);
    }
  }, [formData.car_manufacturer, formData.car_model]);

  // Get available trims for selected manufacturer and model
  const getAvailableTrims = () => {
    if (formData.car_manufacturer && formData.car_model && carTrims[formData.car_manufacturer]) {
      return carTrims[formData.car_manufacturer][formData.car_model] || [];
    }
    return [];
  };

  // Update listing title when key fields change
  useEffect(() => {
    if (formData.car_manufacturer && formData.car_model && formData.make_year) {
      const newTitle = `${formData.make_year} ${formData.car_manufacturer} ${formData.car_model}${formData.trim ? ` ${formData.trim}` : ''}`;
      setFormData(prev => ({ ...prev, listing_title: newTitle }));
    }
  }, [formData.car_manufacturer, formData.car_model, formData.make_year, formData.trim]);

  // Remove Google Maps related code and replace with Leaflet
  useEffect(() => {
    // If location is already set, try to geocode it to get coordinates
    if (formData.car_location && formData.car_location.trim() !== '') {
      geocodeAddress(formData.car_location);
    }
  }, [formData.car_location]);

  // Geocoding disabled (previously Nominatim). Keep suggestions empty and avoid network calls.
  const geocodeAddress = async () => {
    setAddressSuggestions([]);
    setShowSuggestions(false);
    setGeoError(null);
  };

  // Debounced address search (disabled geocoding)
  useEffect(() => {
    setAddressSuggestions([]);
    setShowSuggestions(false);
  }, [formData.car_location]);

  // Handle address selection from suggestions (disabled suggestions)
  const handleAddressSelect = () => {
    setShowSuggestions(false);
    setAddressSuggestions([]);
  };

  // Map click handler component
  const MapClickHandler = () => {
    const map = useMap();
    
    useEffect(() => {
      if (!map) return;
      
      const handleMapClick = (e) => {
        const { lat, lng } = e.latlng;
        setMarker([lat, lng]);
        reverseGeocode(lat, lng);
      };
      
      map.on('click', handleMapClick);
      
      return () => {
        map.off('click', handleMapClick);
      };
    }, [map]);
    
    return null;
  };
  
  // Update marker position when map position changes
  const MarkerWithDrag = useCallback(() => {
    return (
      <Marker 
        position={marker} 
        draggable={true}
        eventHandlers={{
          dragend: (e) => {
            const { lat, lng } = e.target.getLatLng();
            setMarker([lat, lng]);
            reverseGeocode(lat, lng);
          },
        }}
      />
    );
  }, [marker]);

  // Reverse geocoding disabled; just capture coordinates if provided
  const reverseGeocode = async (lat, lng) => {
    setIsGeocoding(false);
    setGeoError(null);
    setFormData(prev => ({
      ...prev,
      latitude: lat,
      longitude: lng
    }));
  };

  // Get current location using browser geolocation
  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }

    setIsGettingLocation(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const newPosition = [lat, lng];
        
        setMapPosition(newPosition);
        setMarker(newPosition);
        reverseGeocode(lat, lng);
        setIsGettingLocation(false);
      },
      (error) => {
        console.error('Geolocation error:', error);
        setGeoError('Failed to get your location. Please enable location services.');
        setIsGettingLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (type === 'checkbox') {
      if (name === 'extras[]') {
        const extrasValue = value;
        const updatedExtras = [...formData.extras];
        
        if (checked) {
          updatedExtras.push(extrasValue);
        } else {
          const index = updatedExtras.indexOf(extrasValue);
          if (index > -1) {
            updatedExtras.splice(index, 1);
          }
        }
        
        setFormData(prev => ({ ...prev, extras: updatedExtras }));
      } else {
        setFormData(prev => ({ ...prev, [name]: checked }));
      }
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    processFiles(files);
  };

  const processFiles = (files) => {
    // Limit to 10 images
    if (files.length > 10) {
      setError("You can only upload up to 10 images.");
      return;
    }
    
    setSelectedFiles(files);
    
    // Create preview URLs
    const previews = files.map(file => URL.createObjectURL(file));
    setPreviewImages(previews);
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
    
    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type.startsWith('image/')
    );
    
    if (files.length === 0) {
      setError("Please drop only image files.");
      return;
    }
    
    processFiles(files);
  };

  const uploadImages = async () => {
    try {
      // Check if user is still authenticated before uploading
      if (!user) {
        throw new Error('User authentication required. Please log in again.');
      }

      const formData = new FormData();
      selectedFiles.forEach((file, index) => {
        formData.append('images', file);
      });
      
      console.log('Uploading images for authenticated user:', user.email);
      
      const response = await apiClient.post('/api/upload-images', formData, {
        headers: {
          // Don't set Content-Type for FormData - let the browser set it with boundary
        }
      });
      
      console.log("Images uploaded successfully:", response);
      
      if (!response || !response.urls || !Array.isArray(response.urls)) {
        console.error("Invalid response format from image upload:", response);
        throw new Error("Server returned an invalid response format for uploaded images");
      }
      
      return response.urls;
    } catch (error) {
      console.error("Error uploading images:", error);
      
      // Handle specific authentication errors
      if (error.status === 401) {
        setError("Your session has expired. Please log in again and try submitting your listing.");
        setShowAuthModal(true);
      } else {
        setError(`Failed to upload images: ${error.message || 'Please try again.'}`);
      }
      return [];
    }
  };

  const toggleExtras = (e) => {
    e.preventDefault();
    setShowExtras(!showExtras);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    if (selectedFiles.length === 0) {
      setError('You must upload at least one image of your car.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      // Upload images first (if any)
      const imageUrls = await uploadImages();
      // Prepare submission data with image URLs
      const submissionData = {
        ...formData,
        images: imageUrls
      };
      const response = await apiClient.post('/api/cars', submissionData);
      console.log('Car listing created:', response);
      setSuccess(true);
      // Redirect to my listings after 2 seconds
      setTimeout(() => {
        navigate('/my-listings');
      }, 2000);
    } catch (err) {
      console.error('Error creating car listing:', err);
      setError(err.response?.data?.error || 'Failed to create car listing. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show login/signup options if not logged in
  if (showAuthModal) {
    return (
      <div className="auth-required">
        <h2>Authentication Required</h2>
        <p>You need to be logged in to post a car listing.</p>
        <div className="auth-buttons">
          <button onClick={() => navigate('/login')}>Log In</button>
          <button onClick={() => navigate('/signup')}>Sign Up</button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your car listing has been successfully submitted and is pending approval.</p>
        <p>You will be redirected to your listings page shortly...</p>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      <h1>Post Your Car</h1>
      
      {error && <div className="error-message">{error}</div>}
      
      <form onSubmit={handleSubmit} id="carDetailsForm">
        <div className="form-section">
          <h2>Car Details</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_city">Emirate *</label>
              <select
                id="car_city"
                name="car_city"
                value={formData.car_city}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="Abu Dhabi">Abu Dhabi</option>
                <option value="Dubai">Dubai</option>
                <option value="Sharjah">Sharjah</option>
                <option value="Ajman">Ajman</option>
                <option value="Umm Al Quwain">Umm Al Quwain</option>
                <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                <option value="Fujairah">Fujairah</option>
              </select>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_manufacturer">Make *</label>
              <select
                id="car_manufacturer"
                name="car_manufacturer"
                value={formData.car_manufacturer}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="">Select Make</option>
                {carMakes.map(make => (
                  <option key={make} value={make}>{make}</option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="car_model">Model *</label>
              <select
                id="car_model"
                name="car_model"
                value={formData.car_model}
                onChange={handleChange}
                required
                className="form-control form-select"
                disabled={!formData.car_manufacturer}
              >
                <option value="">Select Model</option>
                {availableModels.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="trim">Trim</label>
              {getAvailableTrims().length > 0 ? (
                <select
                  id="trim"
                  name="trim"
                  value={formData.trim}
                  onChange={handleChange}
                  className="form-control form-select"
                >
                  <option value="">Select Trim (Optional)</option>
                  {getAvailableTrims().map(trim => (
                    <option key={trim} value={trim}>{trim}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  id="trim"
                  name="trim"
                  value={formData.trim}
                  onChange={handleChange}
                  className="form-control"
                  placeholder="Enter trim (optional)"
                />
              )}
            </div>
            
            <div className="form-group">
              <label htmlFor="regional_spec">Regional Spec *</label>
              <select
                id="regional_spec"
                name="regional_spec"
                value={formData.regional_spec}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                {regionalSpecs.map(spec => (
                  <option key={spec} value={spec}>{spec}</option>
                ))}
              </select>
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
                min="1886"
                max={new Date().getFullYear() + 1}
                required
                className="form-control"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="kilometer_driven">Kilometers *</label>
              <input
                type="number"
                id="kilometer_driven"
                name="kilometer_driven"
                value={formData.kilometer_driven}
                onChange={handleChange}
                min="0"
                required
                className="form-control"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="body_type">Body Type *</label>
              <select
                id="body_type"
                name="body_type"
                value={formData.body_type}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="">Select Body Type</option>
                {bodyTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="is_insured">Is your car insured in UAE?</label>
              <select
                id="is_insured"
                name="is_insured"
                value={formData.is_insured}
                onChange={(e) => setFormData(prev => ({ ...prev, is_insured: e.target.value === 'true' }))}
                className="form-control form-select"
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
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
                min="0"
                required
                className="form-control"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="car_owner_phone_number">Phone Number *</label>
              <input
                type="text"
                id="car_owner_phone_number"
                name="car_owner_phone_number"
                value={formData.car_owner_phone_number}
                onChange={handleChange}
                required
                placeholder="+971XXXXXXXXX"
                className="form-control"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="tour_url">360 Tour URL (Optional)</label>
              <input
                type="url"
                id="tour_url"
                name="tour_url"
                value={formData.tour_url}
                onChange={handleChange}
                placeholder="https://"
                className="form-control"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="car_description">Describe your car *</label>
              <textarea
                id="car_description"
                name="car_description"
                value={formData.car_description}
                onChange={handleChange}
                rows="5"
                required
                placeholder="Describe your car"
                className="form-control"
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
              <small className="form-text text-muted">Select "Yes" if you are posting this listing as a car dealer</small>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Car Specifications</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="fuel_type">Fuel Type *</label>
              <select
                id="fuel_type"
                name="fuel_type"
                value={formData.fuel_type}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="">Select Fuel Type</option>
                {fuelTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <div className="form-text text-danger">This field is required.</div>
            </div>
            
            <div className="form-group">
              <label htmlFor="transmission_type">Transmission Type *</label>
              <select
                id="transmission_type"
                name="transmission_type"
                value={formData.transmission_type}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="">Select Transmission Type</option>
                {transmissionTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <div className="form-text text-danger">This field is required.</div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="seating_capacity">Seating Capacity <span className="text-muted">(Optional)</span></label>
              <select
                id="seating_capacity"
                name="seating_capacity"
                value={formData.seating_capacity}
                onChange={handleChange}
                className="form-control form-select"
              >
                <option value="">Select Seating Capacity</option>
                {seatingCapacities.map(capacity => (
                  <option key={capacity} value={capacity}>{capacity} seats</option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="horsepower">Horsepower *</label>
              <select
                id="horsepower"
                name="horsepower"
                value={formData.horsepower}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="">Select Horsepower</option>
                {horsepowerRanges.map(range => (
                  <option key={range} value={range}>{range}</option>
                ))}
              </select>
              <div className="form-text text-danger">This field is required.</div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="engine_capacity">Engine Capacity (cc) <span className="text-muted">(Optional)</span></label>
              <select
                id="engine_capacity"
                name="engine_capacity"
                value={formData.engine_capacity}
                onChange={handleChange}
                className="form-control form-select"
              >
                <option value="">Select Engine Capacity</option>
                {engineCapacities.map(capacity => (
                  <option key={capacity} value={capacity}>{capacity}</option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="steering_side">Steering Side *</label>
              <select
                id="steering_side"
                name="steering_side"
                value={formData.steering_side}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="">Select Steering Side</option>
                {steeringSides.map(side => (
                  <option key={side} value={side}>{side}</option>
                ))}
              </select>
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
                  VIN <span style={{ color: 'red' }}>*</span>
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
                placeholder="e.g. 1HGCM82633A123456"
                className="form-control"
                style={{ textTransform: 'uppercase' }}
                maxLength="17"
                required
              />
              <div className="form-text">
                <strong>Where to find your VIN:</strong> Check your vehicle registration, insurance documents, driver's side dashboard (visible through windshield), driver's side door jamb, or under the hood.
              </div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="extras">Car Extras & Features</label>
              <button type="button" className="text-danger extras-toggle" onClick={toggleExtras}>
                {showExtras ? 'Show less ▲' : 'Show all ▼'}
              </button>
              
              <div id="extrasList" style={{ display: showExtras ? 'block' : 'none' }}>
                {Object.entries(carExtrasCategories).map(([category, extras]) => (
                  <div key={category} className="extras-category">
                    <h4 className="extras-category-title">{category}</h4>
                    <div className="row">
                      {extras.map(extra => (
                        <div className="col-md-6 col-lg-4" key={extra}>
                          <div className="form-check">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id={`extra-${extra.replace(/\s+/g, '-').toLowerCase()}`}
                              name="extras[]"
                              value={extra}
                              checked={formData.extras.includes(extra)}
                              onChange={handleChange}
                            />
                            <label className="form-check-label" htmlFor={`extra-${extra.replace(/\s+/g, '-').toLowerCase()}`}>
                              {extra}
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="car_location">Locate your car <span className="text-muted">(Optional)</span></label>
              
              <div className="location-search-container">
                <div className="search-input-wrapper">
                  <input
                    type="text"
                    id="car_location"
                    name="car_location"
                    value={formData.car_location}
                    onChange={handleChange}
                    onFocus={() => {
                      if (addressSuggestions.length > 0) {
                        setShowSuggestions(true);
                      }
                    }}
                    placeholder="Search for an address in UAE..."
                    className="form-control location-search-input"
                    ref={locationInputRef}
                    autoComplete="off"
                  />
                {isGeocoding && (
                  <div className="search-loading-indicator">
                    <LoadingSpinner size="small" message={null} compact inline />
                  </div>
                )}
                </div>

                {/* Address Suggestions Dropdown */}
                {showSuggestions && addressSuggestions.length > 0 && (
                  <div className="address-suggestions-dropdown">
                    {addressSuggestions.map((suggestion, index) => (
                      <div
                        key={index}
                        className="suggestion-item"
                        onClick={() => handleAddressSelect(suggestion)}
                      >
                        <div className="suggestion-icon" aria-hidden="true"></div>
                        <div className="suggestion-text">
                          <div className="suggestion-main">{suggestion.display_name}</div>
                          {suggestion.address && (
                            <div className="suggestion-sub">
                              {suggestion.address.city || suggestion.address.town || suggestion.address.state}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Error Message */}
                {geoError && (
                  <div className="geo-error-message">
                    {geoError}
                  </div>
                )}

                {/* Current Location Button */}
                <button
                  type="button"
                  className="current-location-btn"
                  onClick={getCurrentLocation}
                  disabled={isGettingLocation}
                >
                  {isGettingLocation ? (
                    <LoadingSpinner size="small" message="Getting location..." inline />
                  ) : (
                    <>
                      Use Current Location
                    </>
                  )}
                </button>
              </div>

              <div className="map-instructions">
                Map preview disabled. Please enter the location text above (city/area).
              </div>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Car Images</h2>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label>Upload Images *</label>
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
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    className="file-input"
                    required
                  />
                  <button type="button" className="browse-btn">
                    Browse Files
                  </button>
                  <p className="upload-hint">Maximum 10 images • JPG, PNG, GIF supported</p>
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
                              onClick={() => {
                                // Remove image from preview and selected files
                                const newPreviews = [...previewImages];
                                const newSelectedFiles = [...selectedFiles];
                                newPreviews.splice(index, 1);
                                newSelectedFiles.splice(index, 1);
                                setPreviewImages(newPreviews);
                                setSelectedFiles(newSelectedFiles);
                              }}
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
        </div>
        
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-danger"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Listing'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PostCar; 
