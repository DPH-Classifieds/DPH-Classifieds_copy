import React, { useRef, useState, useEffect, useMemo } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import UAELicensePlate from './UAELicensePlate';
import '../styles/CreateListing.css';
import '../styles/PostForms.css';
import '../styles/UAELicensePlate.css';

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

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_IMAGE_CROP = { focalX: 50, focalY: 50, zoom: 1 };
const MAX_DESCRIPTION_WORDS = 300;

const LISTING_TYPE_CONFIG = {
  car: {
    fetchUrl: (id) => `${API_URL}/api/cars/${id}`,
    createEndpoint: '/api/cars',
    updateEndpoint: (id) => `/api/cars/${id}`,
    imagesTable: 'car_images',
    fkField: 'car_id',
    detailPath: (id) => `/cars/${id}`,
    label: 'Car',
    statusReset: true,
    heroTitle: 'Publish A Car Listing With Confidence',
    heroSubtitle: 'Fill in the details below to reach thousands of buyers across the UAE.',
    heroKicker: 'Sell Your Car'
  },
  bike: {
    fetchUrl: (id) => `${API_URL}/api/bikes/${id}`,
    createEndpoint: '/api/bikes',
    updateEndpoint: (id) => `/api/bikes/${id}`,
    imagesTable: 'bike_images',
    fkField: 'bike_id',
    detailPath: (id) => `/bikes/${id}`,
    label: 'Bike',
    statusReset: true,
    heroTitle: 'Publish A Bike Listing With Confidence',
    heroSubtitle: 'Clean specs, crisp media, and a clear seller story help the right buyer move faster.',
    heroKicker: 'Sell Your Bike'
  },
  part: {
    fetchUrl: (id) => `${API_URL}/api/parts/${id}`,
    createEndpoint: '/api/parts',
    updateEndpoint: (id) => `/api/parts/${id}`,
    imagesTable: 'part_images',
    fkField: 'part_id',
    detailPath: (id) => `/car-parts/${id}`,
    label: 'Car Part',
    statusReset: true,
    heroTitle: 'Sell Your Car Parts Fast',
    heroSubtitle: 'List your performance parts, body kits, or accessories for our community.',
    heroKicker: 'Sell Parts'
  },
  plate: {
    fetchUrl: (id) => `${API_URL}/api/plates/${id}`,
    createEndpoint: '/api/plates',
    updateEndpoint: (id) => `/api/plates/${id}`,
    imagesTable: 'plate_images',
    fkField: 'plate_id',
    detailPath: (id) => `/plates/${id}`,
    label: 'Plate',
    statusReset: true,
    heroTitle: 'Present Your Plate Like A Premium Asset',
    heroSubtitle: 'Reach the right audience for your unique license plate digits.',
    heroKicker: 'Sell Your Plate'
  },
};

const LocationMarker = ({ position, setPosition }) => {
  const map = useMap();
  
  useMemo(() => {
    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      setPosition([lat, lng]);
      map.flyTo([lat, lng], map.getZoom());
    });
  }, [map, setPosition]);

  return position ? <Marker position={position} /> : null;
};

const ListingForm = ({ type: typeProp }) => {
  const params = useParams();
  const location = useLocation();
  const id = params.id;
  const listingType = typeProp || params.type || 'car';
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const formRef = useRef(null);
  const typeConfig = LISTING_TYPE_CONFIG[listingType] || LISTING_TYPE_CONFIG.car;
  
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
    whatsapp_country_code: defaultCountryCode,
    whatsapp_number: '',
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
    // Bike specific
    bike_brand: '',
    bike_model: '',
    year: '',
    bike_category: '',
    engine_size: '',
    mileage: '',
    condition: 'Good',
    price: '',
    location: '',
    description: '',
    is_dealer: false,
    features: [],
    // Part specific
    name: '',
    part_type: '',
    is_negotiable: false,
    contact_number: '',
    // Plate specific
    city: '',
    code: '',
    digits: '',
    number: '',
    plate_format: 'Any format',
    contact_name: '',
    contact_phone: '',
    // Features/Extras (Cars)
    climate_control: false,
    dvd_player: false,
    keyless_entry: false,
    navigation_system: false,
    premium_sound_system: false,
    cooled_seats: false,
    front_wheel_drive: false,
    leather_seats: false,
    parking_sensors: false,
    rear_view_camera: false,
    lady_driven: false,
    // Location
    latitude: 25.276987,
    longitude: 55.296249,
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
  
  // Fetch the listing data when component mounts if in edit mode
  useEffect(() => {
    if (isEdit) {
      fetchListing();
    } else {
      setLoading(false);
    }
  }, [id, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  
  const fetchListing = async () => {
    try {
      const token = await getAccessToken();
      
      if (!token) {
        throw new Error('Authentication token not found');
      }
      
      const response = await fetch(typeConfig.fetchUrl(id), {
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
      
      let whatsappCountryCode = defaultCountryCode;
      let whatsappNumber = '';
      if (data.whatsapp_number) {
        const match = data.whatsapp_number.match(/^(\+\d+)(\d+)$/);
        if (match) {
          whatsappCountryCode = match[1];
          whatsappNumber = match[2];
        } else {
          whatsappNumber = data.whatsapp_number;
        }
      }

      if (listingType === 'bike') {
        setFormData(prev => ({
          ...prev,
          bike_brand: data.bike_brand || data.make || '',
          bike_model: data.bike_model || data.model || '',
          year: data.year || '',
          bike_category: data.bike_type || data.bike_category || '',
          engine_capacity: data.engine_size || data.engine_capacity || '',
          mileage: data.mileage || '',
          color: data.color || '',
          condition: data.condition || '',
          price: data.price || '',
          location: data.location || '',
          area: data.area || '',
          emirate: data.emirate || 'Dubai',
          description: data.description || '',
          whatsapp_prefill_text: data.whatsapp_prefill_text || '',
          vin_number: data.vin_number || '',
          is_dealer: data.is_dealer || false,
        }));
      } else if (listingType === 'part') {
        setFormData(prev => ({
          ...prev,
          name: data.name || '',
          part_type: data.part_type || '',
          condition: data.condition || '',
          price: data.price || '',
          location: data.location || '',
          area: data.area || '',
          emirate: data.emirate || 'Dubai',
          contact_number: data.contact_number || '',
          country_code: data.country_code || defaultCountryCode,
          whatsapp_prefill_text: data.whatsapp_prefill_text || '',
          description: data.description || '',
          is_negotiable: data.is_negotiable || false,
          is_dealer: data.is_dealer || false,
        }));
      } else if (listingType === 'plate') {
        setFormData(prev => ({
          ...prev,
          city: data.city || '',
          code: data.code || '',
          digits: data.digits || '',
          number: data.number || '',
          price: data.price || '',
          plate_format: data.plate_format || '',
          contact_name: data.contact_name || '',
          contact_phone: data.contact_phone || '',
          whatsapp_prefill_text: data.whatsapp_prefill_text || '',
          area: data.area || '',
          emirate: data.emirate || 'Dubai',
          description: data.description || '',
          is_dealer: data.is_dealer || false,
        }));
      } else {
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
          whatsapp_country_code: whatsappCountryCode,
          whatsapp_number: whatsappNumber,
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
          rear_view_camera: data.rear_view_camera || false,
          lady_driven: data.lady_driven || false,
        });
        setOtherFuelType(parsedOtherFuelType);
      }
      
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

    if (name === 'country_code') {
      setFormData((prev) => ({
        ...prev,
        country_code: value,
        whatsapp_country_code: value
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
        if (value !== '' && key !== 'whatsapp_country_code') {
          formDataToSend.append(key, value);
        }
      });

      // Combine WhatsApp country code and number
      if (formData.whatsapp_number) {
        formDataToSend.set('whatsapp_number', `${formData.whatsapp_country_code}${formData.whatsapp_number}`);
      }

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
      
      if (isEdit) {
        // Try PATCH first as it's the most compatible with PostgREST updates
        const updateAttempts = [
          { endpoint: typeConfig.updateEndpoint(id), method: 'PATCH' },
          { endpoint: typeConfig.updateEndpoint(id), method: 'PUT' },
          { endpoint: typeConfig.updateEndpoint(id), method: 'POST' }
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
            console.warn(`Update attempt ${attempt.method} ${attempt.endpoint} failed:`, err.status, err.message);
            lastError = err;
            if (err.status === 405 || err.status === 404) continue;
            throw err;
          }
        }
        if (lastError) throw lastError;
      } else {
        // Create mode
        const response = await apiClient.post(typeConfig.createEndpoint, formDataToSend);
        const newId = response.id;
        navigate(typeConfig.detailPath(newId));
        return;
      }
      
      navigate(typeConfig.detailPath(id));
    } catch (err) {
      console.error(`Error ${isEdit ? 'updating' : 'creating'} listing:`, err);
      setError(err.message || `Failed to ${isEdit ? 'update' : 'create'} the listing. Please try again.`);
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
      {!isEdit && (
        <section className="post-hero-section">
          <div className="post-hero-content">
            <div className="post-hero-text">
              <span className="post-hero-kicker">{typeConfig.heroKicker}</span>
              <h1 className="post-hero-title">{typeConfig.heroTitle}</h1>
              <p className="post-hero-subtitle">{typeConfig.heroSubtitle}</p>
            </div>
          </div>
        </section>
      )}

      {isEdit && (
        <h1 className="section-title">
          Edit {typeConfig.label || listingType.charAt(0).toUpperCase() + listingType.slice(1)} Listing
        </h1>
      )}
      
      {error && <div className="alert alert-danger">{error}</div>}
      
      <form className="create-listing-form" onSubmit={handleSubmit} ref={formRef} noValidate>
        <div className="form-section">
          <h2>Basic Information</h2>
          
          {listingType === 'car' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="listing_title">Listing Title *</label>
                  <input
                    type="text"
                    id="listing_title"
                    name="listing_title"
                    value={formData.listing_title}
                    onChange={handleChange}
                    placeholder="e.g. 2021 BMW M3 Competition"
                    required
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="car_manufacturer">Manufacturer *</label>
                  <input
                    type="text"
                    id="car_manufacturer"
                    name="car_manufacturer"
                    value={formData.car_manufacturer}
                    onChange={handleChange}
                    placeholder="e.g. BMW"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="car_model">Model *</label>
                  <input
                    type="text"
                    id="car_model"
                    name="car_model"
                    value={formData.car_model}
                    onChange={handleChange}
                    placeholder="e.g. M3"
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
                    placeholder="e.g. Competition"
                  />
                </div>
                
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
              </div>
            </>
          )}

          {listingType === 'bike' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="bike_brand">Brand *</label>
                  <input
                    type="text"
                    id="bike_brand"
                    name="bike_brand"
                    value={formData.bike_brand}
                    onChange={handleChange}
                    placeholder="e.g. Yamaha"
                    required
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
                    placeholder="e.g. R6"
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="year">Year *</label>
                  <SearchableSelect id="year" name="year" value={formData.year} onChange={handleChange} required>
                    <option value="">Select Year</option>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </SearchableSelect>
                </div>
                <div className="form-group">
                  <label htmlFor="bike_category">Category *</label>
                  <SearchableSelect id="bike_category" name="bike_category" value={formData.bike_category} onChange={handleChange} required>
                    <option value="">Select category</option>
                    {['Sport', 'Cruiser', 'Touring', 'Adventure', 'Naked', 'Off-road', 'Scooter', 'Electric'].map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </SearchableSelect>
                </div>
              </div>
            </>
          )}

          {listingType === 'part' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="name">Part Name *</label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="e.g. BMW M3 Brake Pads"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="part_type">Part Type *</label>
                  <input
                    type="text"
                    id="part_type"
                    name="part_type"
                    value={formData.part_type}
                    onChange={handleChange}
                    placeholder="e.g. Brakes"
                    required
                  />
                </div>
              </div>
            </>
          )}

          {listingType === 'plate' && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="city">City *</label>
                  <SearchableSelect id="city" name="city" value={formData.city} onChange={handleChange} required>
                    <option value="">Select city</option>
                    {['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Fujairah', 'Ras Al Khaimah', 'Umm Al Quwain'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </SearchableSelect>
                </div>
                <div className="form-group">
                  <label htmlFor="code">Plate Code *</label>
                  <input
                    type="text"
                    id="code"
                    name="code"
                    value={formData.code}
                    onChange={handleChange}
                    placeholder="e.g. A"
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="number">Plate Number *</label>
                  <input
                    type="text"
                    id="number"
                    name="number"
                    value={formData.number}
                    onChange={handleChange}
                    placeholder="e.g. 12345"
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="plate_format">Format</label>
                  <SearchableSelect id="plate_format" name="plate_format" value={formData.plate_format} onChange={handleChange}>
                    <option value="Any format">Any format</option>
                    <option value="Solid">Solid</option>
                    <option value="Repeated">Repeated</option>
                  </SearchableSelect>
                </div>
              </div>
              <div className="plate-preview-panel" style={{ marginTop: '20px', textAlign: 'center' }}>
                <h3>Plate Preview</h3>
                <div className="plate-preview-shell" style={{ display: 'inline-block', padding: '20px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                  <UAELicensePlate 
                    city={formData.city || 'Dubai'} 
                    code={formData.code || 'A'} 
                    number={formData.number || '12345'} 
                  />
                </div>
              </div>
            </>
          )}
        </div>
        
        <div className="form-section">
          <h2>Details & Pricing</h2>
          
          <div className="form-row">
            {(listingType === 'car' || listingType === 'bike') && (
              <div className="form-group">
                <label htmlFor={listingType === 'car' ? 'kilometer_driven' : 'mileage'}>
                  {listingType === 'car' ? 'Mileage (km) *' : 'Mileage (km) *'}
                </label>
                <input
                  type="number"
                  id={listingType === 'car' ? 'kilometer_driven' : 'mileage'}
                  name={listingType === 'car' ? 'kilometer_driven' : 'mileage'}
                  value={listingType === 'car' ? formData.kilometer_driven : formData.mileage}
                  onChange={handleChange}
                  placeholder="e.g. 35000"
                  min="0"
                  required
                />
              </div>
            )}
            
            <div className="form-group">
              <label htmlFor={listingType === 'car' ? 'expected_selling_price' : 'price'}>Price (AED) *</label>
              <input
                type="number"
                id={listingType === 'car' ? 'expected_selling_price' : 'price'}
                name={listingType === 'car' ? 'expected_selling_price' : 'price'}
                value={listingType === 'car' ? formData.expected_selling_price : formData.price}
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

            <div className="feature-item">
              <label htmlFor="lady_driven">
                <input
                  type="checkbox"
                  id="lady_driven"
                  name="lady_driven"
                  checked={formData.lady_driven}
                  onChange={handleChange}
                />
                <span>Lady Driven</span>
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

          {listingType === 'car' && (
            <div className="form-row">
              <div className="form-group full-width">
                <label>Pin Location on Map (Optional)</label>
                <div className="map-selection-container" style={{ height: '300px', borderRadius: '12px', overflow: 'hidden', marginBottom: '20px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <MapContainer center={[formData.latitude, formData.longitude]} zoom={13} style={{ height: '100%', width: '100%' }}>
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <LocationMarker 
                      position={[formData.latitude, formData.longitude]} 
                      setPosition={(pos) => setFormData(prev => ({ ...prev, latitude: pos[0], longitude: pos[1] }))} 
                    />
                  </MapContainer>
                </div>
                <small className="form-text">Click on the map to set the exact location of the vehicle.</small>
              </div>
            </div>
          )}
          
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
              <label htmlFor="whatsapp_number">WhatsApp Number</label>
              <div className="phone-input-group">
                <SearchableSelect
                  id="whatsapp_country_code"
                  name="whatsapp_country_code"
                  className="country-code-select"
                  value={formData.whatsapp_country_code}
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
                  id="whatsapp_number"
                  name="whatsapp_number"
                  value={formData.whatsapp_number}
                  onChange={handleChange}
                  placeholder="e.g. 501234567"
                  className="phone-number-input"
                />
              </div>
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

export default ListingForm;
