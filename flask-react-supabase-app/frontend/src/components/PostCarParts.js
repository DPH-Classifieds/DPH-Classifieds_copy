import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/PostForms.css';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 10;
const COUNTRY_CODES = ['+971', '+973', '+965', '+968', '+974', '+966'];
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
const HERO_IMAGE =
  'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?auto=format&fit=crop&w=1200&q=80';

const PostCarParts = () => {
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();
  const fileInputRef = useRef(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewImages, setPreviewImages] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    part_type: '',
    condition: 'New',
    compatible_makes: '',
    compatible_models: '',
    compatible_years: 'Any',
    price: '',
    location: '',
    emirate: 'Dubai',
    contact_number: '',
    country_code: '+971',
    description: '',
    is_negotiable: false,
    is_dealer: false,
  });

  useEffect(() => {
    syncWithSupabase();
  }, [syncWithSupabase]);

  useEffect(() => {
    return () => {
      previewImages.forEach((preview) => URL.revokeObjectURL(preview));
    };
  }, [previewImages]);

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

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const processFiles = (files) => {
    if (!files.length) {
      return;
    }

    const nextFiles = [...selectedFiles];
    const nextPreviews = [...previewImages];

    for (const file of files) {
      if (nextFiles.length >= MAX_IMAGES) {
        setError(`Maximum ${MAX_IMAGES} images allowed`);
        break;
      }

      if (!SUPPORTED_IMAGE_TYPES.includes((file.type || '').toLowerCase())) {
        setError(`Unsupported file type: ${file.name}`);
        continue;
      }

      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        setError(`File too large: ${file.name}. Max size is 5MB.`);
        continue;
      }

      nextFiles.push(file);
      nextPreviews.push(URL.createObjectURL(file));
    }

    setError(null);
    setSelectedFiles(nextFiles);
    setPreviewImages(nextPreviews);
  };

  const removeImage = (index) => {
    const previewToRevoke = previewImages[index];
    if (previewToRevoke) {
      URL.revokeObjectURL(previewToRevoke);
    }

    setSelectedFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    setPreviewImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const uploadImages = async () => {
    if (selectedFiles.length === 0) {
      throw new Error('Please upload at least one part image.');
    }

    const uploadFormData = new FormData();
    selectedFiles.forEach((file) => uploadFormData.append('images', file));

    const response = await apiClient.post('/api/upload-images', uploadFormData);
    return response.urls || [];
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!user) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const imageUrls = await uploadImages();
      const payload = {
        name: formData.name.trim(),
        part_type: formData.part_type,
        condition: formData.condition,
        compatible_makes: parsedCompatibility.makes,
        compatible_models: parsedCompatibility.models,
        compatible_years: formData.compatible_years === 'Any' ? [] : [formData.compatible_years],
        price: Number(formData.price),
        location: formData.location.trim(),
        area: formData.location.trim(),
        emirate: formData.emirate,
        contact_number: `${formData.country_code}${formData.contact_number.trim()}`,
        country_code: formData.country_code,
        description: formData.description.trim(),
        is_negotiable: formData.is_negotiable,
        is_dealer: formData.is_dealer,
        images: imageUrls,
      };

      await apiClient.post('/api/parts', payload);
      setSuccess(true);

      setTimeout(() => {
        navigate('/my-listings');
      }, 1800);
    } catch (submissionError) {
      setError(submissionError.response?.data?.error || submissionError.message || 'Failed to submit car part listing.');
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

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your car part listing has been submitted and is pending approval.</p>
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
            <h1 className="post-hero-title">List Parts In The Same Premium System</h1>
            <p className="post-hero-subtitle">
              The parts flow now follows the same structure as the car form and uses the field names the backend `car_parts` endpoint actually stores.
            </p>
          </div>
          <div className="post-hero-image">
            <img src={HERO_IMAGE} alt="Automotive parts listing" />
          </div>
        </div>
      </section>

      <section className="post-form-section">
        <div className="form-container">
          {error && <div className="form-error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="post-form">
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
                    <label htmlFor="name">Part name</label>
                    <input id="name" name="name" value={formData.name} onChange={handleChange} required placeholder="OEM LED headlight assembly" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="part_type">Part type</label>
                    <select id="part_type" name="part_type" value={formData.part_type} onChange={handleChange} required>
                      <option value="">Select part type</option>
                      {PART_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="condition">Condition</label>
                    <select id="condition" name="condition" value={formData.condition} onChange={handleChange}>
                      <option value="New">New</option>
                      <option value="Like New">Like New</option>
                      <option value="Used">Used</option>
                      <option value="Refurbished">Refurbished</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="price">Price (AED)</label>
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
                    <select id="compatible_years" name="compatible_years" value={formData.compatible_years} onChange={handleChange}>
                      {COMPATIBLE_YEAR_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="is_negotiable">Negotiable price</label>
                    <select
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
                    </select>
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
                    <select id="emirate" name="emirate" value={formData.emirate} onChange={handleChange}>
                      <option value="Abu Dhabi">Abu Dhabi</option>
                      <option value="Dubai">Dubai</option>
                      <option value="Sharjah">Sharjah</option>
                      <option value="Ajman">Ajman</option>
                      <option value="Umm Al Quwain">Umm Al Quwain</option>
                      <option value="Ras Al Khaimah">Ras Al Khaimah</option>
                      <option value="Fujairah">Fujairah</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="location">Area / location</label>
                    <input id="location" name="location" value={formData.location} onChange={handleChange} required placeholder="Al Quoz, Dubai" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="country_code">Country code</label>
                    <select id="country_code" name="country_code" value={formData.country_code} onChange={handleChange}>
                      {COUNTRY_CODES.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="contact_number">Phone number</label>
                    <input id="contact_number" name="contact_number" value={formData.contact_number} onChange={handleChange} required placeholder="501234567" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="is_dealer">Dealer listing</label>
                    <select
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
                    </select>
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
                  </div>
                </div>
              </div>
            </div>

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Gallery</h2>
                <p className="form-section-desc">
                  Upload clear part photos from multiple angles. These are uploaded first, then the returned URLs are stored in `part_images`.
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
                    processFiles(Array.from(event.dataTransfer.files));
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                >
                  <div className="upload-icon-wrapper">
                    <span className="material-symbols-outlined">upload</span>
                  </div>
                  <p className="upload-text-main">Drop part photos here or click to browse</p>
                  <p className="upload-text-sub">JPG, PNG, WEBP, or GIF up to 5MB each</p>
                  <input
                    ref={fileInputRef}
                    className="file-input"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.gif"
                    multiple
                    onChange={(event) => {
                      processFiles(Array.from(event.target.files || []));
                      event.target.value = '';
                    }}
                  />
                </div>

                {previewImages.length > 0 && (
                  <div className="image-previews-grid">
                    {previewImages.map((preview, index) => (
                      <div className="preview-item" key={preview}>
                        <img src={preview} alt={`Part preview ${index + 1}`} />
                        <button type="button" className="remove-btn" onClick={() => removeImage(index)}>
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="form-actions-section">
              <button type="submit" className="submit-btn" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit Part Listing'}
              </button>
              <p>The listing, images, and seller information now follow the backend car-parts schema instead of the older disconnected field set.</p>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
};

export default PostCarParts;
