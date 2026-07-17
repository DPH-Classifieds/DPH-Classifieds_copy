import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import SearchableSelect from './ui/searchable-select';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { getAccessToken } from '../utils/supabaseClient';
import { trackEvent } from '../utils/analytics';
import '../styles/PostForms.css';
import { carMakes, carModels, carTrims } from '../utils/carData';
import LoadingSpinner from './LoadingSpinner';
import { countryCodes, defaultCountryCode, splitPhoneNumberForInput } from '../utils/countryCodes';
import {
  CYLINDER_OPTIONS,
  DOOR_OPTIONS,
  SERVICE_HISTORY_OPTIONS,
  UAE_EMIRATES,
  WARRANTY_OPTIONS,
  getAreasForEmirate,
  getYearOptions,
	  EXTERIOR_COLOR_OPTIONS,
	  INTERIOR_COLOR_OPTIONS,
	  FUEL_EFFICIENCY_OPTIONS,
	  TAG_OPTIONS,
	} from '../utils/listingConstants';
import 'leaflet/dist/leaflet.css';
import UnifiedCropper from './cropper/UnifiedCropper';
import { getWhatsappPrefillTemplate } from '../utils/whatsapp';
import { isVinValid, normalizeVin } from '../utils/vinValidation';
import ActionNoticeModal from './ui/ActionNoticeModal';
import { buildDealerHelpMailto, buildErrorNotice } from '../utils/errorNotice';
import { LISTING_IMAGE_MAX_BYTES, uploadListingImagesDirect, uploadRegistrationDocument } from '../utils/directUpload';
import { normalizeRegistrationScanResponse } from '../utils/registrationScan';
import { moderateImage } from '../utils/imageModeration';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = LISTING_IMAGE_MAX_BYTES;
const MAX_DESCRIPTION_WORDS = 300;
const DEFAULT_MAP_POSITION = [25.276987, 55.296249];
const EMIRATE_CENTERS = {
  'Dubai': [25.276987, 55.296249],
  'Abu Dhabi': [24.453884, 54.377343],
  'Sharjah': [25.346255, 55.420932],
  'Ajman': [25.405216, 55.513641],
  'Umm Al Quwain': [25.564716, 55.553237],
  'Ras Al Khaimah': [25.789295, 55.942478],
  'Fujairah': [25.128526, 56.326584],
};
const CAR_DRAFT_STORAGE_KEY = 'dph_post_car_draft_v2';
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const DEFAULT_WHATSAPP_PREFILL = getWhatsappPrefillTemplate('car');
const SUBMISSION_ERROR_MESSAGE =
  'We could not submit your listing right now. Please try again or contact support at support@dphclassifieds.com.';

const RequiredMark = () => <span className="required-asterisk">*</span>;

const PostCar = () => {
  const { id: listingId } = useParams();
  const isEdit = Boolean(listingId);
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingListing, setIsLoadingListing] = useState(isEdit);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const formRef = useRef(null);
  const locationInputRef = useRef(null);
  const [showExtras, setShowExtras] = useState(false);
  const [otherFuelType, setOtherFuelType] = useState('');
  const [existingImages, setExistingImages] = useState([]);
  const [pendingCropFiles, setPendingCropFiles] = useState(null);
  const [croppedImages, setCroppedImages] = useState([]); // Array<{croppedFile, originalFile, previewUrl}>
  const [mapPosition, setMapPosition] = useState(DEFAULT_MAP_POSITION); // Default to Dubai coordinates
  const [marker, setMarker] = useState(DEFAULT_MAP_POSITION);
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false);
  const [draftNotice, setDraftNotice] = useState(null);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [registrationOcrFile, setRegistrationOcrFile] = useState(null);
  const [registrationOcrPreparedImage, setRegistrationOcrPreparedImage] = useState(null);
  const [registrationOcrProgress, setRegistrationOcrProgress] = useState(0);
  const [registrationOcrStatus, setRegistrationOcrStatus] = useState(null);
  const [registrationOcrSuggestions, setRegistrationOcrSuggestions] = useState(null);
  const [registrationOcrError, setRegistrationOcrError] = useState(null);
  const [registrationOcrTruth, setRegistrationOcrTruth] = useState(null);
  const [registrationOcrDebugInfo, setRegistrationOcrDebugInfo] = useState(null);
  const [registrationDocumentUrl, setRegistrationDocumentUrl] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [uploadingRegistrationDoc, setUploadingRegistrationDoc] = useState(false);
  const registrationDocumentUploadPromiseRef = useRef(null);
  const [useUsernameAsSellerName, setUseUsernameAsSellerName] = useState(false);
  const [mapModules, setMapModules] = useState(null);
  const [mapModulesError, setMapModulesError] = useState(null);
  const locationSearchTimeoutRef = useRef(null);
  const locationSearchAbortRef = useRef(null);
  const skipNextLocationSearchRef = useRef(false);
  
  // Enhanced map features state
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);

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
    ownership_status: '',
    drivetrain: '',
    fuel_efficiency: '',
    torque: '',
    interior_color: '',
    seller_name: '',
    whatsapp_country_code: defaultCountryCode,
    whatsapp_number: '',
    whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
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

  useEffect(() => {
    const username = String(user?.username || '').trim();
    if (!username) {
      setUseUsernameAsSellerName(false);
      return;
    }

    setUseUsernameAsSellerName(true);
    setFormData((prev) => ({
      ...prev,
      seller_name: username,
    }));
  }, [user?.username]);

  // Prefill emirate/area/location from the user's profile on first load (non-edit only).
  // Centers the map on the user's emirate so they only have to drop a precise pin.
  const profileLocationPrefilledRef = useRef(false);
  useEffect(() => {
    if (isEdit || profileLocationPrefilledRef.current || !user) return;
    const profileEmirate = String(user.emirate || user.car_city || '').trim();
    const profileArea = String(user.area || '').trim();
    if (!profileEmirate && !profileArea) return;

    profileLocationPrefilledRef.current = true;
    const validEmirate = UAE_EMIRATES.includes(profileEmirate) ? profileEmirate : null;
    const validAreas = validEmirate ? getAreasForEmirate(validEmirate) : [];
    const validArea = validAreas.includes(profileArea) ? profileArea : (validAreas.length === 0 ? profileArea : '');
    const center = (validEmirate && EMIRATE_CENTERS[validEmirate]) || DEFAULT_MAP_POSITION;
    const label = [validArea, validEmirate].filter(Boolean).join(', ');

    setFormData((prev) => ({
      ...prev,
      car_city: validEmirate || prev.car_city,
      emirate: validEmirate || prev.emirate,
      area: validArea || prev.area,
      car_location: prev.car_location || label,
      latitude: center[0],
      longitude: center[1],
    }));
    setMarker(center);
    setMapPosition(center);
  }, [user, isEdit]);

  useEffect(() => {
    let cancelled = false;

    const loadMapModules = async () => {
      try {
        const [leafletModule, reactLeafletModule] = await Promise.all([
          import('leaflet'),
          import('react-leaflet'),
        ]);
        const [iconModule, shadowModule] = await Promise.all([
          import('leaflet/dist/images/marker-icon.png'),
          import('leaflet/dist/images/marker-shadow.png'),
        ]);
        if (cancelled) return;

        const leafletNamespace = leafletModule.default || leafletModule;
        const iconUrl = iconModule.default || iconModule;
        const shadowUrl = shadowModule.default || shadowModule;
        const defaultIcon = leafletNamespace.icon({
          iconUrl,
          shadowUrl,
          iconSize: [25, 41],
          iconAnchor: [12, 41],
        });
        leafletNamespace.Marker.prototype.options.icon = defaultIcon;

        setMapModules({
          MapContainer: reactLeafletModule.MapContainer,
          TileLayer: reactLeafletModule.TileLayer,
          Marker: reactLeafletModule.Marker,
          useMap: reactLeafletModule.useMap,
        });
        setMapModulesError(null);
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to load map modules lazily:', err);
          setMapModulesError(err);
        }
      }
    };

    loadMapModules();

    return () => {
      cancelled = true;
    };
  }, []);

  const resetRegistrationOcrState = useCallback(() => {
    setRegistrationOcrError(null);
    setRegistrationOcrStatus(null);
    setRegistrationOcrProgress(0);
    setRegistrationOcrSuggestions(null);
    setRegistrationOcrPreparedImage(null);
    setRegistrationOcrTruth(null);
    setRegistrationOcrDebugInfo(null);
    setRegistrationDocumentUrl(null);
    setUploadingRegistrationDoc(false);
    registrationDocumentUploadPromiseRef.current = null;
  }, []);

  const applyRegistrationScanResult = useCallback((scan, { status = 'Done', debugInfo = null } = {}) => {
    setRegistrationOcrSuggestions(scan);
    setRegistrationOcrDebugInfo(debugInfo);
    setRegistrationOcrStatus(status);
    // Autofill everything the scan read, but keep it all EDITABLE. The only
    // thing locked as source-of-truth is a genuinely checksum-valid VIN (rare,
    // North-America only) — make/model/year and GCC/UAE VINs stay editable so
    // the user can correct any OCR slip.
    setRegistrationOcrTruth(
      scan.vinLocked ? { make: null, model: null, year: null, vin: scan.fields.vin || null } : null
    );

    if (!scan.shouldAutoFill) {
      return;
    }

    setFormData((prev) => {
      const next = { ...prev };
      if (scan.fields.make) {
        next.car_manufacturer = scan.fields.make;
      }
      if (scan.fields.model) {
        next.car_model = scan.fields.model;
      }
      if (scan.fields.year) {
        next.make_year = scan.fields.year;
      }
      if (scan.fields.vin) {
        next.vin_number = String(scan.fields.vin).toUpperCase();
      }
      return next;
    });
  }, []);

  const ensureRegistrationDocumentUploaded = useCallback(async () => {
    if (!registrationOcrFile || !user?.id) {
      return registrationDocumentUrl;
    }

    if (registrationDocumentUrl) {
      return registrationDocumentUrl;
    }

    if (!registrationDocumentUploadPromiseRef.current) {
      setUploadingRegistrationDoc(true);
      registrationDocumentUploadPromiseRef.current = uploadRegistrationDocument(registrationOcrFile, { userId: user.id })
        .then((url) => {
          setRegistrationDocumentUrl(url);
          return url;
        })
        .finally(() => {
          setUploadingRegistrationDoc(false);
          registrationDocumentUploadPromiseRef.current = null;
        });
    }

    return registrationDocumentUploadPromiseRef.current;
  }, [registrationDocumentUrl, registrationOcrFile, user?.id]);

  const runRegistrationOcr = useCallback(async () => {
    if (!registrationOcrFile) {
      setRegistrationOcrError('Please choose a clear photo of your car registration first.');
      return;
    }

    resetRegistrationOcrState();
    setRegistrationOcrStatus('Preparing…');

    // Upload the registration document to storage in parallel with OCR.
    // Submit waits on the same promise before persisting the listing.
    void ensureRegistrationDocumentUploaded().catch((err) => {
      console.warn('Failed to upload registration document:', err);
      setRegistrationOcrError('Could not upload the registration document. Please try again.');
    });

    try {
      // Scan via the backend (which calls the PaddleOCR microservice). The
      // backend accepts images and PDFs natively and does all VIN/plate
      // validation. There is deliberately NO browser-side OCR fallback: the
      // old Tesseract.js fallback produced garbage reads it couldn't verify
      // and mislabelled them "valid". If the backend can't scan, the user
      // enters the details manually.
      setRegistrationOcrStatus('Scanning…');
      const formData = new FormData();
      formData.append('image', registrationOcrFile, registrationOcrFile.name || 'registration-scan');
      formData.append('document_type', 'mulkiya');
      if (isEdit && listingId) {
        formData.append('listing_type', 'car');
        formData.append('listing_id', listingId);
      }

      const backendScan = normalizeRegistrationScanResponse(
        await apiClient.post('/api/ocr/scan-registration', formData)
      );

      applyRegistrationScanResult(backendScan);
      setRegistrationOcrError(null);
    } catch (err) {
      console.error('Registration OCR failed:', err);
      setRegistrationOcrStatus(null);
      setRegistrationOcrError(
        err?.message && err.message.includes('registration document')
          ? err.message
          : 'OCR failed. Please try a clearer photo (good lighting, minimal glare).'
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, no-use-before-define
  }, [applyRegistrationScanResult, ensureRegistrationDocumentUploaded, isEdit, listingId, registrationOcrFile, resetRegistrationOcrState]);

  const countWords = (text) => (text.trim().match(/\S+/g) || []).length;

  const limitWords = (text, maxWords) => {
    if (!text) return text;
    const matches = Array.from(String(text).matchAll(/\S+/g));
    if (matches.length <= maxWords) {
      return text;
    }
    const cutoff = matches[maxWords]?.index ?? String(text).length;
    return String(text).slice(0, cutoff).trimEnd();
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
  const errorNotice = useMemo(() => buildErrorNotice(error), [error]);
  const listingLimitActions = useMemo(
    () => [
      {
        label: 'My Listings',
        onClick: () => {
          setError(null);
          navigate('/my-listings');
        },
      },
      {
        label: "I’m a Dealer",
        href: buildDealerHelpMailto({
          subject: 'Dealer listing help',
          body: `Hi team,\n\nI reached the listing limit and would like help with dealer posting access.\n\nAccount email: ${user?.email || 'Not set'}\nListing page: ${typeof window !== 'undefined' ? window.location.href : ''}\n`,
        }),
      },
      {
        label: 'Home',
        onClick: () => {
          setError(null);
          navigate('/');
        },
      },
    ],
    [navigate, user?.email]
  );
  const errorActions = errorNotice?.code === 'listing_limit' ? listingLimitActions : [];

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
  };

  // Note: carExtras is now organized by categories above

  // Check if user is logged in when component loads
  useEffect(() => {
    const checkAuth = async () => {
      await syncWithSupabase({ forceBackendCheck: true });
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

  const applyDraftPayload = useCallback((draft) => {
    if (!draft || typeof draft !== 'object') {
      return false;
    }

    if (draft.formData && typeof draft.formData === 'object') {
      setFormData((prev) => ({ ...prev, ...draft.formData }));
      if (draft.formData.listing_title) {
        setTitleManuallyEdited(true);
      }
    }
    if (typeof draft.otherFuelType === 'string') {
      setOtherFuelType(draft.otherFuelType);
    }
    if (typeof draft.whatsappSameAsPhone === 'boolean') {
      setWhatsappSameAsPhone(draft.whatsappSameAsPhone);
    }
    if (Array.isArray(draft.marker) && draft.marker.length === 2) {
      setMarker(draft.marker);
      setMapPosition(draft.marker);
    }
    if (Array.isArray(draft.existingImages)) {
      setExistingImages(draft.existingImages);
    }
    return true;
  }, []);

  useEffect(() => {
    if (isEdit) return;

    let isMounted = true;

    const loadDraft = async () => {
      try {
        const response = await apiClient.request('/api/user/drafts/car');
        const remoteDraft = response?.draft?.payload || response?.draft?.draft_payload || null;
        if (isMounted && applyDraftPayload(remoteDraft)) {
          setDraftNotice('Draft restored from your saved drafts.');
          return;
        }
      } catch (remoteError) {
        console.warn('Failed to load remote car draft:', remoteError);
      }

      try {
        const rawDraft = localStorage.getItem(CAR_DRAFT_STORAGE_KEY);
        if (!rawDraft || !isMounted) return;
        const localDraft = JSON.parse(rawDraft);
        if (applyDraftPayload(localDraft)) {
          setDraftNotice('Draft restored from this browser.');
        }
      } catch (draftError) {
        console.warn('Failed to load car draft:', draftError);
        if (isMounted) {
          setError('Could not load your saved draft. Please contact support if this continues.');
        }
      }
    };

    loadDraft();

    return () => {
      isMounted = false;
    };
  }, [applyDraftPayload, isEdit]);

  useEffect(() => {
    const fetchListing = async () => {
      if (!isEdit || !listingId) {
        setIsLoadingListing(false);
        return;
      }

      try {
        const token = await getAccessToken();
        if (!token) {
          throw new Error('Authentication token not found');
        }

        const response = await fetch(`${API_URL}/api/cars/${listingId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load car listing');
        }

        const data = await response.json();
        const fuelValue = data.fuel_type || '';
        const hasCustomFuel = typeof fuelValue === 'string' && fuelValue.toLowerCase().startsWith('other - ');
        const parsedOtherFuelType = hasCustomFuel ? fuelValue.slice(8).trim() : '';

        let whatsappCountryCode = defaultCountryCode;
        let whatsappNumber = '';
        if (data.whatsapp_number) {
          const match = String(data.whatsapp_number).match(/^(\+\d+)(\d+)$/);
          if (match) {
            whatsappCountryCode = match[1];
            whatsappNumber = match[2];
          } else {
            whatsappNumber = String(data.whatsapp_number);
          }
        }

        const latitude = Number(data.latitude) || DEFAULT_MAP_POSITION[0];
        const longitude = Number(data.longitude) || DEFAULT_MAP_POSITION[1];

        setFormData((prev) => ({
          ...prev,
          car_manufacturer: data.car_manufacturer || '',
          car_model: data.car_model || '',
          trim: data.trim || data.car_variant || '',
          regional_spec: data.regional_spec || 'GCC',
          make_year: data.make_year || new Date().getFullYear(),
          kilometer_driven: data.kilometer_driven || data.mileage || 0,
          body_type: data.body_type || '',
          is_insured: Boolean(data.is_insured),
          expected_selling_price: data.expected_selling_price || 0,
          country_code: data.country_code || defaultCountryCode,
          car_owner_phone_number: splitPhoneNumberForInput(
            data.car_owner_phone_number || data.contact_phone || '',
            data.country_code || defaultCountryCode
          ).phoneNumber,
          car_city: data.car_city || data.emirate || 'Dubai',
          emirate: data.emirate || data.car_city || 'Dubai',
          area: data.area || '',
          listing_title: data.listing_title || '',
          tour_url: data.tour_url || '',
          car_description: data.car_description || data.description || '',
          fuel_type: hasCustomFuel ? 'Other' : fuelValue,
          transmission_type: data.transmission_type || '',
          seating_capacity: data.seating_capacity || '',
          horsepower: data.horsepower || '',
          engine_capacity: data.engine_capacity || '',
          steering_side: data.steering_side || '',
          color: data.color || '',
          cylinders: data.cylinders || '',
          doors: data.doors || '',
          warranty: data.warranty || '',
          service_history: data.service_history || '',
          car_location: data.car_location || data.location || '',
          latitude,
          longitude,
          vehicle_type: data.vehicle_type || 'Used',
          vin_number: data.vin_number || '',
          is_dealer: Boolean(data.is_dealer),
          ownership_status: data.ownership_status || '',
          drivetrain: data.drivetrain || '',
          fuel_efficiency: data.fuel_efficiency || '',
          torque: data.torque || '',
          interior_color: data.interior_color || '',
          seller_name: data.seller_name || '',
          whatsapp_country_code: whatsappCountryCode,
          whatsapp_number: whatsappNumber,
          whatsapp_prefill_text: data.whatsapp_prefill_text || DEFAULT_WHATSAPP_PREFILL,
          seller_email: data.seller_email || data.contact_email || '',
          contact_preference: data.contact_preference || 'phone',
          extras: Array.isArray(data.extras) ? data.extras : [],
          images: Array.isArray(data.images) ? data.images : [],
          keyless_entry: Boolean(data.keyless_entry),
          dvd_player: Boolean(data.dvd_player),
          climate_control: Boolean(data.climate_control),
          navigation_system: Boolean(data.navigation_system),
          premium_sound_system: Boolean(data.premium_sound_system),
          cooled_seats: Boolean(data.cooled_seats),
          front_wheel_drive: Boolean(data.front_wheel_drive),
          leather_seats: Boolean(data.leather_seats),
          parking_sensors: Boolean(data.parking_sensors),
          rear_view_camera: Boolean(data.rear_view_camera),
          lady_driven: Boolean(data.lady_driven),
        }));

        setOtherFuelType(parsedOtherFuelType);
        setMarker([latitude, longitude]);
        setMapPosition([latitude, longitude]);
        setTitleManuallyEdited(Boolean(data.listing_title));
        setExistingImages(Array.isArray(data.images) ? data.images : []);

        const phoneCountry = data.country_code || defaultCountryCode;
        const phoneNumberOnly = splitPhoneNumberForInput(
          data.car_owner_phone_number || data.contact_phone || '',
          phoneCountry
        ).phoneNumber;
        const whatsappMatches = Boolean(
          whatsappNumber &&
            phoneNumberOnly &&
            whatsappCountryCode === phoneCountry &&
            whatsappNumber === phoneNumberOnly
        );
        const noWhatsappYet = !whatsappNumber && Boolean(phoneNumberOnly);
        setWhatsappSameAsPhone(whatsappMatches || noWhatsappYet);
      } catch (fetchError) {
        setError(fetchError.message || 'Failed to load car listing');
      } finally {
        setIsLoadingListing(false);
      }
    };

    fetchListing();
  }, [isEdit, listingId]);

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

  const searchAddresses = useCallback(async (query) => {
    const trimmedQuery = query.trim();

    if (locationSearchAbortRef.current) {
      locationSearchAbortRef.current.abort();
    }

    if (trimmedQuery.length < 3) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
      setGeoError(null);
      return;
    }

    const controller = new AbortController();
    locationSearchAbortRef.current = controller;
    setIsGeocoding(true);
    setGeoError(null);

    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        q: trimmedQuery,
        limit: '5',
        addressdetails: '1',
        countrycodes: 'ae',
      });

      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Location search failed');
      }

      const results = await response.json();
      const nextSuggestions = Array.isArray(results) ? results : [];

      setAddressSuggestions(nextSuggestions);
      setShowSuggestions(nextSuggestions.length > 0);
    } catch (searchError) {
      if (searchError.name !== 'AbortError') {
        console.error('Location search error:', searchError);
        setAddressSuggestions([]);
        setShowSuggestions(false);
        setGeoError('Could not search that location right now. Please type a more specific address or use the map.');
      }
    } finally {
      if (locationSearchAbortRef.current === controller) {
        locationSearchAbortRef.current = null;
      }
      setIsGeocoding(false);
    }
  }, []);

  // Search for addresses as the user types.
  useEffect(() => {
    if (skipNextLocationSearchRef.current) {
      skipNextLocationSearchRef.current = false;
      return undefined;
    }

    if (locationSearchTimeoutRef.current) {
      clearTimeout(locationSearchTimeoutRef.current);
    }

    locationSearchTimeoutRef.current = window.setTimeout(() => {
      searchAddresses(formData.car_location || '');
    }, 350);

    return () => {
      if (locationSearchTimeoutRef.current) {
        clearTimeout(locationSearchTimeoutRef.current);
      }
    };
  }, [formData.car_location, searchAddresses]);

  useEffect(() => {
    return () => {
      if (locationSearchTimeoutRef.current) {
        clearTimeout(locationSearchTimeoutRef.current);
      }
      if (locationSearchAbortRef.current) {
        locationSearchAbortRef.current.abort();
      }
    };
  }, []);

  // Handle address selection from suggestions.
  const handleAddressSelect = (suggestion) => {
    if (!suggestion) {
      return;
    }

    const lat = Number.parseFloat(suggestion.lat);
    const lng = Number.parseFloat(suggestion.lon);
    const nextLabel = suggestion.display_name || formData.car_location;

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setMarker([lat, lng]);
      setMapPosition([lat, lng]);
      setFormData((prev) => ({
        ...prev,
        car_location: nextLabel,
        latitude: lat,
        longitude: lng,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        car_location: nextLabel,
      }));
    }

    skipNextLocationSearchRef.current = true;
    setShowSuggestions(false);
    setAddressSuggestions([]);
    setGeoError(null);
  };

  const reverseGeocode = useCallback(async (lat, lng) => {
    setIsGeocoding(false);
    setGeoError(null);
    setFormData((prev) => ({
      ...prev,
      car_location: prev.car_location || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      latitude: lat,
      longitude: lng,
    }));
  }, []);

  const MapSection = useMemo(() => {
    if (!mapModules) {
      return function MapLoadingState() {
        return (
          <div className="map-loading-overlay" style={{ position: 'relative', minHeight: 320 }}>
            <LoadingSpinner size="small" message="Loading map..." compact />
          </div>
        );
      };
    }

    const { MapContainer, TileLayer, Marker, useMap } = mapModules;

    const MapClickHandler = () => {
      const map = useMap();

      useEffect(() => {
        if (!map) return undefined;

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

    const MarkerWithDrag = () => (
      <Marker
        position={marker}
        draggable
        eventHandlers={{
          dragend: (e) => {
            const { lat, lng } = e.target.getLatLng();
            setMarker([lat, lng]);
            reverseGeocode(lat, lng);
          },
        }}
      />
    );

    return function MapReadyState() {
      return (
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
      );
    };
  }, [mapModules, mapPosition, marker, reverseGeocode]);

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

    if (
      registrationOcrTruth &&
      ['car_manufacturer', 'car_model', 'make_year', 'vin_number'].includes(name)
    ) {
      const lockedValue =
        name === 'car_manufacturer'
          ? registrationOcrTruth.make
          : name === 'car_model'
            ? registrationOcrTruth.model
            : name === 'make_year'
              ? registrationOcrTruth.year
              : registrationOcrTruth.vin;

      if (lockedValue) {
        const nextValue =
          name === 'vin_number'
            ? String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17)
            : String(value ?? '');
        if (String(lockedValue) !== String(nextValue)) {
          setError(
            'Registration scan is set as the source of truth for Make/Model/Year/VIN. Clear the registration scan to change these fields.'
          );
          setFormData((prev) => ({ ...prev, [name]: lockedValue }));
          return;
        }
      }
    }

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

    if (name === 'country_code') {
      setFormData((prev) => ({
        ...prev,
        country_code: value,
        whatsapp_country_code: whatsappSameAsPhone ? value : prev.whatsapp_country_code,
      }));
      return;
    }

    // Sync WhatsApp with phone when checkbox is checked
    if (whatsappSameAsPhone && (name === 'car_owner_phone_number' || name === 'country_code')) {
      const updates = {};
      if (name === 'car_owner_phone_number') {
        updates.whatsapp_number = value;
      }
      if (name === 'country_code') {
        updates.whatsapp_country_code = value;
      }
      setFormData((prev) => ({ ...prev, [name]: value, ...updates }));
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

  // Revoke cropped preview blob URLs on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      croppedImages.forEach(({ previewUrl }) => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const [isDragOver, setIsDragOver] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [moderationErrors, setModerationErrors] = useState({}); // { [filename]: errorMessage }
  const [moderating, setModerating] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    await processFiles(files);
    // Allow selecting the same file again in a later pick.
    e.target.value = '';
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleContainerClick = (e) => {
    // Only trigger file dialog if clicking on the upload area itself, not on buttons or images
    if (
      e.target.closest('.browse-btn') ||
      e.target.closest('.remove-image') ||
      e.target.closest('.preview-thumbnail') ||
      e.target.closest('.preview-item') ||
      e.target.closest('.frame-btn') ||
      e.target.closest('.drag-handle')
    ) {
      return;
    }
    fileInputRef.current?.click();
  };

  const processFiles = async (files) => {
    const nextFiles = files.filter((file) => file && file.type?.startsWith('image/'));
    if (nextFiles.length === 0) {
      setError('Please select image files only.');
      return;
    }

    const dedupedNewFiles = nextFiles.filter((file) => {
      const signature = `${file.name}-${file.size}-${file.lastModified}`;
      return !croppedImages.some(
        ({ originalFile }) =>
          originalFile &&
          `${originalFile.name}-${originalFile.size}-${originalFile.lastModified}` === signature
      );
    });

    const totalFiles = existingImages.length + croppedImages.length + dedupedNewFiles.length;
    if (totalFiles > 10) {
      setError('You can only upload up to 10 images.');
      return;
    }

    const invalidTypeFile = dedupedNewFiles.find((file) => !SUPPORTED_IMAGE_TYPES.includes((file.type || '').toLowerCase()));
    if (invalidTypeFile) {
      setError('Only JPG, PNG, WEBP, and GIF images are supported.');
      return;
    }

    const oversizedFile = dedupedNewFiles.find((file) => file.size > MAX_IMAGE_SIZE_BYTES);
    if (oversizedFile) {
      setError('Each image must be 20MB or smaller.');
      return;
    }

    setError(null);
    setModerating(true);
    setModerationErrors({});

    try {
      const results = await Promise.all(
        dedupedNewFiles.map(file => moderateImage(file).then(r => ({ file, ...r })))
      );

      const newErrors = {};
      const cleanFiles = [];
      for (const { file, blocked, reasons } of results) {
        if (blocked) {
          newErrors[file.name] = reasons.includes('nudity')
            ? 'This photo was blocked — explicit content detected. Please use photos that show the vehicle only.'
            : 'This photo was blocked — a face was detected. Please use photos that show the vehicle only to protect privacy.';
        } else {
          cleanFiles.push(file);
        }
      }

      setModerationErrors(newErrors);
      if (cleanFiles.length > 0) setPendingCropFiles(cleanFiles);
    } catch (err) {
      console.warn('Image moderation failed, allowing files:', err);
      setPendingCropFiles(dedupedNewFiles);
    } finally {
      setModerating(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.type.startsWith('image/')
    );

    if (files.length === 0) {
      setError("Please drop only image files.");
      return;
    }

    await processFiles(files);
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

    // Reorder cropped images
    setCroppedImages((prev) => {
      const next = [...prev];
      const [dragged] = next.splice(draggedIndex, 1);
      next.splice(dropIndex, 0, dragged);
      return next;
    });

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleImageDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const [draggedExistingIndex, setDraggedExistingIndex] = useState(null);
  const [dragOverExistingIndex, setDragOverExistingIndex] = useState(null);

  const handleExistingDragStart = (event, index) => {
    setDraggedExistingIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `existing:${index}`);
  };

  const handleExistingDragOver = (event, index) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverExistingIndex(index);
  };

  const handleExistingDragLeave = () => {
    setDragOverExistingIndex(null);
  };

  const handleExistingDrop = (event, dropIndex) => {
    event.preventDefault();
    event.stopPropagation();

    if (draggedExistingIndex === null || draggedExistingIndex === dropIndex) {
      setDraggedExistingIndex(null);
      setDragOverExistingIndex(null);
      return;
    }

    setExistingImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggedExistingIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });

    setDraggedExistingIndex(null);
    setDragOverExistingIndex(null);
  };

  const handleExistingDragEnd = () => {
    setDraggedExistingIndex(null);
    setDragOverExistingIndex(null);
  };

  const uploadImages = async () => {
    try {
      if (!user?.id) {
        throw new Error('User authentication required. Please log in again.');
      }

      if (croppedImages.length === 0) {
        throw new Error('No images selected for upload.');
      }

      // croppedImages already contain pre-cropped JPEG blobs; upload them directly
      // without re-applying crop math (the blob is the display variant).
      const croppedFiles = croppedImages.map(({ croppedFile }) => croppedFile);
      return await uploadListingImagesDirect(croppedFiles, {
        userId: user.id,
        cropSettings: [], // blobs are already cropped; no focal-point math needed
      });
    } catch (error) {
      console.error("Image upload error:", error);

      if (error.status === 401 || /Authentication|session/i.test(error.message || '')) {
        setError("Your session has expired. Please log in again and try submitting your listing.");
        setShowAuthModal(true);
      } else {
        setError(error.message || 'Failed to upload images. Please try again.');
      }
      return [];
    }
  };

  const toggleExtras = (e) => {
    e.preventDefault();
    setShowExtras(!showExtras);
  };

  const handleSaveDraft = async () => {
    if (!user) return;

    setIsDraftSaving(true);
    setError(null);
    setDraftNotice('Saving draft...');
    try {
      // Upload any newly selected (cropped) images before saving the draft,
      // so pictures survive across sessions and devices.
      let savedImages = [...existingImages];
      let uploadedNow = [];
      if (croppedImages.length > 0) {
        const croppedFiles = croppedImages.map(({ croppedFile }) => croppedFile);
        uploadedNow = await uploadListingImagesDirect(croppedFiles, { userId: user.id });
        savedImages = [...savedImages, ...uploadedNow];
      }

      const draftPayload = {
        formData,
        otherFuelType,
        marker,
        whatsappSameAsPhone,
        existingImages: savedImages,
        savedAt: new Date().toISOString(),
      };

      localStorage.setItem(CAR_DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));
      await apiClient.request('/api/user/drafts/car', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          draft_key: 'car',
          payload: draftPayload,
        },
      });
      if (isEdit && listingId) {
        await apiClient.post(`/api/user/listings/car/${listingId}/outcome`, {
          outcome: 'move_to_draft',
        });
      }

      // Move just-uploaded photos out of the cropped grid into existingImages
      // so a same-session submit doesn't re-upload them as duplicates.
      if (uploadedNow.length > 0) {
        croppedImages.forEach(({ previewUrl }) => {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
        });
        setCroppedImages([]);
        setExistingImages(savedImages);
      }

      setDraftNotice('Draft saved.');
    } catch (draftError) {
      setError(draftError?.message || 'Could not sync your draft right now. It was saved in this browser, but please try again before switching devices.');
    } finally {
      setIsDraftSaving(false);
      window.setTimeout(() => {
        setDraftNotice((current) => (current && current !== 'Saving draft...' ? null : current));
      }, 2500);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    setDraftNotice(null);

    const invalidField = getFirstInvalidRequiredField();
    if (invalidField) {
      setError('Please complete the highlighted fields before submitting your listing.');
      focusAndHighlightField(invalidField);
      return;
    }
    clearFieldHighlights();

    if (existingImages.length + croppedImages.length < 3) {
      setError('You must upload at least 3 images of your car.');
      focusAndHighlightField('images');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      if (registrationOcrFile) {
        setRegistrationOcrStatus('Uploading…');
        try {
          await ensureRegistrationDocumentUploaded();
        } catch (uploadErr) {
          console.warn('Registration document upload failed:', uploadErr);
          setRegistrationOcrError('Could not upload the registration document, but the listing will still be submitted.');
        }
      }

      // Prepare submission data
      const submissionData = {
        ...formData,
        extras: Array.isArray(formData.extras)
          ? formData.extras.filter((extra) => !TAG_OPTIONS.includes(extra))
          : [],
        fuel_type:
          formData.fuel_type === 'Other' ? `Other - ${otherFuelType.trim()}` : formData.fuel_type,
        whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
        latitude: marker[0],
        longitude: marker[1],
        whatsapp_number: formData.whatsapp_number
          ? `${formData.whatsapp_country_code}${formData.whatsapp_number}`
          : '',
        registration_document_url: registrationDocumentUrl || null,
      };

      const uploadedImages = croppedImages.length > 0 ? await uploadImages() : [];
      const persistedImages = existingImages
        .map((image, index) => {
          if (!image) {
            return null;
          }

          if (typeof image === 'string') {
            return {
              url: image,
              image_url: image,
              display_url: image,
              focal_x: 50,
              focal_y: 50,
              crop_meta: null,
            };
          }

          const imageUrl = image.image_url || image.url;
          if (!imageUrl) {
            return null;
          }

          return {
            url: imageUrl,
            image_url: imageUrl,
            display_url: image.display_url || imageUrl,
            focal_x: Number.isFinite(Number(image.focal_x)) ? Number(image.focal_x) : 50,
            focal_y: Number.isFinite(Number(image.focal_y)) ? Number(image.focal_y) : 50,
            crop_meta: {
              ...(image.crop_meta || {}),
              sort_index: index,
            },
          };
        })
        .filter(Boolean);

      if (persistedImages.length === 0 && croppedImages.length > 0 && uploadedImages.length === 0) {
        // uploadImages already sets a user-facing error; abort early so we don't send an empty
        // image payload that forces a backend rollback.
        focusAndHighlightField('images');
        return;
      }

      const finalImages = [...persistedImages, ...uploadedImages];

      if (isEdit) {
        const updatePayload = {
          ...submissionData,
          images: finalImages,
        };

        const updateAttempts = [
          { endpoint: `/api/cars/${listingId}`, method: 'PATCH' },
          { endpoint: `/api/cars/${listingId}`, method: 'PUT' },
          { endpoint: `/api/cars/${listingId}`, method: 'POST' },
          { endpoint: `/api/cars/${listingId}/update`, method: 'POST' },
        ];

        let lastError = null;
        for (const attempt of updateAttempts) {
          try {
            await apiClient.request(attempt.endpoint, {
              method: attempt.method,
              headers: { 'Content-Type': 'application/json' },
              body: updatePayload,
            });
            lastError = null;
            break;
          } catch (updateError) {
            lastError = updateError;
            if (updateError?.status === 404 || updateError?.status === 405) {
              continue;
            }
            throw updateError;
          }
        }
        if (lastError) {
          throw lastError;
        }
      } else {
        submissionData.images = finalImages;
        const response = await apiClient.post('/api/cars', submissionData);
        console.log('Car listing created:', response);
        localStorage.removeItem(CAR_DRAFT_STORAGE_KEY);
        try {
          await apiClient.request('/api/user/drafts/car', { method: 'DELETE' });
        } catch (clearDraftError) {
          console.warn('Failed to clear remote draft after submit:', clearDraftError);
        }
      }

      if (!isEdit) {
        trackEvent('post_listing_success', { listing_type: 'car', platform: 'web' });
      }
      setSuccess(true);
      // Redirect to my listings after 2 seconds
      setTimeout(() => {
        navigate('/my-listings');
      }, 2000);
    } catch (err) {
      setError({
        message:
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.details?.error ||
          err?.details?.message ||
          err?.message ||
          SUBMISSION_ERROR_MESSAGE,
        code: err?.code || err?.details?.code || err?.response?.data?.code || null,
        details: err?.details || err?.response?.data || null,
      });
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
          <button onClick={() => navigate('/login?redirect=/post-car')}>Log In</button>
          <button onClick={() => navigate('/signup')}>Sign Up</button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your car listing has been successfully {isEdit ? 'updated' : 'submitted and is pending approval'}.</p>
        <p>You will be redirected to your listings page shortly...</p>
      </div>
    );
  }

  if (isLoadingListing) {
    return (
      <div className="post-form-container success-message">
        <h2>Loading listing...</h2>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      <section className="post-hero-section">
        <div className="post-hero-content">
          <div className="post-hero-text">
            <span className="post-hero-kicker">Submit Your Listing</span>
            <h1 className="post-hero-title">{isEdit ? 'Edit Your Vehicle Listing' : 'List Your Vehicle'}</h1>
            <p className="post-hero-subtitle">Curate your automotive legacy. Our listing process is designed for precision.</p>
          </div>
        </div>
      </section>

      <section className="post-form-section">
        <div className="form-container">
          <ActionNoticeModal
            open={Boolean(errorNotice)}
            title={errorNotice?.code === 'listing_limit' ? 'Listing limit reached' : 'We could not save this listing'}
            message={errorNotice?.message || 'Please review the message and try again.'}
            details={errorNotice?.details}
            actions={errorActions}
            onClose={() => setError(null)}
          />
          <form onSubmit={handleSubmit} id="carDetailsForm" className="post-form" ref={formRef} noValidate>
        <div className="form-section">
          <h2>Car Images</h2>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label>Upload Images <RequiredMark /></label>
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
                {moderating && (
                  <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '4px 0 0' }}>
                    Checking images…
                  </p>
                )}
                {Object.entries(moderationErrors).map(([filename, msg]) => (
                  <p key={filename} style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
                    <strong>{filename}:</strong> {msg}
                  </p>
                ))}
                <button type="button" className="browse-btn" onClick={handleBrowseClick}>
                  Browse Files
                </button>
                <p className="upload-text-sub">Maximum 10 images • JPG, PNG, WEBP, GIF • 20MB each</p>
              </div>
              
              {croppedImages.length > 0 && (
                <div className="image-previews-grid car-framing-grid">
                  {croppedImages.map((img, index) => (
                    <div
                      className={`preview-item car-framing-preview ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
                      key={index}
                      draggable
                      role="button"
                      tabIndex={0}
                      onDragStart={(e) => handleImageDragStart(e, index)}
                      onDragOver={(e) => handleImageDragOver(e, index)}
                      onDragLeave={handleImageDragLeave}
                      onDrop={(e) => handleImageDrop(e, index)}
                      onDragEnd={handleImageDragEnd}
                    >
                      <div className="preview-order">{index + 1}</div>
                      <img
                        src={img.previewUrl}
                        alt={`Preview ${index + 1}`}
                      />
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCroppedImages((prev) => prev.filter((_, j) => j !== index));
                        }}
                      >
                        ×
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
              {existingImages.length > 0 && (
                <div className="image-previews-grid car-framing-grid">
                  {existingImages.map((image, index) => (
                    <div
                      className={`preview-item car-framing-preview ${draggedExistingIndex === index ? 'dragging' : ''} ${dragOverExistingIndex === index ? 'drag-over' : ''}`}
                      key={image.id || `${image.url}-${index}`}
                      draggable
                      role="button"
                      tabIndex={0}
                      onDragStart={(event) => handleExistingDragStart(event, index)}
                      onDragOver={(event) => handleExistingDragOver(event, index)}
                      onDragLeave={handleExistingDragLeave}
                      onDrop={(event) => handleExistingDrop(event, index)}
                      onDragEnd={handleExistingDragEnd}
                    >
                      <div className="preview-order">{index + 1}</div>
                      <img
                        src={image.display_url || image.image_url || image.url}
                        alt={`Existing ${index + 1}`}
                        style={image.cropped_at
                          ? undefined
                          : { objectPosition: `${Number.isFinite(Number(image.focal_x)) ? Number(image.focal_x) : 50}% ${Number.isFinite(Number(image.focal_y)) ? Number(image.focal_y) : 50}%` }
                        }
                      />
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          setExistingImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
                        }}
                      >
                        ×
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
              {croppedImages.length > 1 && (
                <p className="reorder-hint">Drag images to reorder. First image will be the main photo.</p>
              )}
            </div>
          </div>
        </div>
        
        <div className="form-section">
          <h2>Basic Details</h2>

          <div
            className="form-row"
            style={{
              background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(37,99,235,0.02))',
              border: '1px solid #2563eb',
              borderRadius: 12,
              padding: '16px 18px',
              marginBottom: 18,
              boxShadow: '0 1px 4px rgba(37,99,235,0.08)',
            }}
          >
            <div className="form-group full-width">
              <label htmlFor="registration_ocr_file" style={{ fontWeight: 700, fontSize: '1rem', color: '#1e3a8a' }}>
                Scan your Mulkiya — auto-fills Make, Model, Year &amp; VIN <span style={{ fontSize: '0.75em', color: '#f59e0b', fontWeight: 400 }}>(beta — still in testing)</span>
              </label>
              <div className="form-text" style={{ marginTop: 4 }}>
                Skip the manual entry. Upload a clear photo of your car registration and we'll fill in the next few fields for you.
              </div>
              <div className="form-text" style={{ marginTop: 4, color: '#92400e' }}>
                Scanned text may be inaccurate — please double-check the filled-in fields before submitting. Uploaded registration documents may be retained to improve this scanner over time (see our Privacy Policy).
              </div>
              <div
                className="upload-area"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    document.getElementById('registration_ocr_file')?.click();
                  }
                }}
                onClick={() => document.getElementById('registration_ocr_file')?.click()}
                style={{ marginTop: 10 }}
              >
                <div className="upload-icon" aria-hidden="true" />
                <h4>{registrationOcrFile ? registrationOcrFile.name : 'Upload registration document'}</h4>
                <p>PNG, JPG, WEBP, or PDF (page 1)</p>
                <input
                  id="registration_ocr_file"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  className="file-input"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setRegistrationOcrFile(file);
                    resetRegistrationOcrState();
                  }}
                />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="browse-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      document.getElementById('registration_ocr_file')?.click();
                    }}
                  >
                    Browse
                  </button>
                  <button
                    type="button"
                    className="browse-btn"
                    disabled={!registrationOcrFile || registrationOcrStatus === 'Scanning…' || registrationOcrStatus === 'Preparing…'}
                    onClick={(e) => {
                      e.stopPropagation();
                      runRegistrationOcr();
                    }}
                  >
                    {registrationOcrStatus === 'Preparing…'
                      ? 'Preparing…'
                      : registrationOcrStatus === 'Scanning…'
                        ? `Scanning… ${registrationOcrProgress}%`
                        : 'Scan'}
                  </button>
                  {registrationOcrFile && (
                    <button
                      type="button"
                      className="browse-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRegistrationOcrFile(null);
                        resetRegistrationOcrState();
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              {(uploadingRegistrationDoc || registrationDocumentUrl) && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'rgba(37, 99, 235, 0.06)',
                    border: '1px solid rgba(37, 99, 235, 0.16)',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#1e3a8a', marginBottom: 4 }}>
                    {uploadingRegistrationDoc ? 'Uploading registration copy…' : 'Uploaded registration copy'}
                  </div>
                  {registrationDocumentUrl ? (
                    <a
                      href={registrationDocumentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#2563eb', fontWeight: 600, wordBreak: 'break-word' }}
                    >
                      Open uploaded document
                    </a>
                  ) : (
                    <div className="form-text" style={{ margin: 0 }}>
                      Your registration file is being saved and will be attached to this listing.
                    </div>
                  )}
                  {registrationOcrFile?.name && (
                    <div className="form-text" style={{ marginTop: 4, marginBottom: 0 }}>
                      File: {registrationOcrFile.name}
                    </div>
                  )}
                </div>
              )}
              {registrationOcrError && (
                <div className="alert alert-danger mt-3" role="alert">
                  {registrationOcrError}
                </div>
              )}
              {registrationOcrSuggestions && (
                <div className="alert alert-success mt-3" role="status">
                  <div style={{ fontWeight: 700, marginBottom: '6px' }}>Detected</div>
                  <div>
                    Make: {registrationOcrSuggestions.fields?.make || registrationOcrSuggestions.make || '—'} {registrationOcrSuggestions.verifiedMake ? '(verified)' : '(review)'}
                  </div>
                  <div>
                    Model: {registrationOcrSuggestions.fields?.model || registrationOcrSuggestions.model || '—'} {registrationOcrSuggestions.verifiedModel ? '(verified)' : '(review)'}
                  </div>
                  <div>
                    Year: {registrationOcrSuggestions.fields?.year || registrationOcrSuggestions.year || '—'} {registrationOcrSuggestions.verifiedYear ? '(verified)' : '(review)'}
                  </div>
                  <div>
                    VIN: {registrationOcrSuggestions.fields?.vin || registrationOcrSuggestions.vin || '—'} {registrationOcrSuggestions.verifiedVin ? '(verified)' : '(review)'}
                  </div>
                  <div>
                    Confidence: {Math.round(((registrationOcrSuggestions.confidence?.overall || 0) * 100))}%
                  </div>
                  <div>
                    VIN validation: {registrationOcrSuggestions.vinValidation?.valid ? 'Valid' : 'Needs review'}
                  </div>
                  {registrationOcrSuggestions.reviewReasons?.length > 0 && (
                    <div style={{ marginTop: '8px', opacity: 0.85 }}>
                      Review reasons: {registrationOcrSuggestions.reviewReasons.join(', ')}
                    </div>
                  )}
                  {registrationOcrDebugInfo && (
                    <div style={{ marginTop: '8px', opacity: 0.75, fontSize: 12 }}>
                      Best pass: {registrationOcrDebugInfo.source}/{registrationOcrDebugInfo.pass}
                    </div>
                  )}
                  <div style={{ marginTop: '8px', opacity: 0.9 }}>
                    {registrationOcrSuggestions.shouldAutoFill
                      ? 'Verified fields are auto-filled and locked. Use Clear if you need to change them manually.'
                      : 'Scan needs review, so fields stay editable until you confirm them manually.'}
                  </div>
                  {registrationOcrPreparedImage?.source === 'pdf' && (
                    <div style={{ marginTop: '8px', opacity: 0.85 }}>
                      PDF note: scanned from page 1 only.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="car_city">Emirate <RequiredMark /></label>
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
              <label htmlFor="area">Area <RequiredMark /></label>
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
	              <label htmlFor="car_manufacturer">Make <RequiredMark /></label>
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
              <label htmlFor="car_model">Model <RequiredMark /></label>
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
              <small className="form-hint">
                Can&apos;t find the model?{' '}
                <Link
                  to={`/request-car-model?make=${encodeURIComponent(formData.car_manufacturer || '')}&source=post-car`}
                  className="inline-help-link"
                >
                  Request it here
                </Link>
              </small>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="trim">Trim <RequiredMark /></label>
              {getAvailableTrims().length > 0 ? (
                <SearchableSelect
                  id="trim"
                  name="trim"
                  value={formData.trim}
                  onChange={handleChange}
                  required
                  className="form-control form-select"
                >
                  <option value="">Select Trim</option>
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
                  required
                  className="form-control"
                  placeholder="Enter trim"
                />
              )}
            </div>
            
            <div className="form-group">
              <label htmlFor="regional_spec">Regional Spec <RequiredMark /></label>
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
              <label htmlFor="make_year">Year <RequiredMark /></label>
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
              <label htmlFor="kilometer_driven">Mileage (km) <RequiredMark /></label>
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
              <label htmlFor="body_type">Body Type <RequiredMark /></label>
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
              <label htmlFor="vehicle_type">Condition <RequiredMark /></label>
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
              <label htmlFor="expected_selling_price">Price (AED) <RequiredMark /></label>
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
              <label htmlFor="car_owner_phone_number">Phone Number <RequiredMark /></label>
              <div className="phone-input-group">
                <select
                  id="country_code"
                  name="country_code"
                  className="country-code-select"
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
                  id="car_owner_phone_number"
                  name="car_owner_phone_number"
                  value={formData.car_owner_phone_number}
                  onChange={handleChange}
                  required
                  placeholder="Phone number"
                  inputMode="numeric"
                  autoComplete="tel-national"
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
            <div className="form-group full-width">
              <label htmlFor="listing_title">Listing Title <RequiredMark /></label>
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
              {(() => {
                const suggested = formData.car_manufacturer && formData.car_model && formData.make_year
                  ? `${formData.make_year} ${formData.car_manufacturer} ${formData.car_model}${formData.trim ? ` ${formData.trim}` : ''}`
                  : '';
                if (!titleManuallyEdited || !suggested || suggested === formData.listing_title) {
                  return null;
                }
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setTitleManuallyEdited(false);
                      setFormData((prev) => ({ ...prev, listing_title: suggested }));
                    }}
                    style={{
                      marginTop: 6,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#2563eb',
                      fontSize: '0.85em',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    ↻ Regenerate from car details ({suggested})
                  </button>
                );
              })()}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="car_description">Listing Description <RequiredMark /></label>
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
              <label htmlFor="fuel_type">Fuel Type <RequiredMark /></label>
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
                <label htmlFor="other_fuel_type">Specify Fuel Type <RequiredMark /></label>
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
              <label htmlFor="transmission_type">Transmission Type <RequiredMark /></label>
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
              <label htmlFor="horsepower">Horsepower <span className="text-muted">(Optional)</span></label>
              <SearchableSelect
                id="horsepower"
                name="horsepower"
                value={formData.horsepower}
                onChange={handleChange}
                className="form-control form-select"
              >
                <option value="">Select Horsepower</option>
                {horsepowerRanges.map(range => (
                  <option key={range} value={range}>{range}</option>
                ))}
              </SearchableSelect>
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
              <label htmlFor="steering_side">Steering Side <RequiredMark /></label>
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
              <label htmlFor="fuel_efficiency">Fuel Efficiency (km/l)</label>
              <SearchableSelect
                id="fuel_efficiency"
                name="fuel_efficiency"
                value={formData.fuel_efficiency}
                onChange={handleChange}
                className="form-control form-select"
              >
                <option value="">Select efficiency</option>
                {FUEL_EFFICIENCY_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt} km/l</option>
                ))}
              </SearchableSelect>
            </div>
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="color">Exterior Color <RequiredMark /></label>
              <SearchableSelect
                id="color"
                name="color"
                value={formData.color}
                onChange={handleChange}
                required
                className="form-control form-select"
              >
                <option value="">Select color</option>
                {EXTERIOR_COLOR_OPTIONS.map(color => (
                  <option key={color} value={color}>{color}</option>
                ))}
              </SearchableSelect>
            </div>
            <div className="form-group">
              <label htmlFor="interior_color">Interior Color</label>
              <SearchableSelect
                id="interior_color"
                name="interior_color"
                value={formData.interior_color}
                onChange={handleChange}
                className="form-control form-select"
              >
                <option value="">Select color</option>
                {INTERIOR_COLOR_OPTIONS.map(color => (
                  <option key={color} value={color}>{color}</option>
                ))}
              </SearchableSelect>
            </div>
            <div className="form-group">
              <label htmlFor="cylinders">Cylinders <RequiredMark /></label>
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
              <label htmlFor="doors">Doors <RequiredMark /></label>
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
              <label htmlFor="warranty">Warranty <RequiredMark /></label>
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
              <label htmlFor="service_history">Service History <RequiredMark /></label>
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
                    borderBottom: '1px dotted #8a8a8a'
                  }}
                >
                  VIN <RequiredMark />
                </span> <span className="text-muted">(Vehicle Identification Number)</span>
              </label>
              <input
                type="text"
                id="vin_number"
                name="vin_number"
                value={formData.vin_number}
                onChange={(e) => {
                  const upperValue = normalizeVin(e.target.value).slice(0, 17);
                  handleChange({ target: { name: 'vin_number', value: upperValue } });
                }}
                placeholder="e.g. 1HGCM82633A123456"
                className={`form-control${formData.vin_number.length === 17 && !isVinValid(formData.vin_number) ? ' is-invalid' : formData.vin_number.length === 17 && isVinValid(formData.vin_number) ? ' is-valid' : ''}`}
                style={{ textTransform: 'uppercase' }}
                maxLength="17"
                required
              />
              {formData.vin_number.length === 17 && !isVinValid(formData.vin_number) && (
                <small style={{ color: '#dc3545', display: 'block', marginTop: '0.25rem' }}>
                  This VIN appears invalid. You can still post your listing.
                </small>
              )}
              {formData.vin_number.length === 17 && isVinValid(formData.vin_number) && (
                <small style={{ color: '#198754', display: 'block', marginTop: '0.25rem' }}>VIN verified ✓</small>
              )}
              {formData.vin_number.length > 0 && formData.vin_number.length < 17 && (
                <div className="form-text text-muted">{17 - formData.vin_number.length} characters remaining</div>
              )}
              {!(formData.vin_number.length > 0) && (
                <div className="form-text">
                  <strong>VIN helps your listing stand out:</strong> verified VIN details increase buyer trust and improve listing quality. <span className="vin-help-text"><strong>Where to find it:</strong> check your registration, insurance documents, driver's side dashboard (visible through windshield), driver's side door jamb, or under the hood.</span>
                </div>
              )}
            </div>
          </div>
          
          <div className="form-subsection-title">Extra Features</div>
          <p className="form-subsection-desc">Pick all options that apply. Chips stay aligned for quick scanning.</p>

          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="extras">Extra Features</label>
              <button type="button" className="text-danger extras-toggle" onClick={toggleExtras}>
                {showExtras ? 'Hide features ▲' : 'Add features (optional) ▼'}
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
	                disabled={useUsernameAsSellerName && Boolean(String(user?.username || '').trim())}
	              />
	              <label className="checkbox-label" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
	                <input
	                  type="checkbox"
	                  checked={useUsernameAsSellerName}
	                  disabled={!String(user?.username || '').trim()}
	                  onChange={(e) => {
	                    const nextChecked = e.target.checked;
	                    setUseUsernameAsSellerName(nextChecked);
	                    if (nextChecked) {
	                      const username = String(user?.username || '').trim();
	                      if (username) {
	                        setFormData((prev) => ({ ...prev, seller_name: username }));
	                      }
	                    }
	                  }}
	                  style={{ width: 16, height: 16 }}
	                />
	                Use my username as seller name
	              </label>
	              {!String(user?.username || '').trim() && (
	                <div className="form-text" style={{ color: '#fecaca' }}>
	                  You don’t have a username yet. Set one in <a href="/settings">Account Settings</a> to use it on your listings.
	                </div>
	              )}
	            </div>
            <div className="form-group">
              <label htmlFor="whatsapp_number">WhatsApp Number <RequiredMark /></label>
              <div className="phone-input-group">
                <select
                  id="whatsapp_country_code"
                  name="whatsapp_country_code"
                  className="country-code-select"
                  value={formData.whatsapp_country_code}
                  onChange={handleChange}
                  disabled={whatsappSameAsPhone}
                  aria-label="WhatsApp country code"
                >
                  {countryCodes.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.code}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  id="whatsapp_number"
                  name="whatsapp_number"
                  value={formData.whatsapp_number}
                  onChange={handleChange}
                  required
                  placeholder="501234567"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  className="form-control phone-number-input"
                  disabled={whatsappSameAsPhone}
                />
              </div>
              <label className="checkbox-label" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                <input
                  type="checkbox"
                  checked={whatsappSameAsPhone}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setWhatsappSameAsPhone(checked);
                    if (checked) {
                      setFormData((prev) => ({
                        ...prev,
                        whatsapp_country_code: prev.country_code,
                        whatsapp_number: prev.car_owner_phone_number,
                      }));
                    }
                  }}
                  style={{ width: 14, height: 14 }}
                />
                Same as phone number
              </label>
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
          </div>
          
          <div className="form-row">
            <div className="form-group full-width">
              <label htmlFor="car_location">Locate your car <RequiredMark /></label>
              
              <div className="location-search-container">
                <div className="search-input-wrapper">
                  <input
                    type="text"
                    id="car_location"
                    name="car_location"
                    value={formData.car_location}
                    onChange={handleChange}
                    onFocus={() => {
                      if (formData.car_location.trim() && addressSuggestions.length > 0) {
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
                {mapModulesError ? (
                  <div className="map-error-message" style={{ padding: 16 }}>
                    Map unavailable right now. You can still enter coordinates manually.
                  </div>
                ) : (
                  <MapSection />
                )}
              </div>
            </div>
          </div>
        </div>
        
        <div className="form-actions-section">
          {isSubmitting ? (
            <div className="submit-loading-state" aria-live="polite" aria-atomic="true">
              <div className="submit-loading-text">Submitting...</div>
              <div className="submit-loading-bar" role="progressbar" aria-valuetext="Submitting your listing">
                <span className="submit-loading-bar-fill" />
              </div>
            </div>
          ) : null}
          {draftNotice ? <div className="draft-success-message">{draftNotice}</div> : null}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isSubmitting || isDraftSaving}
            onClick={handleSaveDraft}
          >
            {isDraftSaving ? 'Saving Draft...' : 'Save Draft'}
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={isSubmitting}
          >
            {isSubmitting ? (isEdit ? 'Updating...' : 'Submitting...') : (isEdit ? 'Update Listing' : 'Submit Listing')}
          </button>
          <p>Save a draft anytime and come back later. Submit when everything looks right.</p>
        </div>
        </form>
        </div>
      </section>

      {pendingCropFiles && (
        <UnifiedCropper
          kind="car"
          images={pendingCropFiles}
          isOpen
          onClose={() => setPendingCropFiles(null)}
          onComplete={(results) => {
            setCroppedImages((prev) => [...prev, ...results]);
            setPendingCropFiles(null);
          }}
        />
      )}
    </div>
  );
};

export default PostCar; 
