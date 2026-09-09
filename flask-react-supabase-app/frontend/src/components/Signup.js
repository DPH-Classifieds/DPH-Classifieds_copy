import { API_BASE_URL as API_URL } from '../utils/apiBase';
import React, { useEffect, useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { DUBAI_AREAS, UAE_EMIRATES } from '../utils/listingConstants';
import { saveAuthData, setAuthHeader } from '../utils/authService';
import { checkUsernameAvailability, sanitizeUsernameInput, getUsernameValidationError } from '../utils/usernameAvailability';
import { signInWithGoogle } from '../utils/supabaseClient';
import { extractFieldsFromFile } from '../utils/dealerDocumentExtractor';
import '../styles/Auth.css';


// Country codes for phone numbers
const COUNTRY_CODES = [
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+973', country: 'Bahrain', flag: '🇧🇭' },
  { code: '+965', country: 'Kuwait', flag: '🇰🇼' },
  { code: '+968', country: 'Oman', flag: '🇴🇲' },
  { code: '+974', country: 'Qatar', flag: '🇶🇦' },
  { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦' },
  { code: '+1', country: 'USA/Canada', flag: '🇺🇸' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+92', country: 'Pakistan', flag: '🇵🇰' }
];

const FILENAME_NOISE_RE = /\b(license|licence|trade|certificate|cert|trn|tax|registration|uae|fta|freezone|dmcc|upload|scan|copy)\b/gi;
const FILENAME_YEAR_SUFFIX_RE = /(?:[_\s-]?(?:19|20)\d{2}(?:[_\s-]\d{2,4})?)+$/;
const FILENAME_PERIOD_SUFFIX_RE = /[_\s-]+\d{2,4}(?:[_\s-]+\d{2,4})?$/;

function stripExtension(name) {
  return String(name || '').replace(/\.[a-z0-9]+$/i, '');
}

function cleanForBusinessField(name) {
  let cleaned = stripExtension(name);
  cleaned = cleaned.replace(FILENAME_YEAR_SUFFIX_RE, '');
  cleaned = cleaned.replace(FILENAME_PERIOD_SUFFIX_RE, '');
  cleaned = cleaned.replace(/[_-]+/g, ' ');
  cleaned = cleaned.replace(/[()[\]]+/g, ' ');
  cleaned = cleaned.replace(FILENAME_NOISE_RE, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

function extractTrnFromFilename(name) {
  const stripped = String(name || '').replace(/[^0-9]/g, '');
  const match = stripped.match(/\d{15}/);
  return match ? match[0] : '';
}

function extractLicenseNumberFromFilename(name) {
  const base = stripExtension(name);
  const matches = base.match(/\d{4,8}/g) || [];
  for (const candidate of matches) {
    if (candidate.length === 15) continue;
    if (/^\d{4}$/.test(candidate) && (candidate.startsWith('19') || candidate.startsWith('20'))) continue;
    return candidate;
  }
  return '';
}

function applyFilenamePrefill(next, currentData, fileKeys) {
  const files = fileKeys
    .map((key) => currentData[key])
    .filter((f) => f && f.name);
  if (files.length === 0) return next;

  if (!next.companyName && currentData.tradeLicenseFile) {
    const candidate = cleanForBusinessField(currentData.tradeLicenseFile.name);
    if (candidate && candidate.length >= 2) next.companyName = candidate;
  }

  if (!next.legalBusinessName && currentData.tradeLicenseFile) {
    const candidate = cleanForBusinessField(currentData.tradeLicenseFile.name);
    if (candidate && candidate.length >= 2) next.legalBusinessName = candidate;
  }

  if (!next.tradeLicenseNumber && currentData.tradeLicenseFile) {
    const candidate = extractLicenseNumberFromFilename(currentData.tradeLicenseFile.name);
    if (candidate) next.tradeLicenseNumber = candidate;
  }

  if (!next.trn) {
    for (const file of files) {
      const candidate = extractTrnFromFilename(file.name);
      if (candidate) {
        next.trn = candidate;
        break;
      }
    }
  }
  return next;
}

async function prefillFromUpload(currentData, fileKeys) {
  const files = fileKeys
    .map((key) => currentData[key])
    .filter((f) => f && f.name);
  let next = { ...currentData };
  next = applyFilenamePrefill(next, currentData, fileKeys);

  for (const file of files) {
    try {
      const extracted = await extractFieldsFromFile(file);
      if (!extracted || typeof extracted !== 'object') continue;
      if (extracted.trn && !next.trn) next.trn = extracted.trn;
      if (extracted.tradeLicenseNumber && !next.tradeLicenseNumber) {
        next.tradeLicenseNumber = extracted.tradeLicenseNumber;
      }
      if (extracted.legalBusinessName && !next.legalBusinessName) {
        next.legalBusinessName = extracted.legalBusinessName;
      }
      if (extracted.companyName && !next.companyName) next.companyName = extracted.companyName;
    } catch (extractError) {
      console.warn('Document field extraction failed', extractError);
    }
  }
  return next;
}

const Signup = () => {
  const location = useLocation();
  const redirectTarget = new URLSearchParams(location.search).get('redirect');
  const safeRedirect = redirectTarget && redirectTarget.startsWith('/') ? redirectTarget : '/';

  const [formData, setFormData] = useState({
    // Basic credentials
    email: '',
    password: '',
    confirmPassword: '',
    
    // Personal information
    firstName: '',
    lastName: '',
    username: '',
    phone: '',
    countryCode: '+971',
    
    // Location
    area: '',
    emirate: '',
    
    // Account type
    isDealer: false,
    companyName: '',
    legalBusinessName: '',
    trn: '',
    tradeLicenseNumber: '',
    tradeLicenseFile: null,
    taxRegistrationFile: null,
    
    // Preferences
    emailNotifications: true,
    smsNotifications: true,
    marketingEmails: false,
    
    // Terms acceptance
    acceptTerms: false,
    acceptPrivacy: false
  });

  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [error, setError] = useState(null);

  // Admin can turn Google sign-in off (public flag); hide the button when so.
  useEffect(() => {
    fetch(`${API_URL}/api/config/google-signin`)
      .then((r) => r.json())
      .then((d) => setGoogleEnabled(Boolean(d.enabled)))
      .catch(() => {}); // on error keep it shown (default true)
  }, []);

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const { error: oauthError } = await signInWithGoogle({ redirectAfter: safeRedirect });
      if (oauthError) throw new Error(oauthError.message || 'Could not start Google sign-up.');
    } catch (err) {
      setError(err.message || 'Could not start Google sign-up. Please try again.');
      setGoogleLoading(false);
    }
  };
  const [successMessage, setSuccessMessage] = useState(null);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, text: '', color: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [passwordChecks, setPasswordChecks] = useState({ length: false, number: false, symbol: false });
  const [fieldErrors, setFieldErrors] = useState({});
  const [allErrors, setAllErrors] = useState([]);
  const [touchedFields, setTouchedFields] = useState({});
  const [usernameAvailability, setUsernameAvailability] = useState({
    status: 'idle',
    message: '',
    available: null,
  });
  const navigate = useNavigate();

  const getPasswordChecks = (password) => ({
    length: password.length >= 8,
    number: /[0-9]/.test(password),
    symbol: /[^a-zA-Z0-9]/.test(password)
  });

  // Calculate password strength
  const calculatePasswordStrength = (password) => {
    let score = 0;
    if (!password) return { score: 0, text: '', color: '' };

    // Length check
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;

    // Character variety
    if (/[0-9]/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;

    // Determine strength text and color
    let text = '';
    let color = '';
    if (score < 2) {
      text = 'Weak';
      color = '#ff4444';
    } else if (score < 3) {
      text = 'Fair';
      color = '#ffaa00';
    } else if (score < 4) {
      text = 'Good';
      color = '#88cc00';
    } else {
      text = 'Strong';
      color = '#00cc44';
    }

    return { score, text, color };
  };

  const validateSingleField = (name, value, data = formData) => {
    if (name === 'firstName' && !value) return 'First name is required';
    if (name === 'lastName' && !value) return 'Last name is required';
    if (name === 'email') {
      if (!value) return 'Email is required';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) return 'Please enter a valid email address';
    }
    if (name === 'password') {
      if (!value) return 'Password is required';
      const checks = getPasswordChecks(value);
      if (!checks.length || !checks.number || !checks.symbol) {
        return 'Password must be 8+ characters and include a number and a symbol';
      }
    }
    if (name === 'confirmPassword') {
      if (!value) return 'Please confirm your password';
      if (value !== data.password) return 'Passwords do not match';
    }
    if (name === 'username') {
      return getUsernameValidationError(value);
    }
    if (name === 'phone' && !value) {
      return 'Phone number is required';
    }
    if (name === 'phone' && value && !/^\d{7,15}$/.test(value.replace(/[\s-]/g, ''))) {
      return 'Please enter a valid phone number';
    }
    if (name === 'companyName' && data.isDealer && !value) {
      return 'Company name is required for dealer accounts';
    }
    if (name === 'legalBusinessName' && data.isDealer) {
      if (!value || String(value).trim().length < 3) {
        return 'Legal business name is required';
      }
    }
    if (name === 'trn' && data.isDealer) {
      if (!value) return 'TRN is required';
      if (!/^\d{15}$/.test(String(value))) return 'TRN must be exactly 15 digits';
    }
    if (['tradeLicenseFile', 'taxRegistrationFile'].includes(name) && data.isDealer) {
      // Optional here on purpose: signup has no session yet, so these files
      // cannot be uploaded. They only drive the client-side field prefill; the
      // real upload happens on /dealer/verification after email confirmation.
      if (!value) return null;
      const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
      if (value && !allowed.includes(value.type)) {
        return 'Document must be a PDF, JPG, or PNG';
      }
      if (value && value.size > 10 * 1024 * 1024) {
        return 'Document must be 10 MB or smaller';
      }
    }
    if (name === 'acceptTerms' && !value) {
      return 'You must accept the Terms of Service to continue';
    }
    if (name === 'acceptPrivacy' && !value) {
      return 'You must accept the Privacy Policy to continue';
    }
    return null;
  };

  useEffect(() => {
    const username = sanitizeUsernameInput(formData.username);

    const usernameError = getUsernameValidationError(username);
    if (usernameError) {
      setUsernameAvailability({
        status: 'idle',
        message: '',
        available: null,
      });
      setError(prev => (
        prev === 'This username is taken. Please try something else.' ? null : prev
      ));
      setFieldErrors(prev => {
        if (!prev.username) return prev;
        const next = { ...prev };
        delete next.username;
        return next;
      });
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setUsernameAvailability({
        status: 'checking',
        message: 'Checking availability...',
        available: null,
      });

      try {
        const result = await checkUsernameAvailability({ username });
        if (!active) return;
        setUsernameAvailability({
          status: result.available ? 'available' : 'taken',
          message: result.message,
          available: result.available,
        });
        if (result.available) {
          setError(prev => (
            prev === 'This username is taken. Please try something else.' ? null : prev
          ));
        }
        if (!result.available) {
          setFieldErrors(prev => ({
            ...prev,
            username: result.message || 'This username is taken. Please try something else.',
          }));
        } else {
          setFieldErrors(prev => {
            const next = { ...prev };
            if (next.username === 'This username is taken. Please try something else.' || next.username === result.message) {
              delete next.username;
            }
            return next;
          });
        }
      } catch (error) {
        if (!active) return;
        setUsernameAvailability({
          status: 'error',
          message: 'Unable to check username right now',
          available: null,
        });
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [formData.username]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;
    const nextData = { ...formData, [name]: newValue };

    // Clear dealer fields if switching from dealer to individual
    if (name === 'isDealer' && !checked) {
      nextData.companyName = '';
      nextData.legalBusinessName = '';
      nextData.trn = '';
      nextData.tradeLicenseNumber = '';
      nextData.tradeLicenseFile = null;
      nextData.taxRegistrationFile = null;
    }

    // TRN: digits only, max 15
    if (name === 'trn') {
      nextData.trn = String(value || '').replace(/\D/g, '').slice(0, 15);
    }

    setFormData(nextData);
    setTouchedFields(prev => ({ ...prev, [name]: true }));

    // Update password strength when password changes
    if (name === 'password') {
      setPasswordChecks(getPasswordChecks(value));
      setPasswordStrength(calculatePasswordStrength(value));
    }

    setFieldErrors(prev => {
      const updatedErrors = { ...prev };

      const currentError = validateSingleField(name, newValue, nextData);
      if (currentError) {
        updatedErrors[name] = currentError;
      } else {
        delete updatedErrors[name];
      }

      // Keep password/confirm-password mismatch in sync as either field changes
      if (name === 'password' || name === 'confirmPassword') {
        const confirmError = validateSingleField('confirmPassword', nextData.confirmPassword, nextData);
        if (confirmError) {
          updatedErrors.confirmPassword = confirmError;
        } else {
          delete updatedErrors.confirmPassword;
        }
      }

      // Re-validate company field when dealer status changes
      if (name === 'isDealer' || name === 'companyName') {
        const companyError = validateSingleField('companyName', nextData.companyName, nextData);
        if (companyError) {
          updatedErrors.companyName = companyError;
        } else {
          delete updatedErrors.companyName;
        }
      }

      const orderedErrors = [
        updatedErrors.firstName,
        updatedErrors.lastName,
        updatedErrors.email,
        updatedErrors.username,
        updatedErrors.phone,
        updatedErrors.password,
        updatedErrors.confirmPassword,
        updatedErrors.companyName,
        updatedErrors.acceptTerms,
        updatedErrors.acceptPrivacy
      ].filter(Boolean);
      setAllErrors(orderedErrors);

      return updatedErrors;
    });
  };

  const validateForm = () => {
    const requiredValidationFields = [
      'firstName',
      'lastName',
      'email',
      'password',
      'confirmPassword',
      'username',
      'phone',
      'companyName',
      ...(formData.isDealer ? ['legalBusinessName', 'trn'] : []),
      'acceptTerms',
      'acceptPrivacy'
    ];

    const newFieldErrors = {};
    requiredValidationFields.forEach((fieldName) => {
      const validationMessage = validateSingleField(fieldName, formData[fieldName], formData);
      if (validationMessage) {
        newFieldErrors[fieldName] = validationMessage;
      }
    });

    const errors = Object.values(newFieldErrors).filter(Boolean);

    setTouchedFields({
      firstName: true,
      lastName: true,
      email: true,
      password: true,
      confirmPassword: true,
      username: true,
      phone: true,
      companyName: true,
      legalBusinessName: true,
      trn: true,
      tradeLicenseFile: true,
      taxRegistrationFile: true,
      acceptTerms: true,
      acceptPrivacy: true
    });
    setFieldErrors(newFieldErrors);
    setAllErrors(errors);

    if (errors.length > 0) {
      setError('Please fix the highlighted fields and try again.');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!validateForm()) {
      return;
    }

    const usernameError = getUsernameValidationError(formData.username);
    if (usernameError) {
      setFieldErrors(prev => ({
        ...prev,
        username: usernameError,
      }));
      setError(usernameError);
      return;
    }

    if (usernameAvailability.available === false) {
      setError(usernameAvailability.message || 'This username is taken. Please try something else.');
      return;
    }

    setLoading(true);

    try {
      const signupData = {
        email: formData.email,
        password: formData.password,
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(safeRedirect)}`,
        firstName: formData.firstName,
        lastName: formData.lastName,
        username: sanitizeUsernameInput(formData.username),
        phone: formData.phone,
        countryCode: formData.countryCode,
        area: formData.area,
        emirate: formData.emirate,
        isDealer: formData.isDealer,
        companyName: formData.companyName,
        legalBusinessName: formData.legalBusinessName,
        trn: formData.trn,
        tradeLicenseNumber: formData.tradeLicenseNumber,
        displayName: formData.firstName && formData.lastName
          ? `${formData.firstName} ${formData.lastName}`
          : formData.username,
        emailNotifications: formData.emailNotifications,
        smsNotifications: formData.smsNotifications,
        marketingEmails: formData.marketingEmails
      };

      const response = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupData),
        credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === 'username_taken') {
          setFieldErrors(prev => ({
            ...prev,
            username: data.message || 'This username is taken. Please try something else.',
          }));
        }
        throw new Error(data.message || 'Signup failed');
      }

      // Save authentication tokens if present in response
      if (data.access_token || data.session?.access_token) {
        const authData = {
          access_token: data.access_token || data.session?.access_token,
          refresh_token: data.refresh_token || data.session?.refresh_token,
          user: data.user || data.session?.user
        };
        saveAuthData(authData);
        setAuthHeader(authData.access_token);
      }

      const verification = data.phone_verification;
      if (verification?.verification_id && verification?.status !== 'failed') {
        navigate('/verify-phone', {
          replace: true,
          state: {
            verificationId: verification.verification_id,
            phone: verification.phone || signupData.phone,
            countryCode: signupData.countryCode,
            purpose: 'signup',
            email: signupData.email,
            redirect: safeRedirect,
          },
        });
        return;
      }

      navigate('/check-email', {
        state: {
          email: signupData.email,
          // Dealers still owe us their documents; land them on the page that
          // can actually take the upload rather than the generic homepage.
          redirect: formData.isDealer ? '/dealer/verification' : safeRedirect,
          isDealer: formData.isDealer,
        },
      });
    } catch (err) {
      setError(err.message || 'Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderFieldError = (fieldName) => {
    if (!touchedFields[fieldName] || !fieldErrors[fieldName]) {
      return null;
    }
    return <div className="field-error">{fieldErrors[fieldName]}</div>;
  };

  return (
    <div className="auth-container">
      <div className="auth-card signup-card">
        <h1 className="auth-title">Create Your Account</h1>
        <p className="auth-subtitle">Join thousands of buyers and sellers</p>

        {successMessage && <div className="auth-success">{successMessage}</div>}

        {googleEnabled && (<>
        <button
          type="button"
          className="auth-button auth-google-button"
          onClick={handleGoogle}
          disabled={googleLoading || loading}
        >
          <svg className="auth-google-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.568 2.684-3.874 2.684-6.615z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
          </svg>
          {googleLoading ? 'Opening Google...' : 'Continue with Google'}
        </button>
        <p className="auth-google-note">After Google sign-up, we still need to verify your phone number.</p>

        <div className="auth-divider-row" aria-hidden="true">
          <span className="auth-divider-line" />
          <span className="auth-divider-label">or use email</span>
          <span className="auth-divider-line" />
        </div>
        </>)}

        <form className="auth-form signup-form" onSubmit={handleSubmit}>
          
          {/* Account Type Selection */}
          <div className="form-section">
            <h3 className="form-section-title">Are you a dealer?</h3>
            <div className="account-type-selector">
              <label className={`account-type-option ${!formData.isDealer ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="isDealer"
                  checked={!formData.isDealer}
                  onChange={() => setFormData(prev => ({ ...prev, isDealer: false }))}
                />
                <div className="option-content">
                  <span className="option-icon" aria-hidden="true"></span>
                  <span className="option-title">No - Individual</span>
                  <span className="option-desc">Personal buyer or seller</span>
                </div>
              </label>
              <label className={`account-type-option ${formData.isDealer ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="isDealer"
                  checked={formData.isDealer}
                  onChange={() => setFormData(prev => ({ ...prev, isDealer: true }))}
                />
                <div className="option-content">
                  <span className="option-icon" aria-hidden="true"></span>
                  <span className="option-title">Yes - Dealer/Business</span>
                  <span className="option-desc">Professional seller</span>
                </div>
              </label>
            </div>
            {formData.isDealer && (
              <div className="dealer-note">
                <strong>Note:</strong> Approved dealers start with a 4-listing limit. After you confirm your email you'll upload your Trade License and TRN certificate on the verification page — PaddleOCR checks both automatically.
              </div>
            )}
          </div>

          {/* Personal Information */}
          <div className="form-section">
            <h3 className="form-section-title">Personal Information</h3>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="firstName">First Name <span className="required">*</span></label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  placeholder="Enter your first name"
                  className={touchedFields.firstName && fieldErrors.firstName ? 'error-input' : ''}
                />
                {renderFieldError('firstName')}
              </div>
              <div className="form-group">
                <label htmlFor="lastName">Last Name <span className="required">*</span></label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                  placeholder="Enter your last name"
                  className={touchedFields.lastName && fieldErrors.lastName ? 'error-input' : ''}
                />
                {renderFieldError('lastName')}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="username">Username <span className="required">*</span></label>
              <input
                type="text"
                id="username"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                required
                placeholder="Choose a unique username"
                pattern="[a-zA-Z0-9_]+"
                title="Username can only contain letters, numbers, and underscores"
                className={touchedFields.username && fieldErrors.username ? 'error-input' : ''}
              />
              {renderFieldError('username')}
              {!fieldErrors.username && usernameAvailability.message && (
                <small
                  className={`form-hint ${
                    usernameAvailability.available === false ? 'field-error' : ''
                  }`}
                >
                  {usernameAvailability.message}
                </small>
              )}
              <small className="form-hint">Used for your public seller identity and account URL</small>
            </div>
          </div>

          {/* Business Information (if dealer) */}
          {formData.isDealer && (
            <div className="form-section dealer-section">
              <h3 className="form-section-title">Business Information</h3>
              <div className="form-group">
                <label htmlFor="companyName">Trading Name <span className="required">*</span></label>
                <input
                  type="text"
                  id="companyName"
                  name="companyName"
                  value={formData.companyName}
                  onChange={handleInputChange}
                  required={formData.isDealer}
                  placeholder="Your dealership name as customers know it"
                  className={touchedFields.companyName && fieldErrors.companyName ? 'error-input' : ''}
                />
                {renderFieldError('companyName')}
              </div>
              <div className="form-group">
                <label htmlFor="legalBusinessName">Legal Business Name <span className="required">*</span></label>
                <input
                  type="text"
                  id="legalBusinessName"
                  name="legalBusinessName"
                  value={formData.legalBusinessName}
                  onChange={handleInputChange}
                  required={formData.isDealer}
                  placeholder="Name as shown on your trade license"
                  className={touchedFields.legalBusinessName && fieldErrors.legalBusinessName ? 'error-input' : ''}
                />
                {renderFieldError('legalBusinessName')}
              </div>
              <div className="form-group">
                <label htmlFor="trn">TRN (Tax Registration Number) <span className="required">*</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{15}"
                  maxLength={15}
                  id="trn"
                  name="trn"
                  value={formData.trn}
                  onChange={handleInputChange}
                  required={formData.isDealer}
                  placeholder="15 digits"
                  className={touchedFields.trn && fieldErrors.trn ? 'error-input' : ''}
                />
                <small className="form-hint">UAE Federal Tax Authority TRN, exactly 15 digits</small>
                {renderFieldError('trn')}
              </div>
              <div className="form-group">
                <label htmlFor="tradeLicenseNumber">Trade License Number</label>
                <input
                  type="text"
                  id="tradeLicenseNumber"
                  name="tradeLicenseNumber"
                  value={formData.tradeLicenseNumber}
                  onChange={handleInputChange}
                  placeholder="Number printed on your trade license"
                />
              </div>
              <div className="form-group">
                <label htmlFor="tradeLicenseFile">Trade License Document <span className="optional-hint">(optional — auto-fills the fields above)</span></label>
                <input
                  type="file"
                  id="tradeLicenseFile"
                  name="tradeLicenseFile"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                    const baseData = { ...formData, tradeLicenseFile: file };
                    const err = validateSingleField('tradeLicenseFile', file, baseData);
                    setTouchedFields((prev) => ({ ...prev, tradeLicenseFile: true }));
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      if (err) next.tradeLicenseFile = err; else delete next.tradeLicenseFile;
                      return next;
                    });
                    setFormData(baseData);
                    prefillFromUpload(baseData, ['tradeLicenseFile']).then((filled) => {
                      setFormData((prev) => {
                        if (prev.tradeLicenseFile !== baseData.tradeLicenseFile) return prev;
                        return filled;
                      });
                    });
                  }}
                  className="upload-card-input"
                />
                <label
                  htmlFor="tradeLicenseFile"
                  className={`upload-card ${formData.tradeLicenseFile ? 'has-file' : ''} ${
                    touchedFields.tradeLicenseFile && fieldErrors.tradeLicenseFile ? 'error' : ''
                  }`}
                >
                  {formData.tradeLicenseFile ? (
                    <>
                      <span className="upload-card-icon" aria-hidden="true">
                        {formData.tradeLicenseFile.type === 'application/pdf' ? 'PDF' : 'IMG'}
                      </span>
                      <span className="upload-card-body">
                        <span className="upload-card-title">{formData.tradeLicenseFile.name}</span>
                        <span className="upload-card-meta">
                          {(formData.tradeLicenseFile.size / (1024 * 1024)).toFixed(2)} MB · Click to replace
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="upload-card-icon" aria-hidden="true">↑</span>
                      <span className="upload-card-body">
                        <span className="upload-card-title">Scan your trade license to auto-fill</span>
                        <span className="upload-card-meta">Read on your device only — upload for verification comes later</span>
                      </span>
                    </>
                  )}
                </label>
                {renderFieldError('tradeLicenseFile')}
              </div>
              <div className="form-group">
                <label htmlFor="taxRegistrationFile">Tax Registration Certificate <span className="optional-hint">(optional — auto-fills the fields above)</span></label>
                <input
                  type="file"
                  id="taxRegistrationFile"
                  name="taxRegistrationFile"
                  accept="application/pdf,image/png,image/jpeg"
                  className="upload-card-input"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                    const baseData = { ...formData, taxRegistrationFile: file };
                    const err = validateSingleField('taxRegistrationFile', file, baseData);
                    setTouchedFields((prev) => ({ ...prev, taxRegistrationFile: true }));
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      if (err) next.taxRegistrationFile = err; else delete next.taxRegistrationFile;
                      return next;
                    });
                    setFormData(baseData);
                    prefillFromUpload(baseData, ['taxRegistrationFile']).then((filled) => {
                      setFormData((prev) => {
                        if (prev.taxRegistrationFile !== baseData.taxRegistrationFile) return prev;
                        return filled;
                      });
                    });
                  }}
                />
                <label
                  htmlFor="taxRegistrationFile"
                  className={`upload-card ${formData.taxRegistrationFile ? 'has-file' : ''} ${
                    touchedFields.taxRegistrationFile && fieldErrors.taxRegistrationFile ? 'error' : ''
                  }`}
                >
                  {formData.taxRegistrationFile ? (
                    <>
                      <span className="upload-card-icon" aria-hidden="true">
                        {formData.taxRegistrationFile.type === 'application/pdf' ? 'PDF' : 'IMG'}
                      </span>
                      <span className="upload-card-body">
                        <span className="upload-card-title">{formData.taxRegistrationFile.name}</span>
                        <span className="upload-card-meta">
                          {(formData.taxRegistrationFile.size / (1024 * 1024)).toFixed(2)} MB · Click to replace
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="upload-card-icon" aria-hidden="true">↑</span>
                      <span className="upload-card-body">
                        <span className="upload-card-title">Scan your TRN certificate to auto-fill</span>
                        <span className="upload-card-meta">Read on your device only — upload for verification comes later</span>
                      </span>
                    </>
                  )}
                </label>
                {renderFieldError('taxRegistrationFile')}
              </div>
            </div>
          )}

          {/* Contact Information */}
          <div className="form-section">
            <h3 className="form-section-title">Contact Information</h3>
            <div className="form-group">
              <label htmlFor="email">Email Address <span className="required">*</span></label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                required
                placeholder="your.email@example.com"
                autoComplete="email"
                className={touchedFields.email && fieldErrors.email ? 'error-input' : ''}
              />
              {renderFieldError('email')}
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone Number <span className="required">*</span></label>
              <div className="phone-input-group">
                <select
                  name="countryCode"
                  value={formData.countryCode}
                  onChange={handleInputChange}
                  className="country-code-select"
                  aria-label="Country code"
                >
                  {COUNTRY_CODES.map(({ code, country, flag }) => (
                    <option key={code} value={code}>
                      {flag} {code} {country}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  required
                  placeholder="501234567"
                  className="phone-number-input"
                />
              </div>
              {renderFieldError('phone')}
              <small className="form-hint">Choose your country code, then enter the local number without spaces or dashes.</small>
            </div>
          </div>

          {/* Location */}
          <div className="form-section">
            <h3 className="form-section-title">Location</h3>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="emirate">Emirate</label>
                <SearchableSelect
                  id="emirate"
                  name="emirate"
                  value={formData.emirate}
                  onChange={handleInputChange}
                >
                  <option value="">Select Emirate</option>
                  {UAE_EMIRATES.map(emirate => (
                    <option key={emirate} value={emirate}>{emirate}</option>
                  ))}
                </SearchableSelect>
              </div>
              <div className="form-group">
                <label htmlFor="area">Area</label>
                {formData.emirate === 'Dubai' ? (
                  <SearchableSelect
                    id="area"
                    name="area"
                    value={formData.area}
                    onChange={handleInputChange}
                  >
                    <option value="">Select Dubai Area</option>
                    {DUBAI_AREAS.map((area) => (
                      <option key={area} value={area}>{area}</option>
                    ))}
                  </SearchableSelect>
                ) : (
                  <input
                    type="text"
                    id="area"
                    name="area"
                    value={formData.area}
                    onChange={handleInputChange}
                    placeholder="Your Area"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Password Section */}
          <div className="form-section">
            <h3 className="form-section-title">Security</h3>
            <div className="form-group">
              <label htmlFor="password">Password <span className="required">*</span></label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  minLength="8"
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                  className={fieldErrors.password ? 'error-input' : ''}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {renderFieldError('password')}
              {formData.password && (
                <>
                  <div className="password-checklist">
                    <div className={`check-item ${passwordChecks.length ? 'met' : ''}`}>
                      <span className="check-box">{passwordChecks.length ? '✓' : '○'}</span>
                      8+ characters
                    </div>
                    <div className={`check-item ${passwordChecks.number ? 'met' : ''}`}>
                      <span className="check-box">{passwordChecks.number ? '✓' : '○'}</span>
                      Includes a number
                    </div>
                    <div className={`check-item ${passwordChecks.symbol ? 'met' : ''}`}>
                      <span className="check-box">{passwordChecks.symbol ? '✓' : '○'}</span>
                      Includes a symbol
                    </div>
                  </div>
                  <div className="password-strength">
                    <div className="strength-bar">
                      <div
                        className="strength-fill"
                        style={{
                          width: `${(passwordStrength.score / 4) * 100}%`,
                          backgroundColor: passwordStrength.color
                        }}
                      />
                    </div>
                    <span className="strength-text" style={{ color: passwordStrength.color }}>
                      {passwordStrength.text}
                    </span>
                  </div>
                </>
              )}
              <small className="form-hint">
                Use at least 8 characters with a number and a symbol
              </small>
            </div>
            
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password <span className="required">*</span></label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                required
                minLength="8"
                placeholder="Re-enter your password"
                autoComplete="new-password"
                className={fieldErrors.confirmPassword ? 'error-input' : ''}
              />
              {renderFieldError('confirmPassword')}
            </div>
          </div>

          {/* Preferences */}
          <div className="form-section">
            <h3 className="form-section-title">Communication Preferences</h3>
            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="emailNotifications"
                  checked={formData.emailNotifications}
                  onChange={handleInputChange}
                />
                <span>Email notifications for messages and offers</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="smsNotifications"
                  checked={formData.smsNotifications}
                  onChange={handleInputChange}
                />
                <span>SMS notifications (requires phone number)</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="marketingEmails"
                  checked={formData.marketingEmails}
                  onChange={handleInputChange}
                />
                <span>Promotional emails and newsletter</span>
              </label>
            </div>
          </div>

          {/* Terms and Conditions */}
          <div className="form-section">
            <div className="checkbox-group terms-group">
              <label className="checkbox-label required-checkbox">
                <input
                  type="checkbox"
                  name="acceptTerms"
                  checked={formData.acceptTerms}
                  onChange={handleInputChange}
                  required
                />
                <span>
                  I agree to the <Link to="/terms-of-use" target="_blank">Terms of Service</Link> <span className="required">*</span>
                </span>
              </label>
              {renderFieldError('acceptTerms')}
              <label className="checkbox-label required-checkbox">
                <input
                  type="checkbox"
                  name="acceptPrivacy"
                  checked={formData.acceptPrivacy}
                  onChange={handleInputChange}
                  required
                />
                <span>
                  I agree to the <Link to="/privacy-policy" target="_blank">Privacy Policy</Link> <span className="required">*</span>
                </span>
              </label>
              {renderFieldError('acceptPrivacy')}
            </div>
          </div>
          
          {allErrors.length > 0 && (
            <div className="auth-error bottom-error">
              <strong>Please fix the following errors:</strong>
              <ul>
                {allErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          {error && allErrors.length === 0 && (
            <div className="auth-error bottom-error">{error}</div>
          )}
          
          <button 
            type="submit" 
            className="auth-button primary-button"
            disabled={loading}
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>
        
        <div className="auth-links">
          <span>Already have an account?</span>
          <Link to={safeRedirect ? `/login?redirect=${encodeURIComponent(safeRedirect)}` : '/login'} className="auth-link">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Signup;
