import React, { useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { getAccessToken } from '../utils/supabaseClient';
import { trackEvent } from '../utils/analytics';
import { countryCodes, defaultCountryCode } from '../utils/countryCodes';
import { UAE_EMIRATES, getAreasForEmirate } from '../utils/listingConstants';
import { getWhatsappPrefillTemplate } from '../utils/whatsapp';
import ActionNoticeModal from './ui/ActionNoticeModal';
import { buildDealerHelpMailto, buildErrorNotice } from '../utils/errorNotice';
import { LISTING_IMAGE_MAX_BYTES, uploadListingImagesDirect, ensureUploadableImage } from '../utils/directUpload';
import { clearListingDraft, loadListingDraft, saveListingDraft } from '../utils/listingDrafts';
import { moderateImage } from '../utils/imageModeration';
import UnifiedCropper from './cropper/UnifiedCropper';
import { fieldLabel, firstMissingRequiredField, revealListingFieldError } from '../utils/listingFormValidation';
import '../styles/PostForms.css';
import '../styles/shell-tokens.css';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = LISTING_IMAGE_MAX_BYTES;
const MAX_IMAGES = 10;
const MAX_DESCRIPTION_WORDS = 300;
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const PART_DRAFT_STORAGE_KEY = 'dph_post_part_draft_v1';
const PHONE_SPLIT_RE = /^(\+\d+)(\d+)$/;
const COUNTRY_CODES = ['+971', '+973', '+965', '+968', '+974', '+966'];

const RequiredMark = () => <span className="required-asterisk">*</span>;
const PART_TYPES = [
  'Engine',
  'Transmission',
  'Suspension',
  'Brakes',
  'Electrical',
  'Body',
  'Interior',
  'Wheels & Tires',
  'Exhaust',
  'Cooling',
  'Lighting',
  'Other',
];
const COMPATIBLE_YEAR_OPTIONS = ['Any', '2000-2005', '2006-2010', '2011-2015', '2016-2020', '2021-2026'];
const DEFAULT_WHATSAPP_PREFILL = getWhatsappPrefillTemplate('part');

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
const PostCarParts = () => {
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
  const [formData, setFormData] = useState({
    name: '',
    part_type: '',
    condition: 'New',
    compatible_makes: '',
    compatible_models: '',
    compatible_years: 'Any',
    price: '',
    location: '',
    area: '',
    emirate: 'Dubai',
    contact_number: '',
    country_code: defaultCountryCode,
    whatsapp_country_code: defaultCountryCode,
    whatsapp_number: '',
    whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
    description: '',
    is_negotiable: false,
    is_dealer: false,
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

        const response = await fetch(`${API_URL}/api/parts/${listingId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load part listing');
        }

        const data = await response.json();
        setFormData((prev) => ({
          ...prev,
          name: data.name || '',
          part_type: data.part_type || '',
          condition: data.condition || 'New',
          compatible_makes: Array.isArray(data.compatible_makes) ? data.compatible_makes.join(', ') : '',
          compatible_models: Array.isArray(data.compatible_models) ? data.compatible_models.join(', ') : '',
          compatible_years: Array.isArray(data.compatible_years) && data.compatible_years[0] ? data.compatible_years[0] : 'Any',
          price: data.price ? String(data.price) : '',
          location: data.location || '',
          area: data.area || '',
          emirate: data.emirate || 'Dubai',
          contact_number: splitPhoneNumber(data.contact_number || '', data.country_code || defaultCountryCode).localNumber,
          country_code: data.country_code || defaultCountryCode,
          whatsapp_country_code: splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode).countryCode,
          whatsapp_number: splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode).localNumber,
          whatsapp_prefill_text: data.whatsapp_prefill_text || DEFAULT_WHATSAPP_PREFILL,
          description: data.description || '',
          is_negotiable: Boolean(data.is_negotiable),
          is_dealer: Boolean(data.is_dealer),
        }));
        const normalizedContact = splitPhoneNumber(data.contact_number || data.contact_phone || '', data.country_code || defaultCountryCode);
        const normalizedWhatsapp = splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode);
        setWhatsappSameAsPhone(
          Boolean(data.whatsapp_number) &&
            normalizedWhatsapp.countryCode === normalizedContact.countryCode &&
            normalizedWhatsapp.localNumber === normalizedContact.localNumber
        );

        const urls = Array.isArray(data.images)
          ? data.images
              .map((img) => img?.display_url || img?.image_url || img?.url)
              .filter(Boolean)
          : [];
        setExistingImageUrls(urls);
      } catch (fetchError) {
        setError(fetchError.message || 'Failed to load part listing');
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
      const draft = await loadListingDraft('part', PART_DRAFT_STORAGE_KEY);
      if (cancelled || !draft) {
        return;
      }

      const draftForm = draft.partsForm || draft.formData;
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

  const parsedCompatibility = useMemo(
    () => ({
      makes: formData.compatible_makes
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      models: formData.compatible_models
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    }),
    [formData.compatible_makes, formData.compatible_models]
  );
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
        whatsapp_country_code: name === 'country_code' ? value : prev.whatsapp_country_code,
        whatsapp_number: name === 'contact_number' ? value : prev.whatsapp_number,
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
      throw new Error('Please upload at least one part image.');
    }

    const croppedFiles = croppedImages.map(({ croppedFile }) => croppedFile);
    return uploadListingImagesDirect(croppedFiles, { userId: user.id });
  };

  const removeExistingImage = (index) => {
    setExistingImageUrls((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
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
        partsForm: formData,
        formData,
        existingImageUrls: mergedExisting,
        whatsappSameAsPhone,
        savedAt: new Date().toISOString(),
      };

      await saveListingDraft('part', PART_DRAFT_STORAGE_KEY, draftPayload);
      if (isEdit && listingId) {
        await apiClient.post(`/api/user/listings/part/${listingId}/outcome`, {
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
      trackEvent('save_listing_draft', { listing_type: 'part', platform: 'web' });
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
      setError('Please upload at least one part image before submitting.');
      revealListingFieldError(formRef.current, 'listing_images');
      return;
    }
    setError(null);
    setIsSubmitting(true);

    try {
      const uploadedImages = croppedImages.length > 0 ? await uploadImages() : [];
      const mergedImages = [...existingImageUrls, ...uploadedImages];
      const payload = {
        name: formData.name.trim(),
        part_type: formData.part_type,
        condition: formData.condition,
        compatible_makes: parsedCompatibility.makes,
        compatible_models: parsedCompatibility.models,
        compatible_years: formData.compatible_years === 'Any' ? '' : formData.compatible_years,
        price: Number(formData.price),
        location: (formData.area || formData.location).trim(),
        area: formData.area.trim(),
        emirate: formData.emirate,
        contact_number: `${formData.country_code}${formData.contact_number.trim()}`,
        country_code: formData.country_code,
        whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
        description: formData.description.trim(),
        whatsapp_number: formData.whatsapp_number
          ? `${formData.whatsapp_country_code}${formData.whatsapp_number.trim()}`
          : '',
        is_negotiable: formData.is_negotiable,
        is_dealer: formData.is_dealer,
        images: mergedImages,
      };

      if (isEdit) {
        const updateAttempts = ['PATCH', 'PUT', 'POST'];
        let lastError = null;
        for (const method of updateAttempts) {
          try {
            await apiClient.request(`/api/parts/${listingId}`, {
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
          throw new Error('Please upload at least one part image.');
        }
        await apiClient.post('/api/parts', payload);
      }
      if (!isEdit) {
        await clearListingDraft('part', PART_DRAFT_STORAGE_KEY);
        trackEvent('post_listing_success', { listing_type: 'part', platform: 'web' });
      }
      setSuccess(true);

      setTimeout(() => {
        navigate('/my-listings');
      }, 1800);
    } catch (submissionError) {
      setError({
        message: submissionError.response?.data?.error || submissionError.message || `Failed to ${isEdit ? 'update' : 'submit'} car part listing.`,
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
        <p>You need to be logged in to post a car part listing.</p>
        <div className="auth-buttons">
          <button onClick={() => navigate('/login?redirect=/post-car-parts')}>Log In</button>
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
        <p>Your car part listing has been {isEdit ? 'updated' : 'submitted and is pending approval'}.</p>
        <p>You will be redirected to your listings shortly.</p>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      <section className="post-hero-section">
        <div className="post-hero-content">
          <div className="post-hero-text">
            <span className="post-hero-kicker">Sell Car Parts</span>
            <h1 className="post-hero-title">{isEdit ? 'Edit Your Car Part Listing' : 'List Parts In The Same Premium System'}</h1>
            <p className="post-hero-subtitle">
              The parts flow now follows the same structure as the car form and uses the field names the backend `car_parts` endpoint actually stores.
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
                  Upload clear part photos from multiple angles. These are uploaded first, then the returned URLs are stored in `part_images`.
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
                  <p className="upload-text-main">Drop part photos here or click to browse</p>
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
                        <img src={img.previewUrl} alt={`Part preview ${index + 1}`} />
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
                        <img src={imageUrl} alt={`Existing part ${index + 1}`} />
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
                <h2 className="form-section-title">Part details</h2>
                <p className="form-section-desc">
                  Start with the exact fields the backend requires: `name`, `part_type`, `condition`, and price. This removes the old mismatch between the UI and payload.
                </p>
              </div>
              <div className="form-section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="name">Part name <RequiredMark /></label>
                    <input id="name" name="name" value={formData.name} onChange={handleChange} required placeholder="OEM LED headlight assembly" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="part_type">Part type <RequiredMark /></label>
                    <SearchableSelect id="part_type" name="part_type" value={formData.part_type} onChange={handleChange} required>
                      <option value="">Select part type</option>
                      {PART_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="condition">Condition</label>
                    <SearchableSelect id="condition" name="condition" value={formData.condition} onChange={handleChange}>
                      <option value="New">New</option>
                      <option value="Like New">Like New</option>
                      <option value="Used">Used</option>
                      <option value="Refurbished">Refurbished</option>
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="price">Price (AED) <RequiredMark /></label>
                    <input id="price" name="price" type="number" min="0" value={formData.price} onChange={handleChange} required placeholder="850" />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Compatibility</h2>
                <p className="form-section-desc">
                  Compatibility is stored as arrays in Supabase. Enter comma-separated makes and models here and they will be normalized before submission.
                </p>
              </div>
              <div className="form-section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="compatible_makes">Compatible makes</label>
                    <input
                      id="compatible_makes"
                      name="compatible_makes"
                      value={formData.compatible_makes}
                      onChange={handleChange}
                      placeholder="BMW, Toyota, Porsche"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="compatible_models">Compatible models</label>
                    <input
                      id="compatible_models"
                      name="compatible_models"
                      value={formData.compatible_models}
                      onChange={handleChange}
                      placeholder="X5, Camry, Cayenne"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="compatible_years">Year range</label>
                    <SearchableSelect id="compatible_years" name="compatible_years" value={formData.compatible_years} onChange={handleChange}>
                      {COMPATIBLE_YEAR_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="is_negotiable">Negotiable price</label>
                    <SearchableSelect
                      id="is_negotiable"
                      name="is_negotiable"
                      value={formData.is_negotiable ? 'true' : 'false'}
                      onChange={(event) =>
                        setFormData((prev) => ({
                          ...prev,
                          is_negotiable: event.target.value === 'true',
                        }))
                      }
                    >
                      <option value="false">Fixed price</option>
                      <option value="true">Negotiable</option>
                    </SearchableSelect>
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Seller contact</h2>
                <p className="form-section-desc">
                  Contact fields and location now map directly to the backend part payload so the listing, profile, and moderation data all stay connected.
                </p>
              </div>
              <div className="form-section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="emirate">Emirate</label>
                    <SearchableSelect id="emirate" name="emirate" value={formData.emirate} onChange={handleChange}>
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
                    <label htmlFor="location">Location details</label>
                    <input id="location" name="location" value={formData.location} onChange={handleChange} placeholder="Street / landmark (optional)" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="country_code">Country code</label>
                    <select
                      id="country_code"
                      name="country_code"
                      className="country-code-select"
                      value={formData.country_code}
                      onChange={handleChange}
                      aria-label="Country code"
                    >
                      {COUNTRY_CODES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="contact_number">Phone number <RequiredMark /></label>
                    <input id="contact_number" name="contact_number" value={formData.contact_number} onChange={handleChange} required placeholder="501234567" />
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

                <div className="form-row">
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
                  <div className="form-group">
                    <label htmlFor="description">Description</label>
                    <textarea
                      id="description"
                      name="description"
                      rows="6"
                      value={formData.description}
                      onChange={handleChange}
                      placeholder="State fitment notes, OEM or aftermarket status, warranty, condition details, and any included extras."
                    />
                    <div className="form-text description-word-counter">
                      {descriptionWordCount}/{MAX_DESCRIPTION_WORDS} words • {descriptionCharacterCount} characters
                    </div>
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
              <button type="button" className="btn-secondary" onClick={handleSaveDraft} disabled={isSubmitting || isDraftSaving}>
                {isDraftSaving ? 'Saving Draft...' : 'Save Draft'}
              </button>
              <button type="submit" className="submit-btn" disabled={isSubmitting}>
                {isSubmitting ? (isEdit ? 'Updating...' : 'Submitting...') : (isEdit ? 'Update Part Listing' : 'Submit Part Listing')}
              </button>
              <p>The listing, images, and seller information now follow the backend car-parts schema instead of the older disconnected field set.</p>
            </div>
          </form>
        </div>
      </section>
      {pendingCropFiles && (
        <UnifiedCropper
          kind="part"
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

export default PostCarParts;
