import React, { useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { getAccessToken } from '../utils/supabaseClient';
import { trackEvent } from '../utils/analytics';
import { countryCodes, defaultCountryCode } from '../utils/countryCodes';
import { getAreasForEmirate } from '../utils/listingConstants';
import { getWhatsappPrefillTemplate } from '../utils/whatsapp';
import ActionNoticeModal from './ui/ActionNoticeModal';
import { buildDealerHelpMailto, buildErrorNotice } from '../utils/errorNotice';
import { LISTING_IMAGE_MAX_BYTES, uploadListingImagesDirect } from '../utils/directUpload';
import UnifiedCropper from './cropper/UnifiedCropper';
import '../styles/PostForms.css';
import '../styles/UAELicensePlate.css';
import UAELicensePlate from './UAELicensePlate';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = LISTING_IMAGE_MAX_BYTES;
const MAX_IMAGES = 10;

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const DEFAULT_WHATSAPP_PREFILL = getWhatsappPrefillTemplate('plate');
const PHONE_SPLIT_RE = /^(\+\d+)(\d+)$/;
const MAX_DESCRIPTION_WORDS = 300;

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

const PLATE_FORMAT_OPTIONS = [
  'Any format',
  'Contains digit repeated 2 times',
  'Contains digit repeated 3 times',
  'Contains digit repeated 4 times',
  'x???x (5 Digits)',
  'xyzyx (5 Digits)',
  'xxxX (5 Digits)',
  '?xxx? (5 Digits)',
  'хухух (5 Digits)',
  'хууух (5 Digits)',
  '??xxx (5 Digits)',
  'XXX?? (5 Digits)',
  'xXXXx (5 Digits)',
  'x??X (4 Digits)',
  'xyyx (4 Digits)',
  'xyxy (4 Digits)',
  '?xx? (4 Digits)',
  'xxxy (4 Digits)',
  'ХУУУ (4 Digits)',
  'XXXX (4 Digits)',
  'xyx (3 Digits)',
  'xyz (3 Digits)',
  'xyy (3 Digits)',
  'xxy (3 Digits)',
  'XXX (3 Digits)',
];

const getCodeOptions = (city) => {
  switch (city) {
    case 'Dubai':
      return [...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)), 'AA', 'BB', 'CC', 'DD', 'EE', 'CR'];
    case 'Abu Dhabi':
      return [...Array.from({ length: 20 }, (_, index) => `${index + 1}`), '50'];
    case 'Sharjah':
      return ['White', '1', '2', '3'];
    case 'Ajman':
    case 'Ras Al Khaimah':
    case 'Fujairah':
    case 'Umm Al Quwain':
      return Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
    default:
      return [];
  }
};

const PostPlate = () => {
  const { id: listingId } = useParams();
  const isEdit = Boolean(listingId);
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();

  const fileInputRef = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingListing, setIsLoadingListing] = useState(isEdit);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [pendingCropFiles, setPendingCropFiles] = useState(null);
  const [croppedImages, setCroppedImages] = useState([]); // Array<{croppedFile, originalFile, previewUrl}>
  const [existingImageUrls, setExistingImageUrls] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(true);
  const [useUsernameAsContactName, setUseUsernameAsContactName] = useState(false);
  const [formData, setFormData] = useState({
    city: '',
    code: '',
    digits: '',
    price: '',
    number: '',
    plate_format: 'Any format',
    contact_name: '',
    contact_phone: '',
    country_code: defaultCountryCode,
    whatsapp_country_code: defaultCountryCode,
    whatsapp_number: '',
    whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
    area: '',
    emirate: '',
    description: '',
    is_dealer: false,
  });

  useEffect(() => {
    syncWithSupabase();
  }, [syncWithSupabase]);

  useEffect(() => {
    const username = String(user?.username || '').trim();
    if (!username) {
      setUseUsernameAsContactName(false);
      return;
    }

    setUseUsernameAsContactName(true);
    setFormData((prev) => ({
      ...prev,
      contact_name: username,
    }));
  }, [user?.username]);

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

        const response = await fetch(`${API_URL}/api/plates/${listingId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load plate listing');
        }

        const data = await response.json();
        setFormData((prev) => ({
          ...prev,
          city: data.city || '',
          code: data.code || '',
          digits: data.digits ? String(data.digits) : '',
          price: data.price ? String(data.price) : '',
          number: data.number || '',
          plate_format: data.plate_format || 'Any format',
          contact_name: data.contact_name || '',
          contact_phone: data.contact_phone || '',
          country_code: data.country_code || defaultCountryCode,
          whatsapp_country_code: splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode).countryCode,
          whatsapp_number: splitPhoneNumber(data.whatsapp_number || '', data.country_code || defaultCountryCode).localNumber,
          whatsapp_prefill_text: data.whatsapp_prefill_text || DEFAULT_WHATSAPP_PREFILL,
          area: data.area || '',
          emirate: data.emirate || data.city || '',
          description: data.description || '',
          is_dealer: Boolean(data.is_dealer),
        }));
        const normalizedContact = splitPhoneNumber(data.contact_phone || '', data.country_code || defaultCountryCode);
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
        setError(fetchError.message || 'Failed to load plate listing');
      } finally {
        setIsLoadingListing(false);
      }
    };

    fetchListing();
  }, [isEdit, listingId]);

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
  const codeOptions = useMemo(() => getCodeOptions(formData.city), [formData.city]);
  const areaOptions = useMemo(() => getAreasForEmirate(formData.city), [formData.city]);
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

  useEffect(() => {
    if (!formData.city) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      code: codeOptions.includes(prev.code) ? prev.code : '',
    }));
  }, [codeOptions, formData.city]);

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
    let nextValue = type === 'checkbox' ? checked : value;

    if (name === 'number') {
      nextValue = value.replace(/\D/g, '').slice(0, 5);
    }

    if (name === 'price') {
      nextValue = value === '' ? '' : String(Math.max(0, Number(value)));
    }

    if (name === 'description') {
      nextValue = limitWords(value, MAX_DESCRIPTION_WORDS);
    }

    if (name === 'country_code') {
      setFormData((prev) => ({
        ...prev,
        country_code: value,
        whatsapp_country_code: whatsappSameAsPhone ? value : prev.whatsapp_country_code,
      }));
      return;
    }

    if (whatsappSameAsPhone && (name === 'contact_phone' || name === 'country_code')) {
      setFormData((prev) => ({
        ...prev,
        [name]: nextValue,
        whatsapp_country_code: name === 'country_code' ? value : prev.whatsapp_country_code,
        whatsapp_number: name === 'contact_phone' ? value : prev.whatsapp_number,
      }));
      return;
    }

    setFormData((prev) => {
      const updated = {
        ...prev,
        [name]: nextValue,
      };

      if (name === 'city') {
        updated.emirate = nextValue;
        updated.area = getAreasForEmirate(nextValue).includes(prev.area) ? prev.area : '';
      }

      if (name === 'number' && nextValue) {
        updated.digits = `${nextValue.length}`;
      }

      return updated;
    });
  };

  const onPickImages = (e) => {
    const files = Array.from(e.target.files || []);
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
    setPendingCropFiles(validFiles);
    e.target.value = '';
  };

  const removeExistingImage = (index) => {
    setExistingImageUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!user) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      // Upload any new cropped images before building the payload
      let uploadedImages = [];
      if (croppedImages.length > 0) {
        const croppedFiles = croppedImages.map(({ croppedFile }) => croppedFile);
        uploadedImages = await uploadListingImagesDirect(croppedFiles, { userId: user.id });
      }
      const mergedImages = [...existingImageUrls, ...uploadedImages];

      const payload = {
        city: formData.city,
        code: formData.code,
        digits: Number(formData.digits),
        price: Number(formData.price),
        number: formData.number.trim(),
        plate_format: formData.plate_format,
        contact_name: formData.contact_name.trim(),
        contact_phone: formData.contact_phone.trim(),
        country_code: formData.country_code,
        whatsapp_number: formData.whatsapp_number
          ? `${formData.whatsapp_country_code}${formData.whatsapp_number.trim()}`
          : '',
        whatsapp_prefill_text: DEFAULT_WHATSAPP_PREFILL,
        area: formData.area.trim(),
        emirate: formData.emirate || formData.city,
        description: formData.description.trim(),
        is_dealer: formData.is_dealer,
        ...(mergedImages.length > 0 && { images: mergedImages }),
      };

      if (isEdit) {
        const updateAttempts = ['PATCH', 'PUT', 'POST'];
        let lastError = null;
        for (const method of updateAttempts) {
          try {
            await apiClient.request(`/api/plates/${listingId}`, {
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
        await apiClient.post('/api/plates', payload);
      }
      if (!isEdit) {
        trackEvent('post_listing_success', { listing_type: 'plate', platform: 'web' });
      }
      setSuccess(true);

      setTimeout(() => {
        navigate('/my-listings');
      }, 1800);
    } catch (submissionError) {
      setError({
        message: submissionError.response?.data?.error || submissionError.message || `Failed to ${isEdit ? 'update' : 'submit'} plate listing.`,
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
        <p>You need to be logged in to post a plate listing.</p>
        <div className="auth-buttons">
          <button onClick={() => navigate('/login?redirect=/post-plate')}>Log In</button>
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
        <p>Your license plate listing has been {isEdit ? 'updated' : 'submitted and is pending approval'}.</p>
        <p>You will be redirected to your listings shortly.</p>
      </div>
    );
  }

  return (
    <div className="post-form-container">
      <section className="post-hero-section">
        <div className="post-hero-content">
          <div className="post-hero-text">
            <span className="post-hero-kicker">Sell Your Plate</span>
            <h1 className="post-hero-title">{isEdit ? 'Edit Your Plate Listing' : 'Present Your Plate Like A Premium Asset'}</h1>
            <p className="post-hero-subtitle">
              This flow now mirrors the car form structure and posts directly to the backend plate endpoint without the old client-side image detour.
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

          <form onSubmit={handleSubmit} className="post-form">
            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Gallery</h2>
                <p className="form-section-desc">
                  Upload optional supplementary plate photos. Each image is cropped to 4:1 banner format before upload.
                </p>
              </div>
              <div className="form-section-content">
                <div
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
                    if (!droppedFiles.length) return;
                    const validFiles = droppedFiles.filter((f) =>
                      SUPPORTED_IMAGE_TYPES.includes((f.type || '').toLowerCase()) &&
                      f.size <= MAX_IMAGE_SIZE_BYTES
                    );
                    if (validFiles.length) {
                      setError(null);
                      setPendingCropFiles(validFiles);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                >
                  <div className="upload-icon-wrapper">
                    <span className="material-symbols-outlined">upload</span>
                  </div>
                  <p className="upload-text-main">Drop plate photos here or click to browse</p>
                  <p className="upload-text-sub">JPG, PNG, WEBP, or GIF up to 20MB each</p>
                  <input
                    ref={fileInputRef}
                    className="file-input"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.gif"
                    multiple
                    onChange={onPickImages}
                  />
                </div>

                {croppedImages.length > 0 && (
                  <div className="image-previews-grid">
                    {croppedImages.map((img, index) => (
                      <div className="preview-item" key={index}>
                        <img src={img.previewUrl} alt={`Plate preview ${index + 1}`} />
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
                        <img src={imageUrl} alt={`Existing plate ${index + 1}`} />
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
                <h2 className="form-section-title">Plate identity</h2>
                <p className="form-section-desc">
                  Choose the city, code, and number exactly as they should be stored in the `license_plates` table. The preview updates from these same values.
                </p>
              </div>
              <div className="form-section-content">
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="city">City</label>
                    <SearchableSelect id="city" name="city" value={formData.city} onChange={handleChange} required>
                      <option value="">Select city</option>
                      <option value="Dubai">Dubai</option>
                      <option value="Abu Dhabi">Abu Dhabi</option>
                      <option value="Sharjah">Sharjah</option>
                      <option value="Ajman">Ajman</option>
                      <option value="Fujairah">Fujairah</option>
                      <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                      <option value="Umm Al Quwain">Umm Al Quwain</option>
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="code">Plate code</label>
                    <SearchableSelect id="code" name="code" value={formData.code} onChange={handleChange} required disabled={!formData.city}>
                      <option value="">Select code</option>
                      {codeOptions.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="number">Plate number</label>
                    <input id="number" name="number" value={formData.number} onChange={handleChange} required inputMode="numeric" placeholder="12345" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="digits">Digits</label>
                    <SearchableSelect id="digits" name="digits" value={formData.digits} onChange={handleChange} required>
                      <option value="">Select digits</option>
                      <option value="1">1 digit</option>
                      <option value="2">2 digits</option>
                      <option value="3">3 digits</option>
                      <option value="4">4 digits</option>
                      <option value="5">5 digits</option>
                    </SearchableSelect>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="plate_format">Plate format</label>
                    <SearchableSelect id="plate_format" name="plate_format" value={formData.plate_format} onChange={handleChange} required>
                      {PLATE_FORMAT_OPTIONS.map((format) => (
                        <option key={format} value={format}>
                          {format}
                        </option>
                      ))}
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="price">Price (AED)</label>
                    <input id="price" name="price" type="number" min="0" value={formData.price} onChange={handleChange} required placeholder="15000" />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Live preview</h2>
                <p className="form-section-desc">
                  The visual preview is now purely a frontend reference. The backend generates its own image from the same database values when the listing is created.
                </p>
              </div>
              <div className="form-section-content">
                <div className="plate-preview-panel">
                  {formData.city && formData.code ? (
                    <>
                      <div className="plate-preview-shell">
                        <UAELicensePlate city={formData.city} code={formData.code} number={formData.number || '12345'} />
                      </div>
                      <p className="form-text">
                        {formData.city} plate • {formData.plate_format} • AED {formData.price || '0'}
                      </p>
                    </>
                  ) : (
                    <p className="form-text">Select a city and code to generate the preview.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Seller details</h2>
                <p className="form-section-desc">
                  These contact fields map directly to the backend payload and will be carried through to listing moderation and buyer contact flows.
                </p>
              </div>
              <div className="form-section-content">
	                <div className="form-row">
	                  <div className="form-group">
	                    <label htmlFor="contact_name">Contact name</label>
	                    <input
	                      id="contact_name"
	                      name="contact_name"
	                      value={formData.contact_name}
	                      onChange={handleChange}
	                      required
	                      placeholder="Full name"
	                      disabled={useUsernameAsContactName && Boolean(String(user?.username || '').trim())}
	                    />
	                    <label
	                      className="checkbox-label"
	                      style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}
	                    >
	                      <input
	                        type="checkbox"
	                        checked={useUsernameAsContactName}
	                        disabled={!String(user?.username || '').trim()}
	                        onChange={(event) => {
	                          const nextChecked = event.target.checked;
	                          setUseUsernameAsContactName(nextChecked);
	                          if (nextChecked) {
	                            const username = String(user?.username || '').trim();
	                            if (username) {
	                              setFormData((prev) => ({ ...prev, contact_name: username }));
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
	                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="contact_phone">Contact phone</label>
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
                      <input id="contact_phone" name="contact_phone" value={formData.contact_phone} onChange={handleChange} required placeholder="501234567" className="phone-number-input" />
                    </div>
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
                            whatsapp_number: checked ? prev.contact_phone : prev.whatsapp_number,
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
                    <label htmlFor="area">Area</label>
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
                  <div className="form-group">
                    <label htmlFor="emirate">Emirate</label>
                    <input id="emirate" name="emirate" value={formData.emirate || formData.city} readOnly />
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
                      rows="5"
                      value={formData.description}
                      onChange={handleChange}
                      placeholder="Share any provenance, rarity, transfer notes, or negotiation context."
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
              <button type="submit" className="submit-btn" disabled={isSubmitting}>
                {isSubmitting ? (isEdit ? 'Updating...' : 'Submitting...') : (isEdit ? 'Update Plate Listing' : 'Submit Plate Listing')}
              </button>
              <p>The listing is sent directly to the backend plate workflow and reviewed before it goes live.</p>
            </div>
          </form>
        </div>
      </section>
      {pendingCropFiles && (
        <UnifiedCropper
          kind="plate"
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

export default PostPlate;
