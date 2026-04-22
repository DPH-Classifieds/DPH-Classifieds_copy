import React, { useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import {
  UAE_EMIRATES,
  getAreasForEmirate,
  getYearOptions,
} from '../utils/listingConstants';
import '../styles/PostForms.css';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 10;

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

const HERO_IMAGE = '/images/toplanding.webp';

const PostBike = () => {
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
    is_dealer: false,
    cylinders: '',
    wheels: '2',
    features: [],
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

    if (name === 'features') {
      setFormData((prev) => ({
        ...prev,
        features: checked
          ? [...prev.features, value]
          : prev.features.filter((feature) => feature !== value),
      }));
      return;
    }

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
      throw new Error('Please upload at least one bike image.');
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
        features: formData.features,
        condition: formData.condition,
        vin_number: formData.vin_number.trim().toUpperCase(),
        cylinders: formData.cylinders ? Number(formData.cylinders) : null,
        wheels: formData.wheels ? Number(formData.wheels) : null,
        is_dealer: formData.is_dealer,
        images: imageUrls,
      };

      await apiClient.post('/api/bikes', payload);
      setSuccess(true);

      setTimeout(() => {
        navigate('/my-listings');
      }, 1800);
    } catch (submissionError) {
      setError(submissionError.response?.data?.error || submissionError.message || 'Failed to submit bike listing.');
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

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your bike listing has been submitted and is pending approval.</p>
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
            <h1 className="post-hero-title">Publish A Bike Listing With Confidence</h1>
            <p className="post-hero-subtitle">
              Use the same polished listing flow as the car form. Clean specs, crisp media, and a clear seller story help the right buyer move faster.
            </p>
          </div>
          <div className="post-hero-image">
            <img src={HERO_IMAGE} alt="Premium motorcycle listing" />
          </div>
        </div>
      </section>

      <section className="post-form-section">
        <div className="form-container">
          {error && <div className="form-error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="post-form">
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
                    <label htmlFor="bike_brand">Brand</label>
                    <input id="bike_brand" name="bike_brand" value={formData.bike_brand} onChange={handleChange} required placeholder="Yamaha" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="bike_model">Model</label>
                    <input id="bike_model" name="bike_model" value={formData.bike_model} onChange={handleChange} required placeholder="MT-09" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="year">Year</label>
                    <SearchableSelect id="year" name="year" value={formData.year} onChange={handleChange} required>
                      <option value="">Select Year</option>
                      {yearOptions.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </SearchableSelect>
                  </div>
                  <div className="form-group">
                    <label htmlFor="bike_category">Category</label>
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
                    <label htmlFor="color">Color</label>
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
                    <label htmlFor="engine_capacity">Engine capacity</label>
                    <input id="engine_capacity" name="engine_capacity" value={formData.engine_capacity} onChange={handleChange} required placeholder="890cc" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="mileage">Mileage (km)</label>
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
                    <label htmlFor="price">Price (AED)</label>
                    <input id="price" name="price" type="number" min="0" value={formData.price} onChange={handleChange} required placeholder="25000" />
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
                    <label htmlFor="emirate">Emirate</label>
                    <SearchableSelect id="emirate" name="emirate" value={formData.emirate} onChange={handleChange} required>
                      {UAE_EMIRATES.map((emirate) => (
                        <option key={emirate} value={emirate}>{emirate}</option>
                      ))}
                    </SearchableSelect>
                  </div>
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
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="location">Location Details</label>
                    <input id="location" name="location" value={formData.location} onChange={handleChange} placeholder="Building / Landmark (optional)" />
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

                <div className="form-group">
                  <label htmlFor="description">Description</label>
                  <textarea
                    id="description"
                    name="description"
                    rows="6"
                    value={formData.description}
                    onChange={handleChange}
                    required
                    placeholder="Summarize condition, ownership history, maintenance, upgrades, and why this bike stands out."
                  />
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

            <div className="form-section-layout">
              <div className="form-section-sidebar">
                <h2 className="form-section-title">Gallery</h2>
                <p className="form-section-desc">
                  Upload up to {MAX_IMAGES} sharp photos. The images are stored first, then the returned URLs are written into the bike listing payload.
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
                  <p className="upload-text-main">Drop bike photos here or click to browse</p>
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
                        <img src={preview} alt={`Bike preview ${index + 1}`} />
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
                {isSubmitting ? 'Submitting...' : 'Submit Bike Listing'}
              </button>
              <p>Your listing will be reviewed before it goes live. We keep the data and media pipeline aligned with the backend bike schema.</p>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
};

export default PostBike;
