import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
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
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import ImageFramingModal from './ImageFramingModal';
import { getWhatsappPrefillTemplate } from '../utils/whatsapp';
import ActionNoticeModal from './ui/ActionNoticeModal';
import { buildDealerHelpMailto, buildErrorNotice } from '../utils/errorNotice';
import { LISTING_IMAGE_MAX_BYTES, uploadListingImagesDirect, uploadRegistrationDocument } from '../utils/directUpload';
import { normalizeRegistrationScanResponse } from '../utils/registrationScan';
// Fix Leaflet default icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

// pdfjs-dist 4.x no longer honors `disableWorker: true` on getDocument —
// it always reads GlobalWorkerOptions.workerSrc and throws if unset. Pin
// the worker to a version-matched CDN copy so PDF rendering works for the
// local OCR fallback path. Set once at module load.
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`;
}

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = LISTING_IMAGE_MAX_BYTES;
const DEFAULT_IMAGE_CROP = { focalX: 50, focalY: 50, zoom: 1 };
const MAX_DESCRIPTION_WORDS = 300;
const DEFAULT_MAP_POSITION = [25.276987, 55.296249];
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
  const [showExtras, setShowExtras] = useState(true);
  const [otherFuelType, setOtherFuelType] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewImages, setPreviewImages] = useState([]);
  const [existingImages, setExistingImages] = useState([]);
  const [imageCropSettings, setImageCropSettings] = useState([]);
  const [showFramingModal, setShowFramingModal] = useState(false);
  const [activeFramingIndex, setActiveFramingIndex] = useState(0);
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
  const [useUsernameAsSellerName, setUseUsernameAsSellerName] = useState(false);
  const locationSearchTimeoutRef = useRef(null);
  const locationSearchAbortRef = useRef(null);
  const skipNextLocationSearchRef = useRef(false);
  
  // Enhanced map features state
  const [addressSuggestions, setAddressSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(false);

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

  const normalizeOcrToken = useCallback((value) => {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '');
  }, []);

  const resetRegistrationOcrState = useCallback(() => {
    setRegistrationOcrError(null);
    setRegistrationOcrStatus(null);
    setRegistrationOcrProgress(0);
    setRegistrationOcrSuggestions(null);
    setRegistrationOcrPreparedImage(null);
    setRegistrationOcrTruth(null);
    setRegistrationOcrDebugInfo(null);
  }, []);

  const applyRegistrationScanResult = useCallback((scan, { status = 'Done', debugInfo = null } = {}) => {
    setRegistrationOcrSuggestions(scan);
    setRegistrationOcrDebugInfo(debugInfo);
    setRegistrationOcrStatus(status);
    setRegistrationOcrTruth(
      scan.shouldAutoFill
        ? {
            make: scan.fields.make || null,
            model: scan.fields.model || null,
            year: scan.fields.year || null,
            vin: scan.fields.vin || null,
          }
        : null
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

  const levenshteinDistance = useCallback((aRaw, bRaw) => {
    const a = String(aRaw || '');
    const b = String(bRaw || '');
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;

    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[a.length][b.length];
  }, []);

  const similarityScore = useCallback(
    (aRaw, bRaw) => {
      const a = normalizeOcrToken(aRaw);
      const b = normalizeOcrToken(bRaw);
      if (!a || !b) return 0;
      if (a === b) return 1;
      const distance = levenshteinDistance(a, b);
      const maxLen = Math.max(a.length, b.length);
      return maxLen ? Math.max(0, 1 - distance / maxLen) : 0;
    },
    [levenshteinDistance, normalizeOcrToken]
  );

  const computeVinCheckDigit = useCallback((vinRaw) => {
    const vin = String(vinRaw || '').toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;
    const map = {
      A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
      J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
      S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
      0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
    };
    const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 17; i += 1) {
      const ch = vin[i];
      const value = map[ch];
      if (typeof value !== 'number') return null;
      sum += value * weights[i];
    }
    const remainder = sum % 11;
    return remainder === 10 ? 'X' : String(remainder);
  }, []);

  const isVinValid = useCallback(
    (vinRaw) => {
      const vin = String(vinRaw || '').toUpperCase();
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
      const expected = computeVinCheckDigit(vin);
      if (!expected) return false;
      return vin[8] === expected;
    },
    [computeVinCheckDigit]
  );

  const tryFixVinOcr = useCallback(
    (vinRaw) => {
      const vin = String(vinRaw || '').toUpperCase();
      if (!/^[A-Z0-9]{17}$/.test(vin)) return null;
      const candidates = new Set([
        vin,
        vin.replace(/O/g, '0'),
        vin.replace(/I/g, '1'),
        vin.replace(/Q/g, '0'),
        vin.replace(/S/g, '5'),
        vin.replace(/Z/g, '2'),
        vin.replace(/B/g, '8'),
      ]);
      for (const candidate of candidates) {
        if (isVinValid(candidate)) return candidate;
      }
      return null;
    },
    [isVinValid]
  );

  const preprocessImageToPngFile = useCallback(async (blobOrFile, { threshold = 180, contrast = 1.25 } = {}) => {
    const blob = blobOrFile instanceof Blob ? blobOrFile : null;
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // grayscale + contrast + threshold
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;
      gray = (gray - 128) * contrast + 128;
      const out = gray >= threshold ? 255 : 0;
      data[i] = out;
      data[i + 1] = out;
      data[i + 2] = out;
    }
    ctx.putImageData(imageData, 0, 0);

    const outBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Failed to preprocess image'))), 'image/png', 1);
    });
    return new File([outBlob], 'registration-preprocessed.png', { type: 'image/png' });
  }, []);

  const renderPdfPageToPngFile = useCallback(async ({ file, pageNumber = 1, scale = 3 } = {}) => {
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas context not available');
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({ canvasContext: context, viewport }).promise;

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error('Failed to render PDF'))), 'image/png', 1);
    });

    return new File([blob], `registration-page-${pageNumber}.png`, { type: 'image/png' });
  }, []);

  const prepareRegistrationOcrInput = useCallback(async (file) => {
    if (!file) {
      return null;
    }

    const fileType = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    const isPdf =
      fileType === 'application/pdf' || name.endsWith('.pdf');

    if (!isPdf) {
      // For images, run multiple preprocess passes (and original) to reduce OCR mismatch.
      const passes = [
        { image: file, pass: 'original' },
        { image: await preprocessImageToPngFile(file, { threshold: 170, contrast: 1.2 }), pass: 'prep170' },
        { image: await preprocessImageToPngFile(file, { threshold: 190, contrast: 1.3 }), pass: 'prep190' },
      ].filter((entry) => entry.image);
      return {
        attempts: passes.map((entry) => ({ ...entry, source: 'image' })),
        backendFile: file,
      };
    }

    // PDFs: render page 1 at two scales, then preprocess each render.
    const rendered3 = await renderPdfPageToPngFile({ file, pageNumber: 1, scale: 3 });
    const rendered4 = await renderPdfPageToPngFile({ file, pageNumber: 1, scale: 4 });
    const passes = [
      { image: rendered3, pass: 'pdf-scale3' },
      { image: await preprocessImageToPngFile(rendered3, { threshold: 175, contrast: 1.25 }), pass: 'pdf-scale3-prep' },
      { image: rendered4, pass: 'pdf-scale4' },
      { image: await preprocessImageToPngFile(rendered4, { threshold: 175, contrast: 1.25 }), pass: 'pdf-scale4-prep' },
    ].filter((entry) => entry.image);
    return {
      attempts: passes.map((entry) => ({ ...entry, source: 'pdf' })),
      backendFile: rendered4 || rendered3,
    };
  }, [preprocessImageToPngFile, renderPdfPageToPngFile]);

  const parseRegistrationOcr = useCallback(
    (text, { words = [] } = {}) => {
      const rawText = String(text || '');
      const normalizedText = normalizeOcrToken(rawText);
      const maxYear = new Date().getFullYear() + 1;
      const minYear = 1980;

      const yearPatterns = [
        /(MODEL\s*YEAR|YEAR)\s*[:-]?\s*(\d{4})/i,
        /\b(19\d{2}|20\d{2})\b/,
      ];

      let detectedYear = null;
      for (const pattern of yearPatterns) {
        const match = rawText.match(pattern);
        if (match) {
          const candidate = parseInt(match[2] || match[1], 10);
          if (!Number.isNaN(candidate) && candidate >= minYear && candidate <= maxYear) {
            detectedYear = candidate;
            break;
          }
        }
      }

      if (!detectedYear) {
        const yearMatches = rawText.match(/\b(19\d{2}|20\d{2})\b/g) || [];
        const candidates = yearMatches
          .map((y) => parseInt(y, 10))
          .filter((y) => y >= minYear && y <= maxYear);
        if (candidates.length) {
          detectedYear = candidates.sort((a, b) => b - a)[0];
        }
      }

      let detectedMake = null;
      let detectedMakeScore = 0;
      for (const make of carMakes) {
        const needle = normalizeOcrToken(make);
        if (!needle) continue;
        if (normalizedText.includes(needle) && needle.length > detectedMakeScore) {
          detectedMake = make;
          detectedMakeScore = needle.length;
        }
      }

      if (!detectedMake) {
        let bestMake = null;
        let bestScore = 0;
        for (const make of carMakes) {
          const score = similarityScore(make, rawText);
          if (score > bestScore) {
            bestScore = score;
            bestMake = make;
          }
        }
        if (bestScore >= 0.92) {
          detectedMake = bestMake;
          detectedMakeScore = Math.round(bestScore * 100);
        }
      }

      let detectedModel = null;
      let detectedModelScore = 0;
      const modelCandidates = detectedMake ? (carModels[detectedMake] || []) : [];
      for (const model of modelCandidates) {
        const needle = normalizeOcrToken(model);
        if (!needle) continue;
        if (normalizedText.includes(needle) && needle.length > detectedModelScore) {
          detectedModel = model;
          detectedModelScore = needle.length;
        }
      }

      if (!detectedModel && modelCandidates.length) {
        let bestModel = null;
        let bestScore = 0;
        for (const model of modelCandidates) {
          const score = similarityScore(model, rawText);
          if (score > bestScore) {
            bestScore = score;
            bestModel = model;
          }
        }
        if (bestScore >= 0.9) {
          detectedModel = bestModel;
          detectedModelScore = Math.round(bestScore * 100);
        }
      }

      const verifiedYear = detectedYear ? yearOptions.includes(String(detectedYear)) || yearOptions.includes(detectedYear) : false;
      const verifiedMake = Boolean(detectedMake && carMakes.includes(detectedMake));
      const verifiedModel = Boolean(detectedMake && detectedModel && modelCandidates.includes(detectedModel));

      let detectedVin = null;
      const vinMatch = normalizedText.match(/[A-HJ-NPR-Z0-9]{17}/);
      if (vinMatch?.[0]) {
        detectedVin = vinMatch[0];
      } else {
        const rawVinMatch = rawText.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/[A-HJ-NPR-Z0-9]{17}/);
        if (rawVinMatch?.[0]) {
          detectedVin = rawVinMatch[0];
        }
      }
      const fixedVin = detectedVin ? tryFixVinOcr(detectedVin) : null;
      if (fixedVin) {
        detectedVin = fixedVin;
      }
      const verifiedVin = Boolean(detectedVin && isVinValid(detectedVin));

      const wordConfidence = Array.isArray(words) && words.length
        ? Math.round(
            words
              .map((w) => Number(w?.confidence))
              .filter((n) => Number.isFinite(n))
              .reduce((a, b) => a + b, 0) / words.length
          )
        : null;

      const confidence = {
        make: verifiedMake ? 0.98 : detectedMake ? 0.7 : 0,
        model: verifiedModel ? 0.98 : detectedModel ? 0.65 : 0,
        year: verifiedYear ? 0.98 : detectedYear ? 0.6 : 0,
        vin: verifiedVin ? 0.99 : detectedVin ? 0.5 : 0,
        ocr: wordConfidence ? Math.max(0, Math.min(1, wordConfidence / 100)) : null,
      };

      return {
        make: detectedMake,
        model: detectedModel,
        year: detectedYear ? String(detectedYear) : null,
        vin: detectedVin,
        verifiedMake,
        verifiedModel,
        verifiedYear,
        verifiedVin,
        confidence,
      };
    },
    [isVinValid, normalizeOcrToken, similarityScore, tryFixVinOcr, yearOptions]
  );

  const runRegistrationOcr = useCallback(async () => {
    if (!registrationOcrFile) {
      setRegistrationOcrError('Please choose a clear photo of your car registration first.');
      return;
    }

    resetRegistrationOcrState();
    setRegistrationOcrStatus('Preparing…');

    // Upload the registration document to storage in parallel with OCR
    if (registrationOcrFile && user?.id) {
      setUploadingRegistrationDoc(true);
      uploadRegistrationDocument(registrationOcrFile, { userId: user.id })
        .then((url) => {
          setRegistrationDocumentUrl(url);
          setUploadingRegistrationDoc(false);
        })
        .catch((err) => {
          console.warn('Failed to upload registration document:', err);
          setUploadingRegistrationDoc(false);
        });
    }

    try {
      // STEP 1: Try the backend with the ORIGINAL file. The backend accepts
      // both images and PDFs natively, so we don't need to render PDFs locally
      // just to talk to it. This means a local PDF-render failure (e.g. pdfjs
      // worker issues) can no longer block the backend OCR path.
      let backendSucceeded = false;
      try {
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
        backendSucceeded = true;

        if (backendScan.shouldAutoFill) {
          return;
        }
      } catch (backendError) {
        console.warn('Backend registration scan unavailable, falling back to local OCR:', backendError);
      }

      // STEP 2: Local OCR fallback. Only prepare (render PDF, preprocess images)
      // if we still need it. If preparation fails and the backend already gave
      // us something, surface that result rather than throwing.
      setRegistrationOcrStatus('Preparing…');
      let prepared = null;
      try {
        prepared = await prepareRegistrationOcrInput(registrationOcrFile);
      } catch (prepError) {
        console.warn('Local OCR preparation failed:', prepError);
        if (backendSucceeded) {
          return;
        }
        throw prepError;
      }

      const attempts = prepared?.attempts || [];
      if (!attempts.length) {
        if (backendSucceeded) {
          return;
        }
        throw new Error('No OCR input prepared');
      }

      let best = null;
      let bestScore = -1;
      let bestAttempt = null;

      for (let idx = 0; idx < attempts.length; idx += 1) {
        const attempt = attempts[idx];
        if (!attempt?.image) continue;
        setRegistrationOcrPreparedImage(attempt);
        setRegistrationOcrStatus(`Scanning… (${idx + 1}/${attempts.length})`);
        setRegistrationOcrProgress(0);

        const result = await Tesseract.recognize(attempt.image, 'eng', {
          logger: (m) => {
            if (m?.status === 'recognizing text' && typeof m.progress === 'number') {
              setRegistrationOcrProgress(Math.round(m.progress * 100));
            }
          },
        });

        const parsed = parseRegistrationOcr(result?.data?.text || '', { words: result?.data?.words || [] });
        const score =
          (parsed.verifiedVin ? 3 : 0) +
          (parsed.verifiedMake ? 2 : 0) +
          (parsed.verifiedModel ? 2 : 0) +
          (parsed.verifiedYear ? 2 : 0) +
          (parsed.confidence?.ocr ? parsed.confidence.ocr : 0);

        if (score > bestScore) {
          best = parsed;
          bestScore = score;
          bestAttempt = attempt;
        }

        if (parsed.verifiedVin && parsed.verifiedMake && parsed.verifiedYear) {
          break;
        }
      }

      if (!best) {
        if (backendSucceeded) {
          return;
        }
        throw new Error('OCR failed to produce results');
      }

      const fallbackScan = normalizeRegistrationScanResponse({
        fields: {
          make: best.make,
          model: best.model,
          year: best.year,
          vin: best.vin,
        },
        confidence: {
          ...best.confidence,
          overall: Math.max(
            best.confidence?.ocr || 0,
            best.verifiedVin && best.verifiedMake && best.verifiedYear ? 0.95 : 0.6
          ),
        },
        vin_validation: {
          valid: best.verifiedVin,
          decoded: {
            make: best.make,
            model: best.model,
            model_year: best.year,
          },
        },
        needs_review: !(best.verifiedVin && best.verifiedMake && best.verifiedYear),
        review_reasons: best.verifiedVin && best.verifiedMake && best.verifiedYear
          ? []
          : ['local_fallback_review'],
        raw_text: '',
        document_type: 'mulkiya',
      });

      applyRegistrationScanResult(
        fallbackScan,
        { debugInfo: bestAttempt ? { source: bestAttempt.source, pass: bestAttempt.pass } : null }
      );
    } catch (err) {
      console.error('Registration OCR failed:', err);
      setRegistrationOcrStatus(null);
      setRegistrationOcrError('OCR failed. Please try a clearer photo (good lighting, minimal glare).');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRegistrationScanResult, isEdit, listingId, parseRegistrationOcr, prepareRegistrationOcrInput, registrationOcrFile, resetRegistrationOcrState]);

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
    if (Array.isArray(draft.imageCropSettings)) {
      setImageCropSettings(draft.imageCropSettings);
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
          featured_listing: Boolean(data.featured_listing),
          ownership_status: data.ownership_status || '',
          drivetrain: data.drivetrain || '',
          fuel_efficiency: data.fuel_efficiency || '',
          top_speed: data.top_speed || '',
          zero_to_hundred: data.zero_to_hundred || '',
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

	  const existingCount = Array.isArray(existingImages) ? existingImages.length : 0;
	  const framingImages = useMemo(() => {
	    const existing = (existingImages || []).map((image, index) => ({
	      name: `Existing ${index + 1}`,
	      previewUrl: image?.display_url || image?.image_url || image?.url || '',
	    }));
	    const fresh = (previewImages || []).map((previewUrl, index) => ({
	      name: `New ${index + 1}`,
	      previewUrl,
	    }));
	    return [...existing, ...fresh].filter((entry) => entry.previewUrl);
	  }, [existingImages, previewImages]);

	  const framingCropSettings = useMemo(() => {
	    const existing = (existingImages || []).map((image) => {
	      const zoom =
	        typeof image?.crop_meta?.zoom === 'number'
	          ? image.crop_meta.zoom
	          : 1;
	      return {
	        focalX: Number.isFinite(Number(image?.focal_x)) ? Number(image.focal_x) : 50,
	        focalY: Number.isFinite(Number(image?.focal_y)) ? Number(image.focal_y) : 50,
	        zoom: Number.isFinite(Number(zoom)) ? Number(zoom) : 1,
	      };
	    });
	    const fresh = (imageCropSettings || []).map((setting) => ({
	      focalX: Number.isFinite(Number(setting?.focalX)) ? Number(setting.focalX) : 50,
	      focalY: Number.isFinite(Number(setting?.focalY)) ? Number(setting.focalY) : 50,
	      zoom: Number.isFinite(Number(setting?.zoom)) ? Number(setting.zoom) : 1,
	    }));
	    return [...existing, ...fresh];
	  }, [existingImages, imageCropSettings]);

	  const updateFramingCropSetting = (index, partialUpdate) => {
	    if (index < existingCount) {
	      setExistingImages((prev) =>
	        prev.map((image, currentIndex) => {
	          if (currentIndex !== index) return image;
	          const focalX = partialUpdate.focalX ?? partialUpdate.focal_x;
	          const focalY = partialUpdate.focalY ?? partialUpdate.focal_y;
	          const zoom = partialUpdate.zoom;
	          return {
	            ...image,
	            focal_x: Number.isFinite(Number(focalX)) ? Number(focalX) : image.focal_x,
	            focal_y: Number.isFinite(Number(focalY)) ? Number(focalY) : image.focal_y,
	            crop_meta: {
	              ...(image.crop_meta || {}),
	              ...(Number.isFinite(Number(zoom)) ? { zoom: Number(zoom) } : {}),
	            },
	          };
	        })
	      );
	      return;
	    }

	    updateImageCropSetting(index - existingCount, partialUpdate);
	  };

	  const applyFramingToAll = (sourceIndex) => {
	    const source = framingCropSettings[sourceIndex] || DEFAULT_IMAGE_CROP;
	    setExistingImages((prev) =>
	      prev.map((image) => ({
	        ...image,
	        focal_x: Number.isFinite(Number(source.focalX)) ? Number(source.focalX) : 50,
	        focal_y: Number.isFinite(Number(source.focalY)) ? Number(source.focalY) : 50,
	        crop_meta: {
	          ...(image.crop_meta || {}),
	          zoom: Number.isFinite(Number(source.zoom)) ? Number(source.zoom) : 1,
	        },
	      }))
	    );

	    setImageCropSettings((prev) =>
	      prev.map(() => ({
	        focalX: Number.isFinite(Number(source.focalX)) ? Number(source.focalX) : 50,
	        focalY: Number.isFinite(Number(source.focalY)) ? Number(source.focalY) : 50,
	        zoom: Number.isFinite(Number(source.zoom)) ? Number(source.zoom) : 1,
	      }))
	    );
	  };

  const [isDragOver, setIsDragOver] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    processFiles(files);
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

  const processFiles = (files) => {
    const nextFiles = files.filter((file) => file && file.type?.startsWith('image/'));
    if (nextFiles.length === 0) {
      setError('Please select image files only.');
      return;
    }

    const dedupedNewFiles = nextFiles.filter((file) => {
      const signature = `${file.name}-${file.size}-${file.lastModified}`;
      return !selectedFiles.some(
        (existingFile) => `${existingFile.name}-${existingFile.size}-${existingFile.lastModified}` === signature
      );
    });

    const totalFiles = existingImages.length + selectedFiles.length + dedupedNewFiles.length;
    if (totalFiles > 10) {
      setError("You can only upload up to 10 images.");
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
    setSelectedFiles((current) => [...current, ...dedupedNewFiles]);
    
    // Create preview URLs
    const previews = dedupedNewFiles.map((file) => URL.createObjectURL(file));
    setPreviewImages((current) => [...current, ...previews]);
    setImageCropSettings((current) => [...current, ...dedupedNewFiles.map(() => ({ ...DEFAULT_IMAGE_CROP }))]);
    setActiveFramingIndex((current) => current || 0);
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

      if (selectedFiles.length === 0) {
        throw new Error('No images selected for upload.');
      }

      return await uploadListingImagesDirect(selectedFiles, {
        userId: user.id,
        cropSettings: imageCropSettings,
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

  const handleSaveDraft = () => {
    if (isEdit) return;
    const draftPayload = {
      formData,
      otherFuelType,
      marker,
      whatsappSameAsPhone,
      existingImages,
      imageCropSettings,
      savedAt: new Date().toISOString(),
    };

    const persistDraft = async () => {
      setIsDraftSaving(true);
      setError(null);
      setDraftNotice('Saving draft...');
      try {
        localStorage.setItem(CAR_DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));
        await apiClient.request('/api/user/drafts/car', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {
            draft_key: 'car',
            payload: draftPayload,
          },
        });
        setDraftNotice('Draft saved.');
      } catch (draftError) {
        console.error('Failed to save car draft:', draftError);
        setError(
          'Could not sync your draft right now. It was saved in this browser, but please contact support if the issue continues.'
        );
      } finally {
        setIsDraftSaving(false);
        window.setTimeout(() => {
          setDraftNotice((current) => (current && current !== 'Saving draft...' ? null : current));
        }, 2500);
      }
    };

    persistDraft();
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

    if (!isEdit && selectedFiles.length === 0) {
      setError('You must upload at least one image of your car.');
      focusAndHighlightField('images');
      return;
    }

    if (isEdit && existingImages.length + selectedFiles.length === 0) {
      setError('You must keep or upload at least one image of your car.');
      focusAndHighlightField('images');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
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

      if (isEdit) {
        const uploadedImages = selectedFiles.length > 0 ? await uploadImages() : [];
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

        if (persistedImages.length === 0 && selectedFiles.length > 0 && uploadedImages.length === 0) {
          // uploadImages already sets a user-facing error; abort early so we don't send an empty
          // image payload that forces a backend rollback.
          focusAndHighlightField('images');
          return;
        }

        const updatePayload = {
          ...submissionData,
          images: [...persistedImages, ...uploadedImages],
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
        const uploadedImages = await uploadImages();
        if (uploadedImages.length === 0) {
          // If we reached this point, the user selected files already; this indicates an upload failure.
          // uploadImages sets a more specific error (auth/storage/etc), so just focus the field.
          focusAndHighlightField('images');
          return;
        }
        submissionData.images = uploadedImages;
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
      console.error('Error creating car listing:', err);
      console.error('Error details:', {
        status: err.status,
        message: err.message,
        details: err.details
      });
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
          <h2>Basic Details</h2>
          
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
	            <div className="form-group full-width">
	              <label htmlFor="registration_ocr_file">Scan Car Registration (OCR) <span style={{ fontSize: '0.75em', color: '#f59e0b', fontWeight: 400 }}>(beta — still in testing)</span></label>
	              <div className="form-text">
	                Upload a clear photo of your car registration (Mulkiya). We'll try to detect and verify the <strong>make</strong>, <strong>model</strong>, and <strong>year</strong>.
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
            <div className="form-group">
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
                <SearchableSelect
                  id="whatsapp_country_code"
                  name="whatsapp_country_code"
                  className="form-control country-code-select"
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
                <button type="button" className="browse-btn" onClick={handleBrowseClick}>
                  Browse Files
                </button>
                <p className="upload-text-sub">Maximum 10 images • JPG, PNG, WEBP, GIF • 20MB each</p>
              </div>
              
              {previewImages.length > 0 && (
                <div className="image-previews-grid car-framing-grid">
	                  {previewImages.map((preview, index) => (
	                    <div 
	                      className={`preview-item car-framing-preview ${draggedIndex === index ? 'dragging' : ''} ${dragOverIndex === index ? 'drag-over' : ''}`}
	                      key={index}
	                      draggable
	                      role="button"
	                      tabIndex={0}
	                      onClick={() => {
	                        if (draggedIndex !== null) return;
	                        setActiveFramingIndex(existingCount + index);
	                        setShowFramingModal(true);
	                      }}
	                      onKeyDown={(event) => {
	                        if (event.key === 'Enter') {
	                          setActiveFramingIndex(existingCount + index);
	                          setShowFramingModal(true);
	                        }
	                      }}
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
	                          setActiveFramingIndex(existingCount + index);
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
	              {existingImages.length > 0 && (
	                <div className="image-previews-grid car-framing-grid">
		                  {existingImages.map((image, index) => (
		                    <div
		                      className={`preview-item car-framing-preview ${draggedExistingIndex === index ? 'dragging' : ''} ${dragOverExistingIndex === index ? 'drag-over' : ''}`}
		                      key={image.id || `${image.url}-${index}`}
		                      draggable
		                      role="button"
		                      tabIndex={0}
		                      onClick={() => {
		                        setActiveFramingIndex(index);
		                        setShowFramingModal(true);
		                      }}
		                      onKeyDown={(event) => {
		                        if (event.key === 'Enter') {
		                          setActiveFramingIndex(index);
		                          setShowFramingModal(true);
		                        }
		                      }}
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
                        style={{
                          objectPosition: `${Number.isFinite(Number(image.focal_x)) ? Number(image.focal_x) : 50}% ${Number.isFinite(Number(image.focal_y)) ? Number(image.focal_y) : 50}%`,
                        }}
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

      <ImageFramingModal
        isOpen={showFramingModal}
        images={framingImages}
        cropSettings={framingCropSettings}
        activeIndex={activeFramingIndex}
        onActiveIndexChange={setActiveFramingIndex}
        onUpdateCrop={updateFramingCropSetting}
        onApplyCurrentToAll={applyFramingToAll}
        onClose={() => setShowFramingModal(false)}
      />
    </div>
  );
};

export default PostCar; 
