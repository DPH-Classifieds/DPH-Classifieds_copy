import React, { useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { getAccessToken } from '../utils/supabaseClient';
import { trackEvent } from '../utils/analytics';
import { countryCodes, defaultCountryCode } from '../utils/countryCodes';
import {
  UAE_EMIRATES,
  getAreasForEmirate,
  getYearOptions,
} from '../utils/listingConstants';
import { getWhatsappPrefillTemplate } from '../utils/whatsapp';
import ActionNoticeModal from './ui/ActionNoticeModal';
import { buildDealerHelpMailto, buildErrorNotice } from '../utils/errorNotice';
import { LISTING_IMAGE_MAX_BYTES, uploadListingImagesDirect, uploadRegistrationDocument, ensureUploadableImage } from '../utils/directUpload';
import { clearListingDraft, loadListingDraft, saveListingDraft } from '../utils/listingDrafts';
import { moderateImage } from '../utils/imageModeration';
import UnifiedCropper from './cropper/UnifiedCropper';
import { fieldLabel, firstMissingRequiredField, revealListingFieldError } from '../utils/listingFormValidation';
import '../styles/PostForms.css';
import '../styles/shell-tokens.css';

const RequiredMark = () => <span className="required-asterisk">*</span>;

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = LISTING_IMAGE_MAX_BYTES;
const MAX_IMAGES = 10;
const MAX_DESCRIPTION_WORDS = 300;
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const DEFAULT_WHATSAPP_PREFILL = getWhatsappPrefillTemplate('bike');
const BIKE_DRAFT_STORAGE_KEY = 'dph_post_bike_draft_v1';
const PHONE_SPLIT_RE = /^(\+\d+)(\d+)$/;

const splitPhoneNumber = (value, fallbackCountryCode = defaultCountryCode) => {
  const raw = String(value || '').trim();
  if (!raw) {
    return { countryCode: fallbackCountryCode, localNumber: '' };
  }

  const match = raw.match(PHONE_SPLIT_RE);
  if (match) {
    return { countryCode: match[1], localNumber: match[2] };
  }

  return { countryCode: fallbackCountryCode, localNumber: raw.replace(/^\+/, '') };
};

const BIKE_CATEGORIES = [
  'Sport',
  'Cruiser',
  'Touring',
  'Adventure',
  'Naked',
  'Dual Sport',
  'Off-road',
  'Scooter',
  'Commuter',
  'Electric',
];

const BIKE_FEATURES = [
  'ABS',
  'Traction Control',
  'Cruise Control',
  'Heated Grips',
  'Quick Shifter',
  'Rider Modes',
  'LED Lights',
  'Bluetooth Connectivity',
  'USB Charging',
  'Touring Screen',
  'Saddlebags/Panniers',
];

const PostBike = () => {
  const { id: listingId } = useParams();
  const isEdit = Boolean(listingId);
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();
  const fileInputRef = useRef(null);
  const formRef = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [isLoadingListing, setIsLoadingListing] = useState(isEdit);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [draftNotice, setDraftNotice] = useState(null);
  const [pendingCropFiles, setPendingCropFiles] = useState(null);
  const [croppedImages, setCroppedImages] = useState([]); // Array<{croppedFile, originalFile, previewUrl}>
  const [existingImageUrls, setExistingImageUrls] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [moderationErrors, setModerationErrors] = useState({});
  const [moderating, setModerating] = useState(false);
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [regDocFile, setRegDocFile] = useState(null);
  const [regDocUrl, setRegDocUrl] = useState('');
  const [uploadingRegDoc, setUploadingRegDoc] = useState(false);
  const [regDocOcrStatus, setRegDocOcrStatus] = useState('');
  const regDocInputRef = useRef(null);
  const [formData, setFormData] = useState({
    bike_brand: '',
    bike_model: '',
    year: '',
    bike_category: '',
    engine_capacity: '',
    mileage: '',
    color: '',
    condition: 'Good',
    price: '',
    location: '',
    area: '',
    emirate: 'Dubai',
    description: '',
    vin_number: '',
    contact_number: '',
    country_code: defaultCountryCode,
    whatsapp_country_code: defaultCountryCode,
    whatsapp_number: '',
    whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
    is_dealer: false,
    cylinders: '',
    wheels: '2',
    features: [],
  });

  useEffect(() => {
    syncWithSupabase();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

        const response = await fetch(`${API_URL}/api/bikes/${listingId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load bike listing');
        }

        const data = await response.json();
        setFormData((prev) => ({
          ...prev,
          bike_brand: data.bike_brand || data.make || '',
          bike_model: data.bike_model || data.model || '',
          year: data.year ? String(data.year) : '',
          bike_category: data.bike_type || data.bike_category || '',
          engine_capacity: data.engine_size || data.engine_capacity || '',
          mileage: data.mileage ? String(data.mileage) : '',
          color: data.color || '',
          condition: data.condition || 'Good',
          price: data.price ? String(data.price) : '',
          location: data.location || '',
          area: data.area || '',
          emirate: data.emirate || 'Dubai',
          description: data.description || '',
          vin_number: data.vin_number || '',
          contact_number: splitPhoneNumber(data.contact_number || data.contact_phone || '', data.country_code || defaultCountryCode).localNumber,
          country_code: data.country_code || defaultCountryCode,
          whatsapp_country_code: splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode).countryCode,
          whatsapp_number: splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode).localNumber,
          whatsapp_prefill_text: data.whatsapp_prefill_text || DEFAULT_WHATSAPP_PREFILL,
          is_dealer: Boolean(data.is_dealer),
          cylinders: data.cylinders ? String(data.cylinders) : '',
          wheels: data.wheels ? String(data.wheels) : '2',
          features: Array.isArray(data.features) ? data.features : [],
        }));
        const normalizedContact = splitPhoneNumber(
          data.contact_number || data.contact_phone || '',
          data.country_code || defaultCountryCode
        );
        const normalizedWhatsapp = splitPhoneNumber(
          data.whatsapp_number || '',
          data.country_code || defaultCountryCode
        );
        setWhatsappSameAsPhone(
          Boolean(data.whatsapp_number) &&
            normalizedWhatsapp.countryCode === (normalizedContact.countryCode || defaultCountryCode) &&
            normalizedWhatsapp.localNumber === normalizedContact.localNumber
        );

        const urls = Array.isArray(data.images)
          ? data.images
              .map((img) => img?.display_url || img?.image_url || img?.url)
              .filter(Boolean)
          : [];
        setExistingImageUrls(urls);
        if (data.registration_doc_url) { setRegDocUrl(data.registration_doc_url); }
      } catch (fetchError) {
        setError(fetchError.message || 'Failed to load bike listing');
      } finally {
        setIsLoadingListing(false);
      }
    };

    fetchListing();
  }, [isEdit, listingId]);

  useEffect(() => {
    if (isEdit || !user?.id) {
      return;
    }

    let cancelled = false;
    const restoreDraft = async () => {
      const draft = await loadListingDraft('bike', BIKE_DRAFT_STORAGE_KEY);
      if (cancelled || !draft) {
        return;
      }

      const draftForm = draft.bikeForm || draft.formData;
      if (draftForm) {
        setFormData((prev) => ({ ...prev, ...draftForm }));
      }
      if (Array.isArray(draft.existingImageUrls)) {
        setExistingImageUrls(draft.existingImageUrls);
      }
      if (typeof draft.whatsappSameAsPhone === 'boolean') {
        setWhatsappSameAsPhone(draft.whatsappSameAsPhone);
      }
      setDraftNotice('Draft restored.');
    };

    restoreDraft();
    return () => {
      cancelled = true;
    };
  }, [isEdit, user?.id]);

  // Revoke cropped preview blob URLs on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      croppedImages.forEach(({ previewUrl }) => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isUnauthed = !isLoading && !user;

  const featureSummary = useMemo(() => {
    if (!formData.features.length) {
      return 'No equipment selected yet';
    }

    if (formData.features.length <= 3) {
      return formData.features.join(', ');
    }

    return `${formData.features.slice(0, 3).join(', ')} +${formData.features.length - 3} more`;
  }, [formData.features]);
  const yearOptions = getYearOptions();
  const areaOptions = getAreasForEmirate(formData.emirate);
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

  const countWords = (text) => (String(text || '').trim().match(/\S+/g) || []).length;

  const limitWords = (text, maxWords) => {
    if (!text) return text;
    const matches = Array.from(String(text).matchAll(/\S+/g));
    if (matches.length <= maxWords) return text;
    const cutoff = matches[maxWords]?.index ?? String(text).length;
    return String(text).slice(0, cutoff).trimEnd();
  };

  const descriptionWordCount = countWords(formData.description || '');
  const descriptionCharacterCount = (formData.description || '').length;

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;

    if (name === 'emirate') {
      const nextAreas = getAreasForEmirate(value);
      setFormData((prev) => ({
        ...prev,
        emirate: value,
        area: nextAreas.includes(prev.area) ? prev.area : '',
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

    if (whatsappSameAsPhone && (name === 'contact_number' || name === 'country_code')) {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
        whatsapp_number: name === 'contact_number' ? value : prev.whatsapp_number,
        whatsapp_country_code: name === 'country_code' ? value : prev.whatsapp_country_code,
      }));
      return;
    }

    if (name === 'features') {
      setFormData((prev) => ({
        ...prev,
        features: checked
          ? [...prev.features, value]
          : prev.features.filter((feature) => feature !== value),
      }));
      return;
    }

    if (name === 'description') {
      setFormData((prev) => ({
        ...prev,
        description: limitWords(value, MAX_DESCRIPTION_WORDS),
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const onPickImages = async (source) => {
    const rawFiles = Array.isArray(source)
      ? source
      : Array.from(source?.target?.files || []);
    if (!rawFiles.length) return;

    // Convert iPhone HEIC (incl. files mislabeled .jpg) to JPEG before the type
    // gate, moderation and cropping so none of the canvas steps choke on it.
    const files = [];
    for (const raw of rawFiles) {
      try {
        files.push(await ensureUploadableImage(raw));
      } catch (err) {
        setError(err?.message || `We couldn't process ${raw?.name || 'a photo'}.`);
      }
    }
    if (!files.length) return;

    const validFiles = [];
    for (const file of files) {
      if (croppedImages.length + validFiles.length >= MAX_IMAGES) {
        setError(`Maximum ${MAX_IMAGES} images allowed`);
        break;
      }
      if (!SUPPORTED_IMAGE_TYPES.includes((file.type || '').toLowerCase())) {
        setError(`Unsupported file type: ${file.name}`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        setError(`File too large: ${file.name}. Max size is 20MB.`);
        continue;
      }
      validFiles.push(file);
    }

    if (!validFiles.length) return;
    setError(null);
    setModerating(true);
    setModerationErrors({});
    if (source?.target) source.target.value = '';

    try {
      const results = await Promise.all(
        validFiles.map(file => moderateImage(file).then(r => ({ file, ...r })))
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
      setPendingCropFiles(validFiles);
    } finally {
      setModerating(false);
    }
  };

  const uploadImages = async () => {
    if (croppedImages.length === 0) {
      throw new Error('Please upload at least one bike image.');
    }

    const croppedFiles = croppedImages.map(({ croppedFile }) => croppedFile);
    return uploadListingImagesDirect(croppedFiles, { userId: user.id });
  };

  const removeExistingImage = (index) => {
    setExistingImageUrls((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleRegDocChange = async (e) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    let file;
    try {
      file = await ensureUploadableImage(rawFile);
    } catch (err) {
      setError(err?.message || "We couldn't process this registration photo.");
      e.target.value = '';
      return;
    }
    setRegDocFile(file);
    setRegDocUrl('');
    setRegDocOcrStatus('');
    if (!user?.id) return;
    setUploadingRegDoc(true);
    try {
      const url = await uploadRegistrationDocument(file, { userId: user.id });
      setRegDocUrl(url);
    } catch (err) {
      console.warn('Failed to upload registration doc:', err);
    } finally {
      setUploadingRegDoc(false);
    }
  };

  const runBikeOcr = async () => {
    if (!regDocFile) return;
    setRegDocOcrStatus('scanning');
    try {
      // Use the structured, validated scan-registration endpoint (same as
      // the car flow) instead of raw text + a blind first-17-char regex.
      // It runs the VIN charset check, checksum-aware repair, and NHTSA
      // decode, so we never auto-fill a fabricated VIN.
      const formData = new FormData();
      formData.append('image', regDocFile, regDocFile.name || 'registration-scan');
      formData.append('document_type', 'mulkiya');
      const resp = await apiClient.post('/api/ocr/scan-registration', formData);
      const vin = String(resp?.fields?.vin || '').toUpperCase();
      if (vin) {
        handleChange({ target: { name: 'vin_number', value: vin } });
        setRegDocOcrStatus(resp?.vin_validation?.valid ? 'done' : 'review');
      } else {
        setRegDocOcrStatus('not-found');
      }
    } catch (err) {
      console.warn('Bike OCR failed:', err);
      setRegDocOcrStatus('service-error');
    }
  };

  const handleSaveDraft = async () => {
    if (!user) return;

    setIsDraftSaving(true);
    setError(null);
    setDraftNotice('Saving draft...');
    try {
      // Upload any newly cropped images before persisting the draft, so the
      // photos survive a reload and the previewed blobs don't end up as a
      // duplicate batch when the user later submits.
      let mergedExisting = [...existingImageUrls];
      let uploadedNow = [];
      if (croppedImages.length > 0) {
        const croppedFiles = croppedImages.map(({ croppedFile }) => croppedFile);
        uploadedNow = await uploadListingImagesDirect(croppedFiles, { userId: user.id });
        mergedExisting = [...mergedExisting, ...uploadedNow];
      }

      const draftPayload = {
        bikeForm: formData,
        formData,
        existingImageUrls: mergedExisting,
        whatsappSameAsPhone,
        savedAt: new Date().toISOString(),
      };

      await saveListingDraft('bike', BIKE_DRAFT_STORAGE_KEY, draftPayload);
      if (isEdit && listingId) {
        await apiClient.post(`/api/user/listings/bike/${listingId}/outcome`, {
          outcome: 'move_to_draft',
        });
      }

      if (uploadedNow.length > 0) {
        croppedImages.forEach(({ previewUrl }) => {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
        });
        setCroppedImages([]);
        setExistingImageUrls(mergedExisting);
      }

      setDraftNotice('Draft saved.');
      trackEvent('save_listing_draft', { listing_type: 'bike', platform: 'web' });
    } catch (draftError) {
      setError(draftError?.message || 'Could not sync your draft right now. It was saved in this browser, but please try again before switching devices.');
    } finally {
      setIsDraftSaving(false);
      window.setTimeout(() => {
        setDraftNotice((current) => (current && current !== 'Saving draft...' ? null : current));
      }, 2500);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!user) {
      return;
    }

    const missingField = firstMissingRequiredField(formRef.current);
    if (missingField) {
      setError(`Please complete “${fieldLabel(formRef.current, missingField)}” before submitting.`);
      revealListingFieldError(formRef.current, missingField);
      return;
    }
    if (!isEdit && existingImageUrls.length + croppedImages.length === 0) {
      setError('Please upload at least one bike image before submitting.');
      revealListingFieldError(formRef.current, 'listing_images');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      const uploadedImages = croppedImages.length > 0 ? await uploadImages() : [];
      const mergedImages = [...existingImageUrls, ...uploadedImages];
      const payload = {
        bike_brand: formData.bike_brand.trim(),
        bike_model: formData.bike_model.trim(),
        bike_type: formData.bike_category,
        year: Number(formData.year),
        engine_size: formData.engine_capacity.trim(),
        mileage: Number(formData.mileage),
        color: formData.color.trim(),
        price: Number(formData.price),
        location: (formData.area || formData.location).trim(),
        area: formData.area.trim(),
        emirate: formData.emirate,
        description: formData.description.trim(),
        contact_number: formData.contact_number.trim(),
        country_code: formData.country_code,
        whatsapp_number: formData.whatsapp_number
          ? `${formData.whatsapp_country_code}${formData.whatsapp_number.trim()}`
          : '',
        whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
        features: formData.features,
        condition: formData.condition,
        vin_number: formData.vin_number.trim().toUpperCase(),
        cylinders: formData.cylinders ? Number(formData.cylinders) : null,
        wheels: formData.wheels ? Number(formData.wheels) : null,
        is_dealer: formData.is_dealer,
        images: mergedImages,
        registration_doc_url: regDocUrl || undefined,
      };

      if (isEdit) {
        const updateAttempts = ['PATCH', 'PUT', 'POST'];
        let lastError = null;
        for (const method of updateAttempts) {
          try {
            await apiClient.request(`/api/bikes/${listingId}`, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: payload,
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
        if (mergedImages.length === 0) {
          throw new Error('Please upload at least one bike image.');
        }
        await apiClient.post('/api/bikes', payload);
      }
      if (!isEdit) {
        await clearListingDraft('bike', BIKE_DRAFT_STORAGE_KEY);
        trackEvent('post_listing_success', { listing_type: 'bike', platform: 'web' });
      }
      setSuccess(true);

      setTimeout(() => {
        navigate('/my-listings');
      }, 1800);
    } catch (submissionError) {
      setError({
        message: submissionError.response?.data?.error || submissionError.message || `Failed to ${isEdit ? 'update' : 'submit'} bike listing.`,
        code: submissionError?.code || submissionError?.response?.data?.code || submissionError?.details?.code || null,
        details: submissionError?.details || submissionError?.response?.data || null,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isUnauthed) {
    return (
      <div className="auth-required">
        <h2>Authentication Required</h2>
        <p>You need to be logged in to post a bike listing.</p>
        <div className="auth-buttons">
          <button onClick={() => navigate('/login?redirect=/post-bike')}>Log In</button>
          <button onClick={() => navigate('/signup')}>Sign Up</button>
        </div>
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

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your bike listing has been {isEdit ? 'updated' : 'submitted and is pending approval'}.</p>
        <p>You will be redirected to your listings shortly.</p>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      <section className="post-hero-section">
        <div className="post-hero-content">
          <div className="post-hero-text">
            <span className="post-hero-kicker">Sell Your Bike</span>
            <h1 className="post-hero-title">{isEdit ? 'Edit Your Bike Listing' : 'Publish A Bike Listing With Confidence'}</h1>
            <p className="post-hero-subtitle">
              Use the same polished listing flow as the car form. Clean specs, crisp media, and a clear seller story help the right buyer move faster.
            </p>
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

          <form onSubmit={handleSubmit} className="post-form" ref={formRef} noValidate>
            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Gallery</h2>
                <p className="form-section-desc">
                  Upload up to {MAX_IMAGES} sharp photos. The images are stored first, then the returned URLs are written into the bike listing payload.
                </p>
              </div>
              <div className="form-section-content">
                <div id="listing_images"
                  className={`image-upload-area ${isDragOver ? 'drag-over' : ''}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setIsDragOver(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragOver(false);
                    const droppedFiles = Array.from(event.dataTransfer.files || []);
                    if (droppedFiles.length) void onPickImages(droppedFiles);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                >
                  <div className="upload-icon-wrapper">
                    <span className="material-symbols-outlined">upload</span>
                  </div>
                  <p className="upload-text-main">Drop bike photos here or click to browse</p>
                  <p className="upload-text-sub">HEIC, JPG, PNG, WEBP, or GIF up to 20MB each</p>
                  <input
                    ref={fileInputRef}
                    className="file-input"
                    type="file"
                    accept=".heic,.heif,.jpg,.jpeg,.png,.webp,.gif,image/heic,image/heif,image/jpeg,image/png,image/webp"
                    multiple
                    onChange={onPickImages}
                  />
                </div>
                {moderating && (
                  <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '4px 0 0' }}>Checking images…</p>
                )}
                {Object.entries(moderationErrors).map(([filename, msg]) => (
                  <p key={filename} style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
                    <strong>{filename}:</strong> {msg}
                  </p>
                ))}

                {croppedImages.length > 0 && (
                  <div className="image-previews-grid">
                    {croppedImages.map((img, index) => (
                      <div className="preview-item" key={index}>
                        <img src={img.previewUrl} alt={`Bike preview ${index + 1}`} />
                        <button
                          type="button"
                          className="remove-btn"
                          onClick={() => setCroppedImages((prev) => prev.filter((_, j) => j !== index))}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {existingImageUrls.length > 0 && (
                  <div className="image-previews-grid">
                    {existingImageUrls.map((imageUrl, index) => (
                      <div className="preview-item" key={`${imageUrl}-${index}`}>
                        <img src={imageUrl} alt={`Existing bike ${index + 1}`} />
                        <button type="button" className="remove-btn" onClick={() => removeExistingImage(index)}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Core details</h2>
                <p className="form-section-desc">
                  Set the bike identity first so the listing title, search filters, and detail pages all stay coherent with the backend bike schema.
                </p>
              </div>
              <div className="form-section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="bike_brand">Brand <RequiredMark /></label>
                    <input id="bike_brand" name="bike_brand" value={formData.bike_brand} onChange={handleChange} required placeholder="Yamaha" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="bike_model">Model <RequiredMark /></label>
                    <input id="bike_model" name="bike_model" value={formData.bike_model} onChange={handleChange} required placeholder="MT-09" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="year">Year <RequiredMark /></label>
                    <SearchableSelect id="year" name="year" value={formData.year} onChange={handleChange} required>
                      <option value="">Select Year</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="bike_category">Category <RequiredMark /></label>
                    <SearchableSelect id="bike_category" name="bike_category" value={formData.bike_category} onChange={handleChange} required>
                      <option value="">Select category</option>
                      {BIKE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="condition">Condition</label>
                    <SearchableSelect id="condition" name="condition" value={formData.condition} onChange={handleChange}>
                      <option value="Good">Good</option>
                      <option value="Used">Used</option>
                      <option value="New">New</option>
                      <option value="Like New">Like New</option>
                      <option value="Project/Needs Work">Project/Needs Work</option>
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="color">Color <RequiredMark /></label>
                    <input id="color" name="color" value={formData.color} onChange={handleChange} required placeholder="Matte Black" />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Performance spec</h2>
                <p className="form-section-desc">
                  These values map directly to the backend `bikes` table and drive listing filters, summaries, and detail-page badges.
                </p>
              </div>
              <div className="form-section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="engine_capacity">Engine capacity <RequiredMark /></label>
                    <input id="engine_capacity" name="engine_capacity" value={formData.engine_capacity} onChange={handleChange} required placeholder="890cc" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="mileage">Mileage (km) <RequiredMark /></label>
                    <input id="mileage" name="mileage" type="number" min="0" value={formData.mileage} onChange={handleChange} required placeholder="3500" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="cylinders">Cylinders</label>
                    <SearchableSelect id="cylinders" name="cylinders" value={formData.cylinders} onChange={handleChange}>
                      <option value="">Select cylinders</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                      <option value="6">6</option>
                      <option value="8">8</option>
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="wheels">Wheels</label>
                    <SearchableSelect id="wheels" name="wheels" value={formData.wheels} onChange={handleChange}>
                      <option value="2">2 wheels</option>
                      <option value="3">3 wheels</option>
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="vin_number">VIN</label>
                    <input
                      id="vin_number"
                      name="vin_number"
                      value={formData.vin_number}
                      onChange={(event) =>
                        handleChange({
                          target: {
                            name: 'vin_number',
                            value: event.target.value.toUpperCase(),
                          },
                        })
                      }
                      placeholder="1HGCM82633A123456"
                      maxLength="17"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="price">Price (AED) <RequiredMark /></label>
                    <input id="price" name="price" type="number" min="0" value={formData.price} onChange={handleChange} required placeholder="25000" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group full-width">
                    <label>Registration Document <span style={{fontWeight:'normal',fontSize:'0.85em'}}>(optional — for admin verification)</span></label>
                    <div className="registration-doc-upload">
                      <input
                        ref={regDocInputRef}
                        type="file"
                        accept=".heic,.heif,.jpg,.jpeg,.png,.webp,.pdf,image/heic,image/heif,image/jpeg,image/png,image/webp,application/pdf"
                        className="file-input"
                        onChange={handleRegDocChange}
                        id="bike_registration_doc"
                      />
                      <label htmlFor="bike_registration_doc" className="upload-doc-label">
                        {regDocFile ? regDocFile.name : 'Upload mulkiyya / registration card'}
                      </label>
                      {uploadingRegDoc && <span className="form-text">Uploading…</span>}
                      {regDocUrl && !uploadingRegDoc && <span className="form-text text-success">Document uploaded.</span>}
                    </div>
                    {regDocFile && regDocUrl && (
                      <button type="button" className="btn btn-secondary btn-sm mt-1" onClick={runBikeOcr} disabled={regDocOcrStatus === 'scanning'}>
                        {regDocOcrStatus === 'scanning' ? 'Scanning…' : 'Scan document for VIN'}
                      </button>
                    )}
                    {regDocOcrStatus === 'done' && <p className="form-text text-success">VIN read &amp; validated from document — please still double-check it's correct.</p>}
                    {regDocOcrStatus === 'review' && <p className="form-text text-warning">VIN read but could not be validated — check every character carefully before submitting.</p>}
                    {regDocOcrStatus === 'not-found' && <p className="form-text text-muted">No VIN found in document — enter manually above.</p>}
                    {regDocOcrStatus === 'service-error' && <p className="form-text text-warning">Scan service unavailable — enter VIN manually. Try again in a moment.</p>}
                    <div className="form-text text-muted">Never shown to buyers. Scanned text may be inaccurate — verify before submitting. Uploaded documents may be retained to improve this scanner (see our Privacy Policy).</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Seller story</h2>
                <p className="form-section-desc">
                  Add the market context buyers need. The backend stores this against the bike record and the same information should read consistently in profile-linked listings.
                </p>
              </div>
              <div className="form-section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="emirate">Emirate <RequiredMark /></label>
                    <SearchableSelect id="emirate" name="emirate" value={formData.emirate} onChange={handleChange} required>
                      {UAE_EMIRATES.map((emirate) => (
                        <option key={emirate} value={emirate}>{emirate}</option>
                      ))}
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="area">Area <RequiredMark /></label>
                    {areaOptions.length > 0 ? (
                      <SearchableSelect id="area" name="area" value={formData.area} onChange={handleChange} required>
                        <option value="">Select Area</option>
                        {areaOptions.map((area) => (
                          <option key={area} value={area}>{area}</option>
                        ))}
                      </SearchableSelect>
                    ) : (
                      <input id="area" name="area" value={formData.area} onChange={handleChange} required placeholder="Area" />
                    )}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="location">Location Details</label>
                    <input id="location" name="location" value={formData.location} onChange={handleChange} placeholder="Building / Landmark (optional)" />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="description">Description <RequiredMark /></label>
                  <textarea
                    id="description"
                    name="description"
                    rows="6"
                    value={formData.description}
                    onChange={handleChange}
                    required
                    placeholder="Summarize condition, ownership history, maintenance, upgrades, and why this bike stands out."
                  />
                  <div className="form-text description-word-counter">
                    {descriptionWordCount}/{MAX_DESCRIPTION_WORDS} words • {descriptionCharacterCount} characters
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="contact_number">Phone Number <RequiredMark /></label>
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
                        id="contact_number"
                        name="contact_number"
                        value={formData.contact_number}
                        onChange={handleChange}
                        required
                        placeholder="501234567"
                        className="phone-number-input"
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor="is_dealer">Dealer listing</label>
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
                    >
                      <option value="false">Private seller</option>
                      <option value="true">Dealer</option>
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="whatsapp_number">WhatsApp Number</label>
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
                        id="whatsapp_number"
                        name="whatsapp_number"
                        value={formData.whatsapp_number}
                        onChange={handleChange}
                        placeholder="501234567"
                        className="phone-number-input"
                        disabled={whatsappSameAsPhone}
                      />
                    </div>
                    <label className="checkbox-label" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>
                      <input
                        type="checkbox"
                        checked={whatsappSameAsPhone}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setWhatsappSameAsPhone(checked);
                          setFormData((prev) => ({
                            ...prev,
                            whatsapp_country_code: checked ? prev.country_code : prev.whatsapp_country_code,
                            whatsapp_number: checked ? prev.contact_number : prev.whatsapp_number,
                          }));
                        }}
                        style={{ width: 14, height: 14 }}
                      />
                      Same as phone number
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Equipment</h2>
                <p className="form-section-desc">
                  Feature tags are stored as arrays in the backend and reused in listing cards, filters, and detail pages.
                </p>
              </div>
              <div className="form-section-content">
                <p className="form-text">Selected: {featureSummary}</p>
                <div className="features-grid">
                  {BIKE_FEATURES.map((feature) => (
                    <div className="feature-item" key={feature}>
                      <label htmlFor={`feature-${feature}`}>
                        <input
                          id={`feature-${feature}`}
                          type="checkbox"
                          name="features"
                          value={feature}
                          checked={formData.features.includes(feature)}
                          onChange={handleChange}
                        />
                        <span>{feature}</span>
                      </label>
                    </div>
                  ))}
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
            <button type="button" className="btn-secondary" onClick={handleSaveDraft} disabled={isSubmitting || isDraftSaving}>
              {isDraftSaving ? 'Saving Draft...' : 'Save Draft'}
            </button>
            <button type="submit" className="submit-btn" disabled={isSubmitting}>
              {isSubmitting ? (isEdit ? 'Updating...' : 'Submitting...') : (isEdit ? 'Update Bike Listing' : 'Submit Bike Listing')}
            </button>
            <p>Your listing will be reviewed before it goes live. We keep the data and media pipeline aligned with the backend bike schema.</p>
          </div>
          </form>
        </div>
      </section>
      {pendingCropFiles && (
        <UnifiedCropper
          kind="bike"
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

export default PostBike;
