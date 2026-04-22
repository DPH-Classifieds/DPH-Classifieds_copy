import React, { useState, useEffect, useRef, useCallback } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/PostForms.css';
import { carMakes, carModels, carTrims } from '../utils/carData';
import LoadingSpinner from './LoadingSpinner';
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
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import ImageFramingModal from './ImageFramingModal';
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

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_IMAGE_CROP = { focalX: 50, focalY: 50, zoom: 1 };
const MAX_DESCRIPTION_WORDS = 300;
const DEFAULT_MAP_POSITION = [25.276987, 55.296249];
const CAR_DRAFT_STORAGE_KEY = 'dph_post_car_draft_v2';

const PostCar = () => {
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const formRef = useRef(null);
  const locationInputRef = useRef(null);
  const [showExtras, setShowExtras] = useState(true);
  const [otherFuelType, setOtherFuelType] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewImages, setPreviewImages] = useState([]);
  const [imageCropSettings, setImageCropSettings] = useState([]);
  const [showFramingModal, setShowFramingModal] = useState(false);
  const [activeFramingIndex, setActiveFramingIndex] = useState(0);
  const [mapPosition, setMapPosition] = useState(DEFAULT_MAP_POSITION); // Default to Dubai coordinates
  const [marker, setMarker] = useState(DEFAULT_MAP_POSITION);
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  
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
    regional_spec: 'GCC',
    make_year: new Date().getFullYear(),
    kilometer_driven: 100,
    body_type: '',
    is_insured: false,
    expected_selling_price: 0,
    country_code: defaultCountryCode,
    car_owner_phone_number: '',
    car_city: 'Dubai',
    emirate: 'Dubai',
    area: '',
    listing_title: '',
    tour_url: '',
    car_description: '',
    fuel_type: '',
    transmission_type: '',
    seating_capacity: '',
    horsepower: '',
    engine_capacity: '',
    steering_side: '',
    color: '',
    cylinders: '',
    doors: '',
    warranty: '',
    service_history: '',
    car_location: '',
    latitude: DEFAULT_MAP_POSITION[0],
    longitude: DEFAULT_MAP_POSITION[1],
    vehicle_type: 'Used',
    vin_number: '',
    is_dealer: false,
    featured_listing: false,
    ownership_status: '',
    drivetrain: '',
    fuel_efficiency: '',
    top_speed: '',
    zero_to_hundred: '',
    torque: '',
    interior_color: '',
    seller_name: '',
    whatsapp_number: '',
    whatsapp_prefill_text: '',
    seller_email: '',
    contact_preference: 'phone',
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
  const yearOptions = getYearOptions();

  const countWords = (text) => (text.trim().match(/\S+/g) || []).length;

  const limitWords = (text, maxWords) => {
    const words = text.trim().match(/\S+/g) || [];
    if (words.length <= maxWords) {
      return text;
    }
    return words.slice(0, maxWords).join(' ');
  };

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

    if (!formData.car_location.trim() || !formData.latitude || !formData.longitude) {
      return locationInputRef.current;
    }

    return null;
  };

  const descriptionWordCount = countWords(formData.car_description || '');
  const descriptionCharacterCount = (formData.car_description || '').length;
  const areaOptions = getAreasForEmirate(formData.car_city);

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
    ],
    'Seller Notes': [
      'Lady Driven',
      'Mallu Doctor Driven'
    ]
  };

  // Note: carExtras is now organized by categories above

  // Check if user is logged in when component loads
  useEffect(() => {
    const checkAuth = async () => {
      await syncWithSupabase();
    };
    
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Update auth modal visibility when user or isLoading changes
  useEffect(() => {
    if (!isLoading && !user) {
      console.log('User not authenticated, showing auth modal');
      setShowAuthModal(true);
    } else if (user) {
      console.log('User authenticated:', user.email);
      setShowAuthModal(false);
    }
  }, [user, isLoading]);

  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem(CAR_DRAFT_STORAGE_KEY);
      if (!rawDraft) return;
      const draft = JSON.parse(rawDraft);
      if (!draft || typeof draft !== 'object') return;

      if (draft.formData && typeof draft.formData === 'object') {
        setFormData((prev) => ({ ...prev, ...draft.formData }));
      }
      if (typeof draft.otherFuelType === 'string') {
        setOtherFuelType(draft.otherFuelType);
      }
      if (Array.isArray(draft.marker) && draft.marker.length === 2) {
        setMarker(draft.marker);
        setMapPosition(draft.marker);
      }
      if (draft.formData?.listing_title) {
        setTitleManuallyEdited(true);
      }
    } catch (draftError) {
      console.warn('Failed to load car draft:', draftError);
    }
  }, []);

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
    if (!titleManuallyEdited && formData.car_manufacturer && formData.car_model && formData.make_year) {
      const newTitle = `${formData.make_year} ${formData.car_manufacturer} ${formData.car_model}${formData.trim ? ` ${formData.trim}` : ''}`;
      setFormData(prev => ({ ...prev, listing_title: newTitle }));
    }
  }, [titleManuallyEdited, formData.car_manufacturer, formData.car_model, formData.make_year, formData.trim]);

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
      car_location: prev.car_location || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      latitude: lat,
      longitude: lng
    }));
  };

  // Fallback geolocation using IP-based service
  const getIPLocation = async () => {
    try {
      console.log('Trying IP-based geolocation...');
      const response = await fetch('https://ipapi.co/json/');
      const data = await response.json();
      
      if (data.latitude && data.longitude) {
        console.log('IP location found:', data.latitude, data.longitude);
        const newPosition = [data.latitude, data.longitude];
        setMapPosition(newPosition);
        setMarker(newPosition);
        reverseGeocode(data.latitude, data.longitude);
        return true;
      }
      return false;
    } catch (error) {
      console.error('IP geolocation failed:', error);
      return false;
    }
  };

  // Get current location using browser geolocation
  const getCurrentLocation = () => {
    setIsGettingLocation(true);
    setGeoError(null);

    // First try browser geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const newPosition = [lat, lng];
          
          console.log('Browser geolocation success:', lat, lng);
          setMapPosition(newPosition);
          setMarker(newPosition);
          reverseGeocode(lat, lng);
          setIsGettingLocation(false);
        },
        async (error) => {
          console.error('Browser geolocation error:', error);
          
          // Fallback to IP-based geolocation
          console.log('Falling back to IP-based geolocation...');
          const ipSuccess = await getIPLocation();
          
          if (!ipSuccess) {
            let errorMessage = 'Could not determine your location.';
            
            switch (error.code) {
              case error.PERMISSION_DENIED:
                errorMessage = 'Location access was denied. Please enable location in your browser settings or enter your location manually.';
                break;
              case error.POSITION_UNAVAILABLE:
                errorMessage = 'Location unavailable. Using default location (Dubai). You can adjust the marker on the map.';
                // Set default location to Dubai
                const dubaiPosition = [25.2048, 55.2708];
                setMapPosition(dubaiPosition);
                setMarker(dubaiPosition);
                break;
              case error.TIMEOUT:
                errorMessage = 'Location request timed out. Please try again or enter your location manually.';
                break;
              default:
                errorMessage = 'Could not determine your location. Using default location (Dubai).';
                const defaultPosition = [25.2048, 55.2708];
                setMapPosition(defaultPosition);
                setMarker(defaultPosition);
            }
            
            setGeoError(errorMessage);
          }
          
          setIsGettingLocation(false);
        },
        {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 300000
        }
      );
    } else {
      // No geolocation support, try IP-based
      getIPLocation().then(success => {
        if (!success) {
          setGeoError('Geolocation is not supported. Using default location (Dubai).');
          const dubaiPosition = [25.2048, 55.2708];
          setMapPosition(dubaiPosition);
          setMarker(dubaiPosition);
        }
        setIsGettingLocation(false);
      });
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    clearFieldHighlights();

    if (name === 'car_city') {
      const nextAreas = getAreasForEmirate(value);
      setFormData((prev) => ({
        ...prev,
        car_city: value,
        emirate: value,
        area: nextAreas.includes(prev.area) ? prev.area : ''
      }));
      return;
    }
    
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
      if (name === 'listing_title') {
        setTitleManuallyEdited(true);
      }

      if (name === 'car_description') {
        setFormData(prev => ({ ...prev, [name]: limitWords(value, MAX_DESCRIPTION_WORDS) }));
        return;
      }

      if (name === 'fuel_type' && value !== 'Other') {
        setOtherFuelType('');
      }

      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  useEffect(() => {
    return () => {
      previewImages.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewImages]);

  const updateImageCropSetting = (index, partialUpdate) => {
    setImageCropSettings((prev) =>
      prev.map((setting, currentIndex) =>
        currentIndex === index ? { ...setting, ...partialUpdate } : setting
      )
    );
  };

  const applyCurrentCropToAll = (sourceIndex) => {
    setImageCropSettings((prev) => {
      const sourceSetting = prev[sourceIndex] || DEFAULT_IMAGE_CROP;
      return prev.map(() => ({ ...sourceSetting }));
    });
  };

  const [isDragOver, setIsDragOver] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    processFiles(files);
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleContainerClick = (e) => {
    // Only trigger file dialog if clicking on the upload area itself, not on buttons or images
    if (e.target.closest('.browse-btn') || e.target.closest('.remove-image') || e.target.closest('.preview-thumbnail')) {
      return;
    }
    fileInputRef.current?.click();
  };

  const processFiles = (files) => {
    // Limit to 10 images
    if (files.length > 10) {
      setError("You can only upload up to 10 images.");
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
    setSelectedFiles(files);
    
    // Create preview URLs
    const previews = files.map(file => URL.createObjectURL(file));
    setPreviewImages(previews);
    setImageCropSettings(files.map(() => ({ ...DEFAULT_IMAGE_CROP })));
    setActiveFramingIndex(0);
    setShowFramingModal(true);
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

  // Drag and drop handlers for reordering images
  const handleImageDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  };

  const handleImageDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleImageDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleImageDrop = (e, dropIndex) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    // Reorder files
    const newFiles = [...selectedFiles];
    const [draggedFile] = newFiles.splice(draggedIndex, 1);
    newFiles.splice(dropIndex, 0, draggedFile);
    setSelectedFiles(newFiles);

    // Reorder previews
    const newPreviews = [...previewImages];
    const [draggedPreview] = newPreviews.splice(draggedIndex, 1);
    newPreviews.splice(dropIndex, 0, draggedPreview);
    setPreviewImages(newPreviews);

    const newCropSettings = [...imageCropSettings];
    const [draggedCrop] = newCropSettings.splice(draggedIndex, 1);
    newCropSettings.splice(dropIndex, 0, draggedCrop);
    setImageCropSettings(newCropSettings);

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleImageDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const uploadImages = async () => {
    try {
      // Check if user is still authenticated before uploading
      if (!user) {
        throw new Error('User authentication required. Please log in again.');
      }

      if (selectedFiles.length === 0) {
        throw new Error('No images selected for upload.');
      }

      const formData = new FormData();
      selectedFiles.forEach((file, index) => {
        console.log(`Adding file ${index + 1}: ${file.name} (${file.type}, ${file.size} bytes)`);
        formData.append('images', file);
      });
      const cropPayload = selectedFiles.map((_, index) => {
        const crop = imageCropSettings[index] || DEFAULT_IMAGE_CROP;
        return {
          focalX: crop.focalX ?? 50,
          focalY: crop.focalY ?? 50,
          zoom: crop.zoom ?? 1
        };
      });
      formData.append('crop_data', JSON.stringify(cropPayload));
      
      console.log(`Uploading ${selectedFiles.length} images for user:`, user.email);
      console.log('API URL:', process.env.REACT_APP_API_URL || 'https://api.dphclassifieds.com');
      
      // Use fetch directly for better error visibility
      const token = localStorage.getItem('authData') ? JSON.parse(localStorage.getItem('authData')).access_token : null;
      
      if (!token) {
        throw new Error('No authentication token found. Please log in again.');
      }
      
      const response = await fetch(`${process.env.REACT_APP_API_URL || 'https://api.dphclassifieds.com'}/api/upload-images`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        credentials: 'include',
        body: formData
      });
      
      console.log('Upload response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Upload error response:', errorData);
        const uploadError = new Error(errorData.error || errorData.message || `Upload failed with status ${response.status}`);
        uploadError.status = response.status;
        throw uploadError;
      }
      
      const data = await response.json();
      console.log("Images upload response:", data);
      
      if (!Array.isArray(data.urls)) {
        console.error("Invalid response format:", data);
        throw new Error(data.error || data.message || "Invalid response from server");
      }
      
      const uploadedImages = Array.isArray(data.images) && data.images.length
        ? data.images
        : data.urls.map((url) => ({ url, image_url: url, display_url: url, focal_x: 50, focal_y: 50, crop_meta: null }));

      console.log(`Successfully uploaded ${uploadedImages.length} images`);
      return uploadedImages;
    } catch (error) {
      console.error("Image upload error:", error);
      
      // Handle specific errors
      if (error.status === 401) {
        setError("Your session has expired. Please log in again and try submitting your listing.");
        setShowAuthModal(true);
      } else if (error.status === 413) {
        setError("File too large. Please upload images smaller than 10MB.");
      } else if (error.status === 400) {
        setError(error.message || "Invalid file type. Please upload JPG, PNG, WEBP, or GIF images.");
      } else if (error.status === 500) {
        setError(`Server error: ${error.message || 'Please try again later.'}`);
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

  const handleSaveDraft = () => {
    try {
      const draftPayload = {
        formData,
        otherFuelType,
        marker,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(CAR_DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));
      setError(null);
    } catch (draftError) {
      console.error('Failed to save car draft:', draftError);
      setError('Could not save draft. Please try again.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    const invalidField = getFirstInvalidRequiredField();
    if (invalidField) {
      setError('Please complete the highlighted fields before submitting your listing.');
      focusAndHighlightField(invalidField);
      return;
    }
    clearFieldHighlights();

    if (selectedFiles.length === 0) {
      setError('You must upload at least one image of your car.');
      focusAndHighlightField('images');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      // Upload images first (if any)
      const uploadedImages = await uploadImages();
      
      if (uploadedImages.length === 0) {
        setError('Please upload at least one image of your car.');
        setIsSubmitting(false);
        return;
      }
      
      // Prepare submission data with image URLs
      const submissionData = {
        ...formData,
        fuel_type:
          formData.fuel_type === 'Other' ? `Other - ${otherFuelType.trim()}` : formData.fuel_type,
        latitude: marker[0],
        longitude: marker[1],
        images: uploadedImages
      };
      
      console.log('Submitting car listing:', JSON.stringify(submissionData, null, 2));
      
      const response = await apiClient.post('/api/cars', submissionData);
      console.log('Car listing created:', response);
      localStorage.removeItem(CAR_DRAFT_STORAGE_KEY);
      setSuccess(true);
      // Redirect to my listings after 2 seconds
      setTimeout(() => {
        navigate('/my-listings');
      }, 2000);
    } catch (err) {
      console.error('Error creating car listing:', err);
      console.error('Error details:', {
        status: err.status,
        message: err.message,
        details: err.details
      });
      setError(err.message || err.details?.error || 'Failed to create car listing. Please try again.');
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
      <section className="post-hero-section">
        <div className="post-hero-content">
          <div className="post-hero-text">
            <span className="post-hero-kicker">Submit Your Listing</span>
            <h1 className="post-hero-title">List Your Vehicle</h1>
            <p className="post-hero-subtitle">Curate your automotive legacy. Our listing process is designed for precision.</p>
          </div>
        </div>
      </section>

      <section className="post-form-section">
        <div className="form-container">
          {error && <div className="form-error-message">{error}</div>}
          <form onSubmit={handleSubmit} id="carDetailsForm" className="post-form" ref={formRef} noValidate>
        <div className="form-section">
          <h2>Basic Details</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_city">Emirate *</label>
              <SearchableSelect
                id="car_city"
                name="car_city"
                value={formData.car_city}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                {UAE_EMIRATES.map((emirate) => (
                  <option key={emirate} value={emirate}>{emirate}</option>
                ))}
              </SearchableSelect>
            </div>
            <div className="form-group">
              <label htmlFor="area">Area *</label>
              {areaOptions.length > 0 ? (
                <SearchableSelect
                  id="area"
                  name="area"
                  value={formData.area}
                  onChange={handleChange}
                  required
                  className="form-control form-select"
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
                  required
                  placeholder="Area"
                  className="form-control"
                />
              )}
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_manufacturer">Make *</label>
              <SearchableSelect
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
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="car_model">Model *</label>
              <SearchableSelect
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
              </SearchableSelect>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="trim">Trim</label>
              {getAvailableTrims().length > 0 ? (
                <SearchableSelect
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
                </SearchableSelect>
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
              <SearchableSelect
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
              </SearchableSelect>
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
                className="form-control form-select"
              >
                <option value="">Select Year</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="kilometer_driven">Mileage (km) *</label>
              <input
                type="number"
                id="kilometer_driven"
                name="kilometer_driven"
                value={formData.kilometer_driven}
                onChange={handleChange}
                min="0"
                required
                placeholder="Enter mileage in km"
                className="form-control"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="body_type">Body Type *</label>
              <SearchableSelect
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
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="is_insured">Is your car insured in UAE?</label>
              <SearchableSelect
                id="is_insured"
                name="is_insured"
                value={formData.is_insured}
                onChange={(e) => setFormData(prev => ({ ...prev, is_insured: e.target.value === 'true' }))}
                className="form-control form-select"
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </SearchableSelect>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="vehicle_type">Condition *</label>
              <SearchableSelect
                id="vehicle_type"
                name="vehicle_type"
                value={formData.vehicle_type}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="Used">Used</option>
                <option value="New">New</option>
                <option value="Certified Pre-Owned">Certified Pre-Owned</option>
              </SearchableSelect>
            </div>
            <div className="form-group">
              <label htmlFor="ownership_status">Ownership</label>
              <SearchableSelect
                id="ownership_status"
                name="ownership_status"
                value={formData.ownership_status}
                onChange={handleChange}
                className="form-control form-select"
              >
                <option value="">Select ownership</option>
                <option value="First Owner">First Owner</option>
                <option value="Second Owner">Second Owner</option>
                <option value="Third Owner or more">Third Owner or more</option>
                <option value="Company Fleet">Company Fleet</option>
              </SearchableSelect>
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
              <div className="phone-input-group">
                <SearchableSelect
                  id="country_code"
                  name="country_code"
                  className="form-control country-code-select"
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
                  type="text"
                  id="car_owner_phone_number"
                  name="car_owner_phone_number"
                  value={formData.car_owner_phone_number}
                  onChange={handleChange}
                  required
                  placeholder="Phone number"
                  className="form-control phone-number-input"
                />
              </div>
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

          <div className="form-subsection-title">Listing Description</div>
          <p className="form-subsection-desc">
            Add a clear title and summary so buyers can quickly trust the listing. Mention service history, ownership, upgrades, and reason for sale.
          </p>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="listing_title">Listing Title *</label>
              <input
                type="text"
                id="listing_title"
                name="listing_title"
                value={formData.listing_title}
                onChange={handleChange}
                required
                placeholder="2021 BMW M3 Competition"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="featured_listing">Featured Listing</label>
              <SearchableSelect
                id="featured_listing"
                name="featured_listing"
                value={formData.featured_listing ? 'true' : 'false'}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    featured_listing: event.target.value === 'true',
                  }))
                }
                className="form-control form-select"
              >
                <option value="false">Standard listing</option>
                <option value="true">Featured listing</option>
              </SearchableSelect>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="car_description">Listing Description *</label>
              <textarea
                id="car_description"
                name="car_description"
                value={formData.car_description}
                onChange={handleChange}
                rows="5"
                required
                placeholder="Include service history, accident history, upgrades, ownership, and reason for sale."
                className="form-control"
              ></textarea>
              <div className="form-text description-word-counter">
                {descriptionWordCount}/{MAX_DESCRIPTION_WORDS} words • {descriptionCharacterCount} characters
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="is_dealer">Dealer Listing</label>
              <SearchableSelect
                id="is_dealer"
                name="is_dealer"
                value={formData.is_dealer ? 'true' : 'false'}
                onChange={(event) =>
                  setFormData((prev) => ({
                    ...prev,
                    is_dealer: event.target.value === 'true',
                  }))
                }
                className="form-control form-select"
              >
                <option value="false">Private seller</option>
                <option value="true">Dealer</option>
              </SearchableSelect>
              <small className="form-text text-muted">Choose dealer if this listing is posted from a business account.</small>
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Specifications</h2>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="fuel_type">Fuel Type *</label>
              <SearchableSelect
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
              </SearchableSelect>
              <div className="form-text text-danger">This field is required.</div>
            </div>

            {formData.fuel_type === 'Other' && (
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
                  className="form-control"
                  required
                />
              </div>
            )}
            
            <div className="form-group">
              <label htmlFor="transmission_type">Transmission Type *</label>
              <SearchableSelect
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
              </SearchableSelect>
              <div className="form-text text-danger">This field is required.</div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="seating_capacity">Seating Capacity <span className="text-muted">(Optional)</span></label>
              <SearchableSelect
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
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="horsepower">Horsepower *</label>
              <SearchableSelect
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
              </SearchableSelect>
              <div className="form-text text-danger">This field is required.</div>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="engine_capacity">Engine Capacity (cc) <span className="text-muted">(Optional)</span></label>
              <SearchableSelect
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
              </SearchableSelect>
            </div>
            
            <div className="form-group">
              <label htmlFor="steering_side">Steering Side *</label>
              <SearchableSelect
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
              </SearchableSelect>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="drivetrain">Drivetrain</label>
              <SearchableSelect
                id="drivetrain"
                name="drivetrain"
                value={formData.drivetrain}
                onChange={handleChange}
                className="form-control form-select"
              >
                <option value="">Select drivetrain</option>
                <option value="FWD">FWD</option>
                <option value="RWD">RWD</option>
                <option value="AWD">AWD</option>
                <option value="4WD">4WD</option>
              </SearchableSelect>
            </div>
            <div className="form-group">
              <label htmlFor="fuel_efficiency">Fuel Efficiency</label>
              <input
                type="text"
                id="fuel_efficiency"
                name="fuel_efficiency"
                value={formData.fuel_efficiency}
                onChange={handleChange}
                placeholder="e.g. 12.4 km/l"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="torque">Torque</label>
              <input
                type="text"
                id="torque"
                name="torque"
                value={formData.torque}
                onChange={handleChange}
                placeholder="e.g. 500 Nm"
                className="form-control"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="color">Exterior Color *</label>
              <input
                type="text"
                id="color"
                name="color"
                value={formData.color}
                onChange={handleChange}
                required
                placeholder="e.g. Black"
                className="form-control"
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
                placeholder="e.g. Beige"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="cylinders">Cylinders *</label>
              <SearchableSelect
                id="cylinders"
                name="cylinders"
                value={formData.cylinders}
                onChange={handleChange}
                required
                className="form-control form-select"
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
              <label htmlFor="top_speed">Top Speed</label>
              <input
                type="text"
                id="top_speed"
                name="top_speed"
                value={formData.top_speed}
                onChange={handleChange}
                placeholder="e.g. 280 km/h"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="zero_to_hundred">0 - 100 km/h</label>
              <input
                type="text"
                id="zero_to_hundred"
                name="zero_to_hundred"
                value={formData.zero_to_hundred}
                onChange={handleChange}
                placeholder="e.g. 4.3 sec"
                className="form-control"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="doors">Doors *</label>
              <SearchableSelect
                id="doors"
                name="doors"
                value={formData.doors}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="">Select Doors</option>
                {DOOR_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </SearchableSelect>
            </div>
            <div className="form-group">
              <label htmlFor="warranty">Warranty *</label>
              <SearchableSelect
                id="warranty"
                name="warranty"
                value={formData.warranty}
                onChange={handleChange}
                required
                className="form-control form-select"
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
              <label htmlFor="service_history">Service History *</label>
              <SearchableSelect
                id="service_history"
                name="service_history"
                value={formData.service_history}
                onChange={handleChange}
                required
                className="form-control form-select"
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
                <strong>VIN helps your listing stand out:</strong> verified VIN details increase buyer trust and improve listing quality. <span className="vin-help-text"><strong>Where to find it:</strong> check your registration, insurance documents, driver's side dashboard (visible through windshield), driver's side door jamb, or under the hood.</span>
              </div>
            </div>
          </div>
          
          <div className="form-subsection-title">Extra Features</div>
          <p className="form-subsection-desc">Pick all options that apply. Chips stay aligned for quick scanning.</p>

          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="extras">Extra Features</label>
              <button type="button" className="text-danger extras-toggle" onClick={toggleExtras}>
                {showExtras ? 'Show less ▲' : 'Show all ▼'}
              </button>
              <div className="form-text">Choose all applicable add-ons so buyers can quickly see your car's key features.</div>
              
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

          <div className="form-subsection-title">Contact and Location</div>
          <p className="form-subsection-desc">Enter trusted contact details and pin the exact vehicle location.</p>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="contact_preference">Contact Preference</label>
              <SearchableSelect
                id="contact_preference"
                name="contact_preference"
                value={formData.contact_preference}
                onChange={handleChange}
                className="form-control form-select"
              >
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="any">Any</option>
              </SearchableSelect>
            </div>
            <div className="form-group">
              <label htmlFor="seller_name">Seller Name</label>
              <input
                type="text"
                id="seller_name"
                name="seller_name"
                value={formData.seller_name}
                onChange={handleChange}
                placeholder="Your full name"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="whatsapp_number">WhatsApp Number</label>
              <input
                type="text"
                id="whatsapp_number"
                name="whatsapp_number"
                value={formData.whatsapp_number}
                onChange={handleChange}
                placeholder="501234567"
                className="form-control"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="seller_email">Email</label>
              <input
                type="email"
                id="seller_email"
                name="seller_email"
                value={formData.seller_email}
                onChange={handleChange}
                placeholder="name@email.com"
                className="form-control"
              />
            </div>
            <div className="form-group">
              <label htmlFor="whatsapp_prefill_text">WhatsApp Pre-text (Optional)</label>
              <textarea
                id="whatsapp_prefill_text"
                name="whatsapp_prefill_text"
                value={formData.whatsapp_prefill_text}
                onChange={handleChange}
                placeholder="Hi, this is still available. Let me know if you'd like to view it."
                className="form-control"
                rows="3"
              />
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="car_location">Locate your car *</label>
              
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
                    required
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
                Type to search, click "Use Current Location", or click/drag on the map
              </div>

              <div className="map-container">
                {isGeocoding && (
                  <div className="map-loading-overlay">
                    <LoadingSpinner size="small" message="Loading location..." compact />
                  </div>
                )}
                <MapContainer 
                  center={mapPosition} 
                  zoom={13} 
                  scrollWheelZoom={false}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    attribution='&copy; OpenStreetMap contributors &copy; CARTO'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  />
                  <MapClickHandler />
                  <MarkerWithDrag />
                </MapContainer>
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
                className={`image-upload-area ${isDragOver ? 'drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleContainerClick}
              >
                <div className="upload-icon-wrapper">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p className="upload-text-main">Drag & Drop Images Here</p>
                <p className="upload-text-sub">or</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.gif"
                  multiple
                  onChange={handleFileChange}
                  className="file-input"
                  id="images"
                />
                <button type="button" className="browse-btn" onClick={handleBrowseClick}>
                  Browse Files
                </button>
                <p className="upload-text-sub">Maximum 10 images • JPG, PNG, WEBP, GIF • 5MB each</p>
              </div>
              
              {previewImages.length > 0 && (
                <div className="image-previews-grid car-framing-grid">
                  {previewImages.map((preview, index) => (
                    <div 
                      className={`preview-item car-framing-preview ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
                      key={index}
                      draggable
                      onDragStart={(e) => handleImageDragStart(e, index)}
                      onDragOver={(e) => handleImageDragOver(e, index)}
                      onDragLeave={handleImageDragLeave}
                      onDrop={(e) => handleImageDrop(e, index)}
                      onDragEnd={handleImageDragEnd}
                    >
                      <div className="preview-order">{index + 1}</div>
                      <img
                        src={preview}
                        alt={`Preview ${index + 1}`}
                        style={{
                          objectPosition: `${imageCropSettings[index]?.focalX ?? 50}% ${imageCropSettings[index]?.focalY ?? 50}%`,
                          transform: `scale(${imageCropSettings[index]?.zoom ?? 1})`,
                          transformOrigin: `${imageCropSettings[index]?.focalX ?? 50}% ${imageCropSettings[index]?.focalY ?? 50}%`
                        }}
                      />
                      <button 
                        type="button" 
                        className="remove-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const newPreviews = [...previewImages];
                          const newSelectedFiles = [...selectedFiles];
                          const newCropSettings = [...imageCropSettings];
                          newPreviews.splice(index, 1);
                          newSelectedFiles.splice(index, 1);
                          newCropSettings.splice(index, 1);
                          setPreviewImages(newPreviews);
                          setSelectedFiles(newSelectedFiles);
                          setImageCropSettings(newCropSettings);
                          if (!newPreviews.length) {
                            setShowFramingModal(false);
                            setActiveFramingIndex(0);
                          }
                        }}
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        className="frame-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveFramingIndex(index);
                          setShowFramingModal(true);
                        }}
                      >
                        Frame
                      </button>
                      <div className="drag-handle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="9" cy="6" r="1.5"/>
                          <circle cx="15" cy="6" r="1.5"/>
                          <circle cx="9" cy="12" r="1.5"/>
                          <circle cx="15" cy="12" r="1.5"/>
                          <circle cx="9" cy="18" r="1.5"/>
                          <circle cx="15" cy="18" r="1.5"/>
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {previewImages.length > 1 && (
                <p className="reorder-hint">Drag images to reorder. First image will be the main photo.</p>
              )}
              {previewImages.length > 0 && (
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
              )}
            </div>
          </div>
        </div>
        
        <div className="form-actions-section">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isSubmitting}
            onClick={handleSaveDraft}
          >
            Save Draft
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Listing'}
          </button>
          <p>Save a draft anytime and come back later. Submit when everything looks right.</p>
        </div>
        </form>
        </div>
      </section>

      <ImageFramingModal
        isOpen={showFramingModal}
        images={previewImages.map((previewUrl, index) => ({
          previewUrl,
          name: selectedFiles[index]?.name || `Photo ${index + 1}`
        }))}
        cropSettings={imageCropSettings}
        activeIndex={activeFramingIndex}
        onActiveIndexChange={setActiveFramingIndex}
        onUpdateCrop={updateImageCropSetting}
        onApplyCurrentToAll={applyCurrentCropToAll}
        onClose={() => setShowFramingModal(false)}
      />
    </div>
  );
};

export default PostCar; 
