import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/authService';
import { calculateProfileCompletion, getProfileCompletionColor } from '../utils/profileCompletion';
import '../styles/AccountSettings.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// UAE Emirates list
const UAE_EMIRATES = [
  'Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 
  'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'
];

// Country codes
const COUNTRY_CODES = [
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+973', country: 'Bahrain', flag: '🇧🇭' },
  { code: '+965', country: 'Kuwait', flag: '🇰🇼' },
  { code: '+968', country: 'Oman', flag: '🇴🇲' },
  { code: '+974', country: 'Qatar', flag: '🇶🇦' },
  { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦' },
];

const AccountSettings = () => {
  const { user, updateUser, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [profileCompletion, setProfileCompletion] = useState({ percentage: 0 });
  const fileInputRef = useRef(null);

  // Enhanced profile form state
  const [profileData, setProfileData] = useState({
    // Basic info
    email: '',
    firstName: '',
    lastName: '',
    username: '',
    displayName: '',
    bio: '',
    
    // Contact
    phone: '',
    countryCode: '+971',
    whatsappNumber: '',
    
    // Location
    city: '',
    emirate: '',
    country: 'United Arab Emirates',
    postalCode: '',
    address: '',
    
    // Dealer/Business
    isDealer: false,
    companyName: '',
    companyRegistrationNumber: '',
    tradeLicenseNumber: '',
    taxRegistrationNumber: '',
    
    // Social media
    websiteUrl: '',
    facebookUrl: '',
    instagramUrl: '',
    twitterUrl: '',
    
    // Settings
    emailNotifications: true,
    smsNotifications: true,
    marketingEmails: false,
    
    // Photo
    profilePhotoUrl: ''
  });

  // Password form state
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Profile photo state
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Calculate profile completion whenever user data changes
  useEffect(() => {
    if (user) {
      const completion = calculateProfileCompletion(user);
      setProfileCompletion(completion);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setProfileData({
        email: user.email || '',
        firstName: user.first_name || '',
        lastName: user.last_name || '',
        username: user.username || '',
        displayName: user.display_name || user.displayName || '',
        bio: user.bio || '',
        
        phone: user.phone || '',
        countryCode: user.country_code || '+971',
        whatsappNumber: user.whatsapp_number || '',
        
        city: user.city || '',
        emirate: user.emirate || '',
        country: user.country || 'United Arab Emirates',
        postalCode: user.postal_code || '',
        address: user.address || '',
        
        isDealer: user.is_dealer || false,
        companyName: user.company_name || '',
        companyRegistrationNumber: user.company_registration_number || '',
        tradeLicenseNumber: user.trade_license_number || '',
        taxRegistrationNumber: user.tax_registration_number || '',
        
        websiteUrl: user.website_url || '',
        facebookUrl: user.facebook_url || '',
        instagramUrl: user.instagram_url || '',
        twitterUrl: user.twitter_url || '',
        
        emailNotifications: user.email_notifications !== undefined ? user.email_notifications : true,
        smsNotifications: user.sms_notifications !== undefined ? user.sms_notifications : true,
        marketingEmails: user.marketing_emails || false,
        
        profilePhotoUrl: user.profile_photo_url || user.profilePhotoUrl || ''
      });
      setPhotoPreview(user.profile_photo_url || user.profilePhotoUrl || null);
    }
  }, [user]);

  const handleProfileInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setProfileData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handlePasswordInputChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError('Please select a valid image file');
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        setError('Image size must be less than 5MB');
        return;
      }

      setProfilePhoto(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        setPhotoPreview(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadProfilePhoto = async () => {
    if (!profilePhoto) return null;

    setUploadingPhoto(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      const formData = new FormData();
      formData.append('profile_photo', profilePhoto);

      const response = await fetch(`${API_URL}/api/user/upload-profile-photo`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to upload photo');
      }

      const data = await response.json();
      return data.profile_photo_url;
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setLoading(true);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      let profilePhotoUrl = profileData.profilePhotoUrl;
      if (profilePhoto) {
        profilePhotoUrl = await uploadProfilePhoto();
      }

      const updateData = {
        ...profileData,
        profilePhotoUrl
      };

      const response = await fetch(`${API_URL}/api/user/update-profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update profile');
      }

      const updatedUser = await response.json();
      updateUser(updatedUser);
      
      // Recalculate profile completion
      const newCompletion = calculateProfileCompletion(updatedUser);
      setProfileCompletion(newCompletion);
      
      setMessage(`Profile updated successfully! Your profile is now ${newCompletion.percentage}% complete.`);
      setProfilePhoto(null);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      setError(err.message || 'Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setLoading(true);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      const response = await fetch(`${API_URL}/api/user/update-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          current_password: passwordData.currentPassword,
          new_password: passwordData.newPassword
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to update password');
      }

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setMessage('Password updated successfully');
    } catch (err) {
      console.error('Error updating password:', err);
      setError(err.message || 'Failed to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmDelete = window.confirm(
      'Are you sure you want to delete your account? This action cannot be undone and all your listings will be deleted.'
    );

    if (confirmDelete) {
      setLoading(true);

      try {
        const token = await getAccessToken();
        if (!token) throw new Error('Authentication token not found');

        const response = await fetch(`${API_URL}/api/user/delete-account`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || 'Failed to delete account');
        }

        signOut();
      } catch (err) {
        console.error('Error deleting account:', err);
        setError(err.message || 'Failed to delete account. Please try again.');
        setLoading(false);
      }
    }
  };

  return (
    <div className="account-settings-container">
      <div className="settings-header">
        <h1>Account Settings</h1>
        <p>Manage your profile information and account preferences</p>
        
        {/* Profile Completion Indicator */}
        {profileCompletion.percentage < 100 && (
          <div className="completion-indicator" style={{ marginTop: '15px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: '500' }}>Profile Completion</span>
              <span style={{ 
                fontSize: '14px', 
                fontWeight: 'bold',
                color: getProfileCompletionColor(profileCompletion.percentage)
              }}>
                {profileCompletion.percentage}%
              </span>
            </div>
            <div style={{ 
              width: '100%', 
              height: '8px', 
              backgroundColor: '#e0e0e0', 
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{ 
                width: `${profileCompletion.percentage}%`, 
                height: '100%',
                backgroundColor: getProfileCompletionColor(profileCompletion.percentage),
                transition: 'width 0.3s ease'
              }} />
            </div>
            <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
              {profileCompletion.completedCount} of {profileCompletion.totalFields} fields completed
            </p>
          </div>
        )}
      </div>

      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="settings-tabs">
        <button
          className={`tab-button ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          Profile Information
        </button>
        <button
          className={`tab-button ${activeTab === 'business' ? 'active' : ''}`}
          onClick={() => setActiveTab('business')}
          style={{ display: profileData.isDealer ? 'block' : 'none' }}
        >
          Business Details
        </button>
        <button
          className={`tab-button ${activeTab === 'preferences' ? 'active' : ''}`}
          onClick={() => setActiveTab('preferences')}
        >
          Preferences
        </button>
        <button
          className={`tab-button ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          Security
        </button>
        <button
          className={`tab-button ${activeTab === 'account' ? 'active' : ''}`}
          onClick={() => setActiveTab('account')}
        >
          Account
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'profile' && (
          <div className="tab-content">
            <h2>Profile Information</h2>
            <form onSubmit={handleProfileSubmit} className="profile-form">
              
              {/* Profile Photo */}
              <div className="form-section">
                <h3>Profile Photo</h3>
                <div className="profile-photo-section">
                  <div className="photo-upload-area">
                    <div className="current-photo">
                      {photoPreview ? (
                        <img src={photoPreview} alt="Profile" className="profile-photo-preview" />
                      ) : (
                        <div className="no-photo-placeholder">
                          <span className="photo-icon">📷</span>
                          <span>No photo</span>
                        </div>
                      )}
                    </div>
                    <div className="photo-controls">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handlePhotoSelect}
                        accept="image/*"
                        className="hidden-file-input"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="btn btn-secondary"
                        disabled={uploadingPhoto}
                      >
                        {uploadingPhoto ? 'Uploading...' : 'Change Photo'}
                      </button>
                      {photoPreview && (
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoPreview(null);
                            setProfilePhoto(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="btn btn-outline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="photo-help-text">
                    Upload a profile photo. Accepted formats: JPG, PNG, GIF. Max size: 5MB
                  </p>
                </div>
              </div>

              {/* Personal Information */}
              <div className="form-section">
                <h3>Personal Information</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="firstName">First Name</label>
                    <input
                      type="text"
                      id="firstName"
                      name="firstName"
                      value={profileData.firstName}
                      onChange={handleProfileInputChange}
                      placeholder="Your first name"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="lastName">Last Name</label>
                    <input
                      type="text"
                      id="lastName"
                      name="lastName"
                      value={profileData.lastName}
                      onChange={handleProfileInputChange}
                      placeholder="Your last name"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="email">Email Address</label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={profileData.email}
                      onChange={handleProfileInputChange}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="username">Username</label>
                    <input
                      type="text"
                      id="username"
                      name="username"
                      value={profileData.username}
                      onChange={handleProfileInputChange}
                      placeholder="Choose a unique username"
                      pattern="[a-zA-Z0-9_]+"
                      title="Username can only contain letters, numbers, and underscores"
                    />
                    <small className="form-text">Used for login and display</small>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="displayName">Display Name</label>
                  <input
                    type="text"
                    id="displayName"
                    name="displayName"
                    value={profileData.displayName}
                    onChange={handleProfileInputChange}
                    placeholder="How others will see your name"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="bio">Bio</label>
                  <textarea
                    id="bio"
                    name="bio"
                    value={profileData.bio}
                    onChange={handleProfileInputChange}
                    placeholder="Tell others about yourself..."
                    rows="4"
                    maxLength="500"
                  />
                  <small className="form-text">{profileData.bio.length}/500 characters</small>
                </div>
              </div>

              {/* Contact Information */}
              <div className="form-section">
                <h3>Contact Information</h3>
                <div className="form-group">
                  <label htmlFor="phone">Phone Number</label>
                  <div className="phone-input-group">
                    <select
                      name="countryCode"
                      value={profileData.countryCode}
                      onChange={handleProfileInputChange}
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
                      value={profileData.phone}
                      onChange={handleProfileInputChange}
                      placeholder="50 123 4567"
                      className="phone-number-input"
                    />
                  </div>
                  <small className="form-text">Used for buyer inquiries</small>
                </div>

                <div className="form-group">
                  <label htmlFor="whatsappNumber">WhatsApp Number (Optional)</label>
                  <input
                    type="tel"
                    id="whatsappNumber"
                    name="whatsappNumber"
                    value={profileData.whatsappNumber}
                    onChange={handleProfileInputChange}
                    placeholder="If different from phone number"
                  />
                </div>
              </div>

              {/* Location */}
              <div className="form-section">
                <h3>Emirate & Area</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="emirate">Emirate</label>
                    <select
                      id="emirate"
                      name="emirate"
                      value={profileData.emirate}
                      onChange={handleProfileInputChange}
                    >
                      <option value="">Select Emirate</option>
                      {UAE_EMIRATES.map(emirate => (
                        <option key={emirate} value={emirate}>{emirate}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="city">Area</label>
                    <input
                      type="text"
                      id="city"
                      name="city"
                      value={profileData.city}
                      onChange={handleProfileInputChange}
                      placeholder="Your area (e.g., Dubai Marina, Downtown)"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="address">Address (Optional)</label>
                  <textarea
                    id="address"
                    name="address"
                    value={profileData.address}
                    onChange={handleProfileInputChange}
                    placeholder="Street address"
                    rows="2"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="postalCode">Postal Code (Optional)</label>
                  <input
                    type="text"
                    id="postalCode"
                    name="postalCode"
                    value={profileData.postalCode}
                    onChange={handleProfileInputChange}
                    placeholder="Postal code"
                  />
                </div>
              </div>

              {/* Social Media */}
              <div className="form-section">
                <h3>Social Media & Website</h3>
                <div className="form-group">
                  <label htmlFor="websiteUrl">Website</label>
                  <input
                    type="url"
                    id="websiteUrl"
                    name="websiteUrl"
                    value={profileData.websiteUrl}
                    onChange={handleProfileInputChange}
                    placeholder="https://www.example.com"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="instagramUrl">Instagram</label>
                    <input
                      type="url"
                      id="instagramUrl"
                      name="instagramUrl"
                      value={profileData.instagramUrl}
                      onChange={handleProfileInputChange}
                      placeholder="https://instagram.com/username"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="facebookUrl">Facebook</label>
                    <input
                      type="url"
                      id="facebookUrl"
                      name="facebookUrl"
                      value={profileData.facebookUrl}
                      onChange={handleProfileInputChange}
                      placeholder="https://facebook.com/username"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="twitterUrl">Twitter</label>
                  <input
                    type="url"
                    id="twitterUrl"
                    name="twitterUrl"
                    value={profileData.twitterUrl}
                    onChange={handleProfileInputChange}
                    placeholder="https://twitter.com/username"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || uploadingPhoto}
              >
                {loading ? 'Updating Profile...' : 'Update Profile'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'business' && profileData.isDealer && (
          <div className="tab-content">
            <h2>Business Details</h2>
            <form onSubmit={handleProfileSubmit} className="profile-form">
              <div className="form-section dealer-section">
                <h3>Company Information</h3>
                
                <div className="form-group">
                  <label htmlFor="companyName">Company Name</label>
                  <input
                    type="text"
                    id="companyName"
                    name="companyName"
                    value={profileData.companyName}
                    onChange={handleProfileInputChange}
                    placeholder="Your company or dealership name"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="companyRegistrationNumber">Company Registration Number</label>
                  <input
                    type="text"
                    id="companyRegistrationNumber"
                    name="companyRegistrationNumber"
                    value={profileData.companyRegistrationNumber}
                    onChange={handleProfileInputChange}
                    placeholder="Registration number"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="tradeLicenseNumber">Trade License Number</label>
                  <input
                    type="text"
                    id="tradeLicenseNumber"
                    name="tradeLicenseNumber"
                    value={profileData.tradeLicenseNumber}
                    onChange={handleProfileInputChange}
                    placeholder="Trade license number"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="taxRegistrationNumber">Tax Registration Number (TRN)</label>
                  <input
                    type="text"
                    id="taxRegistrationNumber"
                    name="taxRegistrationNumber"
                    value={profileData.taxRegistrationNumber}
                    onChange={handleProfileInputChange}
                    placeholder="Tax registration number"
                  />
                </div>

                {user?.dealer_verification_requested_at && !user?.dealer_verified && (
                  <div className="verification-notice">
                    <p>⏳ Your dealer verification is pending review.</p>
                    <small>Submitted on {new Date(user.dealer_verification_requested_at).toLocaleDateString()}</small>
                  </div>
                )}

                {user?.dealer_verified && (
                  <div className="verification-notice verified">
                    <p>✓ Your dealer account is verified</p>
                    <small>Verified on {new Date(user.dealer_verified_at).toLocaleDateString()}</small>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? 'Updating...' : 'Update Business Details'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'preferences' && (
          <div className="tab-content">
            <h2>Communication Preferences</h2>
            <form onSubmit={handleProfileSubmit} className="profile-form">
              <div className="form-section">
                <h3>Notifications</h3>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="emailNotifications"
                      checked={profileData.emailNotifications}
                      onChange={handleProfileInputChange}
                    />
                    <span>
                      <strong>Email Notifications</strong>
                      <small>Receive notifications about messages and offers via email</small>
                    </span>
                  </label>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="smsNotifications"
                      checked={profileData.smsNotifications}
                      onChange={handleProfileInputChange}
                    />
                    <span>
                      <strong>SMS Notifications</strong>
                      <small>Receive important updates via SMS</small>
                    </span>
                  </label>

                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="marketingEmails"
                      checked={profileData.marketingEmails}
                      onChange={handleProfileInputChange}
                    />
                    <span>
                      <strong>Marketing Emails</strong>
                      <small>Receive promotional emails and newsletters</small>
                    </span>
                  </label>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Save Preferences'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="tab-content">
            <h2>Password & Security</h2>
            <form onSubmit={handlePasswordSubmit} className="security-form">
              <div className="form-section">
                <h3>Change Password</h3>
                <div className="form-group">
                  <label htmlFor="currentPassword">Current Password</label>
                  <input
                    type="password"
                    id="currentPassword"
                    name="currentPassword"
                    value={passwordData.currentPassword}
                    onChange={handlePasswordInputChange}
                    required
                    minLength="8"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="newPassword">New Password</label>
                  <input
                    type="password"
                    id="newPassword"
                    name="newPassword"
                    value={passwordData.newPassword}
                    onChange={handlePasswordInputChange}
                    required
                    minLength="8"
                  />
                  <small className="form-text">Minimum 8 characters</small>
                </div>

                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm New Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    name="confirmPassword"
                    value={passwordData.confirmPassword}
                    onChange={handlePasswordInputChange}
                    required
                    minLength="8"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>
        )}

        {activeTab === 'account' && (
          <div className="tab-content">
            <h2>Account Management</h2>
            
            <div className="account-info-section">
              <h3>Account Information</h3>
              {user ? (
                <div className="account-details">
                  <div className="info-row">
                    <span className="info-label">Email:</span>
                    <span className="info-value">{user.email}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Account Type:</span>
                    <span className="info-value">
                      {user.is_dealer ? (
                        <>
                          <span className="badge-dealer">Dealer Account</span>
                          {user.dealer_verified && <span className="badge-verified">✓ Verified</span>}
                        </>
                      ) : (
                        <span className="badge-individual">Individual Account</span>
                      )}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">User ID:</span>
                    <span className="info-value user-id">{user.id}</span>
                  </div>
                  {user.created_at && (
                    <div className="info-row">
                      <span className="info-label">Member Since:</span>
                      <span className="info-value">
                        {new Date(user.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <div className="info-row">
                    <span className="info-label">Profile Completion:</span>
                    <span className="info-value">
                      <div className="mini-progress-bar">
                        <div 
                          className="mini-progress-fill" 
                          style={{ width: `${user.profile_completion_percentage || 0}%` }}
                        />
                      </div>
                      {user.profile_completion_percentage || 0}%
                    </span>
                  </div>
                </div>
              ) : (
                <p className="alert alert-warning">No user information available</p>
              )}
            </div>

            <div className="danger-zone">
              <h3>Danger Zone</h3>
              <div className="danger-section">
                <div className="danger-content">
                  <h4>Delete Account</h4>
                  <p>
                    Permanently delete your account and all associated data including listings.
                    This action cannot be undone.
                  </p>
                </div>
                <button
                  onClick={handleDeleteAccount}
                  className="btn btn-danger"
                  disabled={loading}
                >
                  {loading ? 'Processing...' : 'Delete Account'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AccountSettings;
