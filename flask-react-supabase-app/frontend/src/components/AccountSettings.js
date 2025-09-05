import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/authService';
import '../styles/AccountSettings.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const AccountSettings = () => {
  const { user, updateUser, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  // Profile form state
  const [profileData, setProfileData] = useState({
    email: '',
    username: '',
    displayName: '',
    phone: '',
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

  useEffect(() => {
    if (user) {
      setProfileData({
        email: user.email || '',
        username: user.username || '',
        displayName: user.display_name || user.displayName || '',
        phone: user.phone || '',
        profilePhotoUrl: user.profile_photo_url || user.profilePhotoUrl || ''
      });
      setPhotoPreview(user.profile_photo_url || user.profilePhotoUrl || null);
    }
  }, [user]);

  const handleProfileInputChange = (e) => {
    const { name, value } = e.target;
    setProfileData(prev => ({
      ...prev,
      [name]: value
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
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please select a valid image file');
        return;
      }

      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        setError('Image size must be less than 5MB');
        return;
      }

      setProfilePhoto(file);
      
      // Create preview
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

      // Upload photo first if there's a new one
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
      
      // Update the auth context with new user data
      updateUser(updatedUser);
      
      setMessage('Profile updated successfully');
      setProfilePhoto(null); // Clear the selected file
      
      // Reset file input
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

    // Form validation
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

      // Clear form fields
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

        // Sign out user after successful deletion
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
          className={`tab-button ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          Security
        </button>
        <button
          className={`tab-button ${activeTab === 'danger' ? 'active' : ''}`}
          onClick={() => setActiveTab('danger')}
        >
          Account
        </button>
      </div>

      <div className="settings-content">
        {activeTab === 'profile' && (
          <div className="tab-content">
            <h2>Profile Information</h2>
            <form onSubmit={handleProfileSubmit} className="profile-form">
              
              {/* Profile Photo Section */}
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

              {/* Basic Information */}
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
                  <small className="form-text">Used for login and display across the site</small>
                </div>
              </div>

              <div className="form-row">
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
                  <label htmlFor="phone">Phone Number</label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={profileData.phone}
                    onChange={handleProfileInputChange}
                    placeholder="+971 50 123 4567"
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

        {activeTab === 'security' && (
          <div className="tab-content">
            <h2>Password & Security</h2>
            <form onSubmit={handlePasswordSubmit} className="security-form">
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

        {activeTab === 'danger' && (
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
                    <span className="info-label">Username:</span>
                    <span className="info-value">{user.username || 'Not set'}</span>
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
