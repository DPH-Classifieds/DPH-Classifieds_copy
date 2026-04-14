import React, { useEffect, useMemo, useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/PostForms.css';
import '../styles/UAELicensePlate.css';
import UAELicensePlate from './UAELicensePlate';

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?auto=format&fit=crop&w=1200&q=80';

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
  const navigate = useNavigate();
  const { user, isLoading, syncWithSupabase } = useAuth();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    city: '',
    code: '',
    digits: '',
    price: '',
    number: '',
    plate_format: 'Any format',
    contact_name: '',
    contact_phone: '',
    description: '',
    is_dealer: false,
  });

  useEffect(() => {
    syncWithSupabase();
  }, [syncWithSupabase]);

  const isUnauthed = !isLoading && !user;
  const codeOptions = useMemo(() => getCodeOptions(formData.city), [formData.city]);

  useEffect(() => {
    if (!formData.city) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      code: codeOptions.includes(prev.code) ? prev.code : '',
    }));
  }, [codeOptions, formData.city]);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    let nextValue = type === 'checkbox' ? checked : value;

    if (name === 'number') {
      nextValue = value.replace(/\D/g, '').slice(0, 5);
    }

    if (name === 'price') {
      nextValue = value === '' ? '' : String(Math.max(0, Number(value)));
    }

    setFormData((prev) => {
      const updated = {
        ...prev,
        [name]: nextValue,
      };

      if (name === 'number' && nextValue) {
        updated.digits = `${nextValue.length}`;
      }

      return updated;
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!user) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const payload = {
        city: formData.city,
        code: formData.code,
        digits: Number(formData.digits),
        price: Number(formData.price),
        number: formData.number.trim(),
        plate_format: formData.plate_format,
        contact_name: formData.contact_name.trim(),
        contact_phone: formData.contact_phone.trim(),
        description: formData.description.trim(),
        is_dealer: formData.is_dealer,
      };

      await apiClient.post('/api/plates', payload);
      setSuccess(true);

      setTimeout(() => {
        navigate('/my-listings');
      }, 1800);
    } catch (submissionError) {
      setError(submissionError.response?.data?.error || submissionError.message || 'Failed to submit plate listing.');
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

  if (success) {
    return (
      <div className="post-form-container success-message">
        <h2>Success!</h2>
        <p>Your license plate listing has been submitted and is pending approval.</p>
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
            <h1 className="post-hero-title">Present Your Plate Like A Premium Asset</h1>
            <p className="post-hero-subtitle">
              This flow now mirrors the car form structure and posts directly to the backend plate endpoint without the old client-side image detour.
            </p>
          </div>
          <div className="post-hero-image">
            <img src={HERO_IMAGE} alt="Premium number plate listing" />
          </div>
        </div>
      </section>

      <section className="post-form-section">
        <div className="form-container">
          {error && <div className="form-error-message">{error}</div>}

          <form onSubmit={handleSubmit} className="post-form">
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
                    <input id="contact_name" name="contact_name" value={formData.contact_name} onChange={handleChange} required placeholder="Full name" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="contact_phone">Contact phone</label>
                    <input id="contact_phone" name="contact_phone" value={formData.contact_phone} onChange={handleChange} required placeholder="+971501234567" />
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
                  </div>
                </div>
              </div>
            </div>

            <div className="form-actions-section">
              <button type="submit" className="submit-btn" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit Plate Listing'}
              </button>
              <p>The listing is sent directly to the backend plate workflow and reviewed before it goes live.</p>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
};

export default PostPlate;
