import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/Auth.css';

// UAE Emirates list
const UAE_EMIRATES = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah'
];

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

const Signup = () => {
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
    Area: '',
    emirate: '',
    
    // Account type
    isDealer: false,
    companyName: '',
    companyRegistrationNumber: '',
    
    // Preferences
    emailNotifications: true,
    smsNotifications: true,
    marketingEmails: false,
    
    // Terms acceptance
    acceptTerms: false,
    acceptPrivacy: false
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [passwordStrength, setPasswordStrength] = useState({ score: 0, text: '', color: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [passwordChecks, setPasswordChecks] = useState({ length: false, number: false, symbol: false });
  const [fieldErrors, setFieldErrors] = useState({});
  const [allErrors, setAllErrors] = useState([]);
  const { signUp } = useAuth();
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

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    const newValue = type === 'checkbox' ? checked : value;

    setFormData(prev => ({
      ...prev,
      [name]: newValue
    }));

    // Clear field-specific error when user starts typing
    if (fieldErrors[name]) {
      setFieldErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }

    // Update password strength when password changes
    if (name === 'password') {
      setPasswordChecks(getPasswordChecks(value));
      setPasswordStrength(calculatePasswordStrength(value));
      
      // Check password match in real-time
      if (formData.confirmPassword && value !== formData.confirmPassword) {
        setFieldErrors(prev => ({
          ...prev,
          confirmPassword: 'Passwords do not match'
        }));
      } else if (formData.confirmPassword) {
        setFieldErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors.confirmPassword;
          return newErrors;
        });
      }
    }

    // Check confirm password match in real-time
    if (name === 'confirmPassword') {
      if (value !== formData.password) {
        setFieldErrors(prev => ({
          ...prev,
          confirmPassword: 'Passwords do not match'
        }));
      } else {
        setFieldErrors(prev => {
          const newErrors = { ...prev };
          delete newErrors.confirmPassword;
          return newErrors;
        });
      }
    }

    // Clear dealer fields if switching from dealer to individual
    if (name === 'isDealer' && !checked) {
      setFormData(prev => ({
        ...prev,
        companyName: '',
        companyRegistrationNumber: ''
      }));
    }
  };

  const validateForm = () => {
    const errors = [];
    const newFieldErrors = {};

    // Required fields
    if (!formData.firstName) {
      errors.push('First name is required');
      newFieldErrors.firstName = 'Required';
    }
    
    if (!formData.lastName) {
      errors.push('Last name is required');
      newFieldErrors.lastName = 'Required';
    }

    if (!formData.email) {
      errors.push('Email is required');
      newFieldErrors.email = 'Required';
    } else {
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email)) {
        errors.push('Please enter a valid email address');
        newFieldErrors.email = 'Invalid email format';
      }
    }

    // Password validation
    if (!formData.password) {
      errors.push('Password is required');
      newFieldErrors.password = 'Required';
    } else {
      const checks = getPasswordChecks(formData.password);
      if (!checks.length || !checks.number || !checks.symbol) {
        errors.push('Password must be 8+ characters and include a number and a symbol');
        newFieldErrors.password = 'Use 8+ chars with number and symbol';
      }
    }

    if (!formData.confirmPassword) {
      errors.push('Please confirm your password');
      newFieldErrors.confirmPassword = 'Required';
    } else if (formData.password !== formData.confirmPassword) {
      errors.push('Passwords do not match');
      newFieldErrors.confirmPassword = 'Passwords do not match';
    }

    // Username validation
    if (formData.username && !/^[a-zA-Z0-9_]+$/.test(formData.username)) {
      errors.push('Username can only contain letters, numbers, and underscores');
      newFieldErrors.username = 'Invalid format';
    }

    // Phone validation
    if (formData.phone && !/^\d{7,15}$/.test(formData.phone.replace(/[\s-]/g, ''))) {
      errors.push('Please enter a valid phone number');
      newFieldErrors.phone = 'Invalid phone number';
    }

    // Dealer validation
    if (formData.isDealer && !formData.companyName) {
      errors.push('Company name is required for dealer accounts');
      newFieldErrors.companyName = 'Required for dealers';
    }

    // Terms acceptance
    if (!formData.acceptTerms) {
      errors.push('You must accept the Terms of Service to continue');
      newFieldErrors.acceptTerms = 'Required';
    }

    if (!formData.acceptPrivacy) {
      errors.push('You must accept the Privacy Policy to continue');
      newFieldErrors.acceptPrivacy = 'Required';
    }

    setFieldErrors(newFieldErrors);
    setAllErrors(errors);

    if (errors.length > 0) {
      setError(`Please fix the following errors: ${errors.join(', ')}`);
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

    setLoading(true);

    try {
      const signupData = {
        email: formData.email,
        password: formData.password,
        redirectTo: `${window.location.origin}/auth/callback`,
        firstName: formData.firstName,
        lastName: formData.lastName,
        username: formData.username,
        phone: formData.phone,
        countryCode: formData.countryCode,
        Area: formData.Area,
        emirate: formData.emirate,
        isDealer: formData.isDealer,
        companyName: formData.companyName,
        companyRegistrationNumber: formData.companyRegistrationNumber,
        displayName: formData.firstName && formData.lastName
          ? `${formData.firstName} ${formData.lastName}`
          : formData.username,
        emailNotifications: formData.emailNotifications,
        smsNotifications: formData.smsNotifications,
        marketingEmails: formData.marketingEmails
      };

      const { data, error } = await signUp(
        signupData.email,
        signupData.password,
        signupData
      );

      if (error) {
        throw new Error(error);
      }

      // Supabase email-confirm flow typically returns user with null session
      if (data?.user && !data?.session) {
        navigate('/check-email', { state: { email: signupData.email } });
        return;
      }

      // If we ever get a session immediately, treat it as full success
      if (data?.user && data?.session) {
        setSuccessMessage('Account created successfully! Redirecting...');
        setTimeout(() => navigate('/profile'), 2000);
        return;
      }

      // Fallback: successful HTTP but unexpected shape — still send to check-email
      navigate('/check-email', { state: { email: signupData.email } });
    } catch (err) {
      console.error('Sign up error:', err);
      setError(err.message || 'Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card signup-card">
        <h1 className="auth-title">Create Your Account</h1>
        <p className="auth-subtitle">Join thousands of buyers and sellers</p>
        
        {successMessage && <div className="auth-success">{successMessage}</div>}
        
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
                <strong>Note:</strong> Dealer accounts require admin verification before full access is granted.
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
                />
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
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="username">Username (Optional)</label>
              <input
                type="text"
                id="username"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                placeholder="Choose a unique username"
                pattern="[a-zA-Z0-9_]+"
                title="Username can only contain letters, numbers, and underscores"
              />
              <small className="form-hint">Used for login and public profile</small>
            </div>
          </div>

          {/* Business Information (if dealer) */}
          {formData.isDealer && (
            <div className="form-section dealer-section">
              <h3 className="form-section-title">Business Information</h3>
              <div className="form-group">
                <label htmlFor="companyName">Company Name <span className="required">*</span></label>
                <input
                  type="text"
                  id="companyName"
                  name="companyName"
                  value={formData.companyName}
                  onChange={handleInputChange}
                  required={formData.isDealer}
                  placeholder="Your company or dealership name"
                />
              </div>
              <div className="form-group">
                <label htmlFor="companyRegistrationNumber">Trade License / Registration Number (Optional)</label>
                <input
                  type="text"
                  id="companyRegistrationNumber"
                  name="companyRegistrationNumber"
                  value={formData.companyRegistrationNumber}
                  onChange={handleInputChange}
                  placeholder="Company registration or trade license number"
                />
                <small className="form-hint">This helps speed up verification</small>
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
              />
            </div>

            <div className="form-group">
              <label htmlFor="phone">Phone Number</label>
              <div className="phone-input-group">
                <select
                  name="countryCode"
                  value={formData.countryCode}
                  onChange={handleInputChange}
                  className="country-code-select"
                >
                  {COUNTRY_CODES.map(({ code, country, flag }) => (
                    <option key={code} value={code}>
                      {flag} {code} ({country})
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="50 123 4567"
                  className="phone-number-input"
                />
              </div>
              <small className="form-hint">Used for buyer inquiries (will be displayed on your listings)</small>
            </div>
          </div>

          {/* Location */}
          <div className="form-section">
            <h3 className="form-section-title">Location</h3>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="emirate">Emirate</label>
                <select
                  id="emirate"
                  name="emirate"
                  value={formData.emirate}
                  onChange={handleInputChange}
                >
                  <option value="">Select Emirate</option>
                  {UAE_EMIRATES.map(emirate => (
                    <option key={emirate} value={emirate}>{emirate}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="Area">Area</label>
                <input
                  type="text"
                  id="Area"
                  name="Area"
                  value={formData.Area}
                  onChange={handleInputChange}
                  placeholder="Your Area"
                />
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
              {fieldErrors.password && (
                <div className="field-error">{fieldErrors.password}</div>
              )}
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
              {fieldErrors.confirmPassword && (
                <div className="field-error">{fieldErrors.confirmPassword}</div>
              )}
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
                  I agree to the <Link to="/terms" target="_blank">Terms of Service</Link> <span className="required">*</span>
                </span>
              </label>
              <label className="checkbox-label required-checkbox">
                <input
                  type="checkbox"
                  name="acceptPrivacy"
                  checked={formData.acceptPrivacy}
                  onChange={handleInputChange}
                  required
                />
                <span>
                  I agree to the <Link to="/privacy" target="_blank">Privacy Policy</Link> <span className="required">*</span>
                </span>
              </label>
            </div>
          </div>
          
          {error && allErrors.length > 0 && (
            <div className="auth-error bottom-error">
              <strong>Please fix the following errors:</strong>
              <ul>
                {allErrors.map((err, index) => (
                  <li key={index}>{err}</li>
                ))}
              </ul>
            </div>
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
          <Link to="/login" className="auth-link">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Signup;
