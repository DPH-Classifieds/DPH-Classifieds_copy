import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import SearchableSelect from './ui/searchable-select';
import { useAuth } from '../context/AuthContext';
import { getAccessToken, getCurrentUser } from '../utils/authService';
import { calculateProfileCompletion, getProfileCompletionColor } from '../utils/profileCompletion';
import { resolveMediaUrl } from '../utils/media';
import { splitPhoneNumberForInput } from '../utils/countryCodes';
import { checkUsernameAvailability, sanitizeUsernameInput, getUsernameValidationError } from '../utils/usernameAvailability';
import { PROFILE_PHOTO_MAX_BYTES, uploadProfilePhotoDirect } from '../utils/directUpload';
import PhoneVerificationFlow from './PhoneVerificationFlow';
import MarketplaceListingCard from './MarketplaceListingCard';
import LoadingSpinner from './LoadingSpinner';
import UnifiedCropper from './cropper/UnifiedCropper';
import { useSavedListings } from '../context/SavedListingsContext';
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

const buildProfileDataFromUser = (user = {}) => {
  const phoneParts = splitPhoneNumberForInput(user.phone, user.country_code || '+971');
  const whatsappCountryCode = user.whatsapp_number
    ? (user.whatsapp_number.match(/^(\+\d+)/)?.[1] || user.country_code || '+971')
    : (user.country_code || '+971');
  const whatsappParts = splitPhoneNumberForInput(user.whatsapp_number, whatsappCountryCode);

  return {
    email: user.email || '',
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    username: user.username || '',
    displayName: user.display_name || user.displayName || '',
    bio: user.bio || '',
    showUsernameOnListings: Boolean(user.show_username_on_listings),

    phone: phoneParts.phoneNumber,
    countryCode: phoneParts.countryCode,
    whatsappCountryCode: whatsappParts.countryCode,
    whatsappNumber: whatsappParts.phoneNumber,

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

    profilePhotoUrl: user.profile_photo_url || user.profilePhotoUrl || '',
  };
};

const AccountSettings = () => {
  const { user, updateUser, signOut } = useAuth();
  const savedListingsContext = useSavedListings();
  const savedListings = savedListingsContext?.savedListings || [];
  const savedCounts = savedListingsContext?.savedCounts || { total: 0, cars: 0, bikes: 0, parts: 0, plates: 0 };
  const savedLoading = savedListingsContext?.loading || false;
  const refreshSavedListings = savedListingsContext?.refreshSavedListings;
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [profileCompletion, setProfileCompletion] = useState({ percentage: 0 });
  const fileInputRef = useRef(null);
  const docInputRefs = {
    trade_license: useRef(null),
    company_registration: useRef(null),
    tax_registration: useRef(null),
  };
  const [dealerDocuments, setDealerDocuments] = useState([]);
  const [uploadingDocType, setUploadingDocType] = useState(null);
  const [usernameAvailability, setUsernameAvailability] = useState({
    status: 'idle',
    message: '',
    available: null,
  });

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
    whatsappCountryCode: '+971',
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
    showUsernameOnListings: false,
    
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
  // Kept as a setter-only ref so existing onChange/handleCropCancel handlers
  // can still call setCropModalImage(null) without us reading the value
  // anywhere (UnifiedCropper takes the File directly).
  // eslint-disable-next-line no-unused-vars
  const [cropModalImage, setCropModalImage] = useState(null);
  const [pendingProfileFile, setPendingProfileFile] = useState(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [phoneVerificationSession, setPhoneVerificationSession] = useState(null);

  useEffect(() => {
    const requestedTab = String(searchParams.get('tab') || '').toLowerCase();
    const allowedTabs = new Set(['profile', 'business', 'preferences', 'security', 'account', 'favourites']);
    if (requestedTab && allowedTabs.has(requestedTab) && requestedTab !== activeTab) {
      setActiveTab(requestedTab);
    }
  }, [activeTab, searchParams]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', tab);
    setSearchParams(nextParams, { replace: true });
  };

  // Calculate profile completion whenever user data changes
  useEffect(() => {
    if (user) {
      const completion = calculateProfileCompletion(user);
      setProfileCompletion(completion);
    }
  }, [user]);

  const fetchDealerDocuments = useCallback(async () => {
    try {
      const token = await user?.getToken?.();
      if (!token) return;
      const resp = await fetch(`${API_URL}/api/user/dealer-documents`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setDealerDocuments(data.documents || []);
      }
    } catch (err) {
      console.error('Failed to fetch dealer documents:', err);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setProfileData(buildProfileDataFromUser(user));
      setPhotoPreview(resolveMediaUrl(user.profile_photo_url || user.profilePhotoUrl || null));
      fetchDealerDocuments();
    }
  }, [user, fetchDealerDocuments]);

  useEffect(() => {
    if (activeTab === 'favourites' && typeof refreshSavedListings === 'function') {
      refreshSavedListings();
    }
  }, [activeTab, refreshSavedListings]);

  useEffect(() => {
    const username = sanitizeUsernameInput(profileData.username);

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
      return;
    }

    if (username === sanitizeUsernameInput(user?.username)) {
      setUsernameAvailability({
        status: 'available',
        message: 'This is your current username',
        available: true,
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
        const result = await checkUsernameAvailability({
          username,
          excludeUserId: user?.id || '',
        });
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
  }, [profileData.username, user?.id, user?.username]);

  const handleProfileInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (name === 'countryCode') {
      setProfileData(prev => ({
        ...prev,
        countryCode: value,
        whatsappCountryCode: value
      }));
      return;
    }
    
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

      if (file.size > PROFILE_PHOTO_MAX_BYTES) {
        setError('Image size must be less than 5MB');
        return;
      }

      setError(null);
      setPendingProfileFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => {
        setCropModalImage(ev.target.result);
        setShowCropModal(true);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCropComplete = (croppedFile, previewUrl) => {
    setProfilePhoto(croppedFile);
    setPhotoPreview(previewUrl);
    setShowCropModal(false);
    setCropModalImage(null);
  };

  const handleCropCancel = () => {
    setShowCropModal(false);
    setCropModalImage(null);
    setPendingProfileFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadProfilePhoto = async () => {
    if (!profilePhoto) return null;

    setUploadingPhoto(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      const profilePhotoUrl = await uploadProfilePhotoDirect(profilePhoto, { userId: user.id });
      return resolveMediaUrl(profilePhotoUrl);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleDocumentUpload = async (e, documentType) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('Invalid file type. Allowed: JPG, PNG, PDF');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File too large. Maximum size: 10MB');
      return;
    }

    setUploadingDocType(documentType);
    setError(null);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('document_type', documentType);

      const response = await fetch(`${API_URL}/api/user/dealer-documents`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload document');
      }

      setDealerDocuments(data.documents);
      setMessage('Document uploaded successfully');
    } catch (err) {
      setError(err.message || 'Failed to upload document');
    } finally {
      setUploadingDocType(null);
      if (docInputRefs[documentType]?.current) docInputRefs[documentType].current.value = '';
    }
  };

  const handleDocumentDelete = async (documentId) => {
    if (!window.confirm('Are you sure you want to delete this document?')) return;

    try {
      const token = await getAccessToken();
      const response = await fetch(`${API_URL}/api/user/dealer-documents`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ document_id: documentId }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete document');
      }

      setDealerDocuments(data.documents);
      setMessage('Document deleted');
    } catch (err) {
      setError(err.message || 'Failed to delete document');
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    const usernameError = getUsernameValidationError(profileData.username);
    if (usernameError) {
      setError(usernameError);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (usernameAvailability.available === false) {
      setError(usernameAvailability.message || 'This username is taken. Please try something else.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setLoading(true);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication token not found');

      let profilePhotoUrl = profileData.profilePhotoUrl;
      if (profilePhoto) {
        console.log('Uploading profile photo...');
        profilePhotoUrl = await uploadProfilePhoto();
        console.log('Profile photo uploaded:', profilePhotoUrl);
      }

      const phoneParts = splitPhoneNumberForInput(profileData.phone, profileData.countryCode);
      const whatsappParts = splitPhoneNumberForInput(
        profileData.whatsappNumber,
        profileData.whatsappCountryCode,
      );

      const updateData = {
        ...profileData,
        username: sanitizeUsernameInput(profileData.username),
        phone: phoneParts.phoneNumber,
        countryCode: phoneParts.countryCode,
        profilePhotoUrl,
        whatsappCountryCode: whatsappParts.countryCode,
        whatsappNumber: whatsappParts.phoneNumber
          ? `${whatsappParts.countryCode}${whatsappParts.phoneNumber}`
          : ''
      };

      console.log('Sending profile update request with data:', updateData);

      const response = await fetch(`${API_URL}/api/user/update-profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updateData)
      });

      console.log('Profile update response status:', response.status);
      const responseData = await response.json();
      console.log('Profile update response data:', JSON.stringify(responseData, null, 2));

      if (!response.ok) {
        if (responseData.code === 'username_taken') {
          setUsernameAvailability({
            status: 'taken',
            message: responseData.message || 'This username is taken. Please try something else.',
            available: false,
          });
        }
        const errorDetail = responseData.error;
        const errorMsg = typeof errorDetail === 'object' && errorDetail !== null
          ? (errorDetail.message || errorDetail.detail || JSON.stringify(errorDetail))
          : (errorDetail || responseData.message || 'Failed to update profile');
        throw new Error(errorMsg);
      }

      // Handle the response - it might return { message, user } or just the user object
      const updatedUser = responseData.user || responseData;
      
      // Update the auth context with the new user data
      if (updatedUser && updatedUser.id) {
        console.log('Updating user context with:', updatedUser);
        updateUser(updatedUser);
        
        // Update local profile data state
        setProfileData(buildProfileDataFromUser(updatedUser));
        setPhotoPreview(resolveMediaUrl(updatedUser.profile_photo_url || updatedUser.profilePhotoUrl || null));
        
        // Recalculate profile completion
        const newCompletion = calculateProfileCompletion(updatedUser);
        setProfileCompletion(newCompletion);
        
        setMessage(`✓ Profile updated successfully! Your profile is now ${newCompletion.percentage}% complete.`);

        if (responseData.phone_verification_required && responseData.phone_verification) {
          setPhoneVerificationSession({
            verificationId: responseData.phone_verification.verification_id,
            phone: responseData.phone_verification.phone || updatedUser.phone,
            countryCode: updatedUser.country_code || profileData.countryCode || '+971',
            purpose: 'phone_change',
          });
          setMessage('✓ Profile updated successfully. A verification popup has opened to confirm your new phone number.');
        }
      } else {
        setMessage('✓ Profile updated successfully!');
      }
      
      setProfilePhoto(null);
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Scroll to top to show success message
      window.scrollTo({ top: 0, behavior: 'smooth' });
      
    } catch (err) {
      console.error('Error updating profile:', err);
      setError(err.message || 'Failed to update profile. Please try again.');
      // Scroll to top to show error message
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneVerificationSuccess = async () => {
    try {
      const { user: refreshedUser } = await getCurrentUser(true);
      if (refreshedUser && refreshedUser.id) {
        updateUser(refreshedUser);
      }
      setPhoneVerificationSession(null);
      setMessage('✓ Phone number verified successfully.');
    } catch (refreshError) {
      console.error('Failed to refresh user after phone verification:', refreshError);
      setPhoneVerificationSession(null);
      setMessage('✓ Phone number verified successfully.');
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);

    const getPasswordErrors = (value) => {
      const errors = [];
      if (!value) {
        errors.push('Password is required');
        return errors;
      }
      if (value.length < 8) {
        errors.push('Password must be at least 8 characters long');
      }
      if (!/[0-9]/.test(value)) {
        errors.push('Password must include a number');
      }
      if (!/[^a-zA-Z0-9]/.test(value)) {
        errors.push('Password must include a symbol');
      }
      return errors;
    };

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    const passwordErrors = getPasswordErrors(passwordData.newPassword);
    if (passwordErrors.length > 0) {
      setError(passwordErrors.join('. '));
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
      {showCropModal && pendingProfileFile && (
        <UnifiedCropper
          kind="profile"
          images={[pendingProfileFile]}
          isOpen
          onClose={handleCropCancel}
          onComplete={(results) => {
            const cropped = results[0];
            if (cropped) {
              handleCropComplete(cropped.croppedFile, cropped.previewUrl);
            } else {
              handleCropCancel();
            }
          }}
        />
      )}

      <div className="settings-header">
        <h1>Account Settings</h1>
        <p>Manage your profile information and account preferences</p>
        
        {/* Profile Completion Indicator */}
        {profileCompletion.percentage < 100 && (
          <div className="completion-indicator">
            <div className="completion-indicator-head">
              <span>Profile Completion</span>
              <span
                className="completion-indicator-value"
                style={{ color: getProfileCompletionColor(profileCompletion.percentage) }}
              >
                {profileCompletion.percentage}%
              </span>
            </div>
            <div className="mini-progress-bar">
              <div
                className="mini-progress-fill"
                style={{
                  width: `${profileCompletion.percentage}%`,
                  backgroundColor: getProfileCompletionColor(profileCompletion.percentage)
                }}
              />
            </div>
            <p className="completion-indicator-note">
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
          onClick={() => handleTabChange('profile')}
        >
          Profile Information
        </button>
        <button
          className={`tab-button ${activeTab === 'business' ? 'active' : ''}`}
          onClick={() => handleTabChange('business')}
          style={{ display: profileData.isDealer ? 'block' : 'none' }}
        >
          Business Details
        </button>
        <button
          className={`tab-button ${activeTab === 'preferences' ? 'active' : ''}`}
          onClick={() => handleTabChange('preferences')}
        >
          Preferences
        </button>
        <button
          className={`tab-button ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => handleTabChange('security')}
        >
          Security
        </button>
        <button
          className={`tab-button ${activeTab === 'account' ? 'active' : ''}`}
          onClick={() => handleTabChange('account')}
        >
          Account
        </button>
        <button
          className={`tab-button ${activeTab === 'favourites' ? 'active' : ''}`}
          onClick={() => handleTabChange('favourites')}
        >
          Favourites
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
                          <span className="photo-icon" aria-hidden="true"></span>
                          <span>No photo</span>
                        </div>
                      )}
                    </div>
                    <div className="photo-controls">
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handlePhotoSelect}
                        accept=".jpg,.jpeg,.png,.webp,.gif"
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
                    {usernameAvailability.message && (
                      <small
                        className={`form-text ${
                          usernameAvailability.available === false ? 'field-error' : ''
                        }`}
                      >
                        {usernameAvailability.message}
                      </small>
                    )}
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
                    <SearchableSelect
                      name="countryCode"
                      value={profileData.countryCode}
                      onChange={handleProfileInputChange}
                      className="country-code-select"
                    >
                      {COUNTRY_CODES.map(({ code, country }) => (
                        <option key={code} value={code}>
                          {code} ({country})
                        </option>
                      ))}
                    </SearchableSelect>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      value={profileData.phone}
                      onChange={handleProfileInputChange}
                      placeholder="501234567"
                      className="phone-number-input"
                    />
                  </div>
                  <div className="phone-field-meta">
                    <small className="form-text">Choose your country code, then enter the local number without spaces or dashes.</small>
                    <span className={`phone-status-pill ${user?.phone_verified ? 'is-verified' : 'needs-verification'}`}>
                      {user?.phone_verified ? 'Phone verified' : 'Phone needs verification'}
                    </span>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="whatsappNumber">WhatsApp Number (Optional)</label>
                  <div className="phone-input-group">
                    <SearchableSelect
                      id="whatsappCountryCode"
                      name="whatsappCountryCode"
                      className="country-code-select"
                      value={profileData.whatsappCountryCode}
                      onChange={handleProfileInputChange}
                    >
                      {COUNTRY_CODES.map((country) => (
                        <option key={country.code} value={country.code}>
                          {country.code}
                        </option>
                      ))}
                    </SearchableSelect>
                    <input
                      type="tel"
                      id="whatsappNumber"
                      name="whatsappNumber"
                      value={profileData.whatsappNumber}
                      onChange={handleProfileInputChange}
                      placeholder="501234567"
                      className="phone-number-input"
                    />
                  </div>
                  <small className="form-text">Leave this blank if WhatsApp uses the same number as your phone.</small>
                </div>
              </div>

              {/* Location */}
              <div className="form-section">
                <h3>Emirate & Area</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="emirate">Emirate</label>
                    <SearchableSelect
                      id="emirate"
                      name="emirate"
                      value={profileData.emirate}
                      onChange={handleProfileInputChange}
                    >
                      <option value="">Select Emirate</option>
                      {UAE_EMIRATES.map(emirate => (
                        <option key={emirate} value={emirate}>{emirate}</option>
                      ))}
                    </SearchableSelect>
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

            {phoneVerificationSession && (
              <PhoneVerificationFlow
                mode="modal"
                open
                title="Verify your new phone number"
                description="We sent a code to your updated phone number. Enter it to finish the change."
                phone={phoneVerificationSession.phone}
                countryCode={phoneVerificationSession.countryCode}
                purpose={phoneVerificationSession.purpose}
                verificationId={phoneVerificationSession.verificationId}
                onVerified={handlePhoneVerificationSuccess}
                onClose={() => setPhoneVerificationSession(null)}
                autoStart={false}
              />
            )}
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

                <div className="form-group">
                  <label>Required Documents</label>
                  <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
                    Upload all three documents to activate your dealer account. Accepted: JPG, PNG, PDF (max 10MB each).
                  </p>

                  {[
                    { type: 'trade_license', label: 'Trade License', icon: '📋' },
                    { type: 'company_registration', label: 'Company Registration', icon: '🏢' },
                    { type: 'tax_registration', label: 'Tax Registration (TRN)', icon: '🧾' },
                  ].map(({ type, label, icon }) => {
                    const doc = dealerDocuments.find(d => d.document_type === type);
                    const statusColors = {
                      pending: { bg: '#fbbf24', text: '#000', label: 'Pending Review' },
                      approved: { bg: '#22c55e', text: '#000', label: 'Approved' },
                      denied: { bg: '#ef4444', text: '#fff', label: 'Denied' },
                    };
                    const status = doc ? statusColors[doc.status] : null;

                    return (
                      <div
                        key={type}
                        style={{
                          marginBottom: 12,
                          padding: '12px 14px',
                          borderRadius: 10,
                          border: `1px solid ${status ? (doc.status === 'approved' ? 'rgba(34,197,94,0.3)' : doc.status === 'denied' ? 'rgba(239,68,68,0.3)' : 'rgba(251,191,36,0.3)') : 'rgba(255,255,255,0.1)'}`,
                          background: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: doc ? 8 : 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 18 }}>{icon}</span>
                            <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.9)' }}>{label}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {status && (
                              <span style={{
                                fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                                background: status.bg, color: status.text,
                              }}>
                                {status.label}
                              </span>
                            )}
                            <input
                              ref={docInputRefs[type]}
                              type="file"
                              accept=".jpg,.jpeg,.png,.pdf"
                              onChange={(e) => handleDocumentUpload(e, type)}
                              style={{ display: 'none' }}
                            />
                            <button
                              type="button"
                              onClick={() => docInputRefs[type].current?.click()}
                              disabled={uploadingDocType === type}
                              style={{
                                background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)',
                                color: '#a5b4fc', padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                                fontSize: 12, fontWeight: 500,
                              }}
                            >
                              {uploadingDocType === type ? 'Uploading...' : doc ? 'Replace' : 'Upload'}
                            </button>
                          </div>
                        </div>

                        {doc && (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ minWidth: 0 }}>
                              <a
                                href={doc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 12, color: '#8bd6b4', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
                              >
                                {doc.filename}
                              </a>
                              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                                Uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDocumentDelete(doc.id)}
                              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4, fontSize: 13 }}
                            >
                              Remove
                            </button>
                          </div>
                        )}

                        {doc?.status === 'denied' && doc.denial_reason && (
                          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                            <p style={{ margin: 0, fontSize: 12, color: '#fca5a5' }}><strong>Reason:</strong> {doc.denial_reason}</p>
                            {doc.denial_fix && (
                              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#fbbf24' }}><strong>How to fix:</strong> {doc.denial_fix}</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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

              <div className="form-section">
                <h3>Public Listings</h3>
                <div className="checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      name="showUsernameOnListings"
                      checked={profileData.showUsernameOnListings}
                      onChange={handleProfileInputChange}
                    />
                    <span>
                      <strong>Show username instead of full name</strong>
                      <small>When enabled, your listings show only your username as the seller name.</small>
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

        {activeTab === 'favourites' && (
          <div className="tab-content">
            <div className="favourites-header">
              <div>
                <h2>Favourites</h2>
                <p className="favourites-subtitle">Saved listings from across the marketplace.</p>
              </div>
              <div className="favourites-stats">
                <span>{savedCounts.total || 0} saved</span>
              </div>
            </div>

            {savedLoading ? (
              <LoadingSpinner message="Loading favourites..." compact />
            ) : savedListings.length > 0 ? (
              <div className="favourites-grid">
                {savedListings.map((listing) => (
                  <MarketplaceListingCard
                    key={`saved-${listing.listingType || listing.listing_type || 'listing'}-${listing.id}`}
                    item={listing}
                    showMoreLink={false}
                  />
                ))}
              </div>
            ) : (
              <div className="favourites-empty">
                <p>No favourites yet.</p>
                <span>Tap the heart on any listing to save it here.</span>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default AccountSettings;
