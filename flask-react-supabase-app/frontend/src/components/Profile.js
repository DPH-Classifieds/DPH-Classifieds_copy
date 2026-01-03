import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/authService';
import { 
  calculateProfileCompletion, 
  getProfileCompletionColor,
  getProfileCompletionMessage,
  getNextSuggestedField 
} from '../utils/profileCompletion';
import LoadingSpinner from './LoadingSpinner';
import '../styles/Profile.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Profile = () => {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [profileCompletion, setProfileCompletion] = useState({ percentage: 0, missingFields: [] });
  const navigate = useNavigate();

  useEffect(() => {
    // Always fetch fresh profile data when component mounts
    if (user) {
      console.log('Profile component mounted, fetching fresh data for user:', user.id);
      fetchProfileData();
      fetchUserStatistics();
    }
  }, [user, user?.id]); // Re-fetch when user or user.id changes

  // Calculate profile completion whenever userData changes
  useEffect(() => {
    const userData = profileData || user;
    if (userData) {
      const completion = calculateProfileCompletion(userData);
      setProfileCompletion(completion);
      console.log('Profile completion calculated:', completion);
    }
  }, [profileData, user]);

  const fetchProfileData = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = getAccessToken();
      
      if (!token) {
        throw new Error('Not authenticated');
      }
      
      console.log('Fetching fresh profile data with token');
      
      // Add cache-busting parameter to force fresh data
      const timestamp = new Date().getTime();
      const response = await fetch(`${API_URL}/api/user/profile?_t=${timestamp}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Profile fetch error:', response.status, errorData);
        throw new Error(errorData.message || `Failed to fetch profile data: ${response.status}`);
      }

      const data = await response.json();
      console.log('Fresh profile data fetched successfully:', data);
      setProfileData(data);
    } catch (err) {
      console.error('Error fetching profile:', err);
      setError('Could not load profile information. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserStatistics = async () => {
    try {
      const token = getAccessToken();
      if (!token) return;

      const response = await fetch(`${API_URL}/api/user/statistics`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setStatistics(data);
      }
    } catch (err) {
      console.error('Error fetching statistics:', err);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      setError('Failed to sign out. Please try again.');
    }
  };

  // Determine which data source to use (profileData from API or user from context)
  const userData = profileData || user || {};
  
  if (loading) {
    return (
      <LoadingSpinner message="Loading profile..." size="large" />
    );
  }

  const nextField = getNextSuggestedField(profileCompletion.missingFields);

  return (
    <div className="profile-container">
      <div className="profile-header-banner">
        <h1 className="profile-page-title">My Profile</h1>
        <p className="profile-page-subtitle">Manage your account and view your activity</p>
      </div>
      
      {error && <div className="alert alert-danger">{error}</div>}
      
      {!userData.email ? (
        <div className="alert alert-warning">
          Unable to load profile data. Please try logging in again.
        </div>
      ) : (
        <div className="profile-content-wrapper">
          
          {/* Profile Completion Card */}
          {profileCompletion.percentage < 100 && (
            <div className="profile-completion-card">
              <div className="completion-header">
                <h3>Complete Your Profile</h3>
                <span 
                  className="completion-percentage" 
                  style={{ color: getProfileCompletionColor(profileCompletion.percentage) }}
                >
                  {profileCompletion.percentage}% Complete
                </span>
              </div>
              <div className="completion-bar">
                <div 
                  className="completion-fill" 
                  style={{ 
                    width: `${profileCompletion.percentage}%`,
                    backgroundColor: getProfileCompletionColor(profileCompletion.percentage)
                  }}
                />
              </div>
              <p className="completion-message">
                {getProfileCompletionMessage(profileCompletion.percentage)}
              </p>
              {nextField && (
                <p className="next-field-suggestion">
                  <strong>Next:</strong> Add your {nextField.label}
                </p>
              )}
              <div className="completion-stats">
                <span>{profileCompletion.completedCount} of {profileCompletion.totalFields} fields completed</span>
              </div>
              <button 
                onClick={() => navigate('/settings')} 
                className="btn btn-primary btn-sm"
              >
                Complete Profile
              </button>
            </div>
          )}

          {/* Main Profile Card */}
          <div className="profile-card modern-card">
            <div className="profile-header-section">
              <div className="profile-avatar-section">
                {userData?.profile_photo_url ? (
                  <img 
                    src={userData.profile_photo_url} 
                    alt="Profile" 
                    className="profile-avatar-large"
                  />
                ) : (
                  <div className="profile-avatar-large placeholder">
                    {userData?.first_name?.charAt(0)?.toUpperCase() || 
                     userData?.email?.charAt(0).toUpperCase() || '?'}
                  </div>
                )}
                <div className="profile-photo-overlay">
                  <button onClick={() => navigate('/settings')} className="change-photo-btn">
                    Change Photo
                  </button>
                </div>
              </div>
              
              <div className="profile-basic-info">
                <h2 className="profile-name">
                  {userData?.first_name && userData?.last_name
                    ? `${userData.first_name} ${userData.last_name}`
                    : userData?.display_name || userData?.username || userData?.email}
                </h2>
                
                {userData?.username && (
                  <p className="profile-username">@{userData.username}</p>
                )}
                
                <div className="profile-badges">
                  {userData?.email_verified && (
                    <span className="badge badge-verified">✓ Email Verified</span>
                  )}
                  {userData?.phone_verified && (
                    <span className="badge badge-verified">✓ Phone Verified</span>
                  )}
                  {userData?.is_dealer && (
                    <span className={`badge ${userData?.dealer_verified ? 'badge-dealer-verified' : 'badge-dealer'}`}>
                      {userData?.dealer_verified ? 'Verified Dealer' : 'Dealer'}
                    </span>
                  )}
                  {userData?.is_admin && (
                    <span className="badge badge-admin">Admin</span>
                  )}
                </div>

                <p className="member-since">
                  Member since {userData?.created_at ? new Date(userData.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'N/A'}
                </p>
              </div>
            </div>

            {/* Bio Section */}
            {userData?.bio && (
              <div className="profile-bio-section">
                <h3>About</h3>
                <p>{userData.bio}</p>
              </div>
            )}

            {/* Statistics Section */}
            {statistics && (
              <div className="profile-statistics">
                <h3>Activity</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <span className="stat-number">{statistics.total_listings || 0}</span>
                    <span className="stat-label">Total Listings</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-number">{statistics.active_listings || 0}</span>
                    <span className="stat-label">Active</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-number">{statistics.pending_listings || 0}</span>
                    <span className="stat-label">Pending</span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-number">{statistics.total_views || 0}</span>
                    <span className="stat-label">Total Views</span>
                  </div>
                </div>
              </div>
            )}

            {/* Contact Information */}
            <div className="profile-details">
              <div className="profile-section">
                <h3>Contact Information</h3>
                
                <div className="profile-info-row">
                  <div className="profile-info-label">
                    <span className="info-icon" aria-hidden="true"></span>
                    Email
                  </div>
                  <div className="profile-info-value">{userData?.email}</div>
                </div>
                
                {userData?.phone && (
                  <div className="profile-info-row">
                    <div className="profile-info-label">
                      <span className="info-icon" aria-hidden="true"></span>
                      Phone
                    </div>
                    <div className="profile-info-value">
                      {userData?.country_code} {userData?.phone}
                    </div>
                  </div>
                )}

                {(userData?.area || userData?.emirate) && (
                  <div className="profile-info-row">
                    <div className="profile-info-label">
                      <span className="info-icon" aria-hidden="true"></span>
                      Emirate & Area
                    </div>
                    <div className="profile-info-value">
                      {[userData?.emirate, userData?.area, userData?.country].filter(Boolean).join(', ')}
                    </div>
                  </div>
                )}
              </div>

              {/* Business Information (if dealer) */}
              {userData?.is_dealer && (
                <div className="profile-section dealer-info-section">
                  <h3>Business Information</h3>
                  
                  {userData?.company_name && (
                    <div className="profile-info-row">
                      <div className="profile-info-label">
                        <span className="info-icon" aria-hidden="true"></span>
                        Company
                      </div>
                      <div className="profile-info-value">{userData.company_name}</div>
                    </div>
                  )}

                  {userData?.company_registration_number && (
                    <div className="profile-info-row">
                      <div className="profile-info-label">
                        <span className="info-icon" aria-hidden="true"></span>
                        Registration
                      </div>
                      <div className="profile-info-value">{userData.company_registration_number}</div>
                    </div>
                  )}

                  {userData?.trade_license_number && (
                    <div className="profile-info-row">
                      <div className="profile-info-label">
                        <span className="info-icon" aria-hidden="true"></span>
                        Trade License
                      </div>
                      <div className="profile-info-value">{userData.trade_license_number}</div>
                    </div>
                  )}

                  {userData?.dealer_verified && (
                    <div className="profile-info-row">
                      <div className="profile-info-label">
                        <span className="info-icon">✓</span>
                        Verification Status
                      </div>
                      <div className="profile-info-value">
                        <span className="verified-badge">Verified Dealer</span>
                        {userData?.dealer_verified_at && (
                          <small>
                            Verified on {new Date(userData.dealer_verified_at).toLocaleDateString()}
                          </small>
                        )}
                      </div>
                    </div>
                  )}

                  {userData?.is_dealer && !userData?.dealer_verified && userData?.dealer_verification_requested_at && (
                    <div className="verification-pending">
                      <span className="pending-icon">⏳</span>
                      Dealer verification pending
                    </div>
                  )}
                </div>
              )}

              {/* Social Media Links */}
              {(userData?.website_url || userData?.instagram_url || userData?.facebook_url || userData?.twitter_url) && (
                <div className="profile-section">
                  <h3>Online Presence</h3>
                  <div className="social-links">
                    {userData?.website_url && (
                      <a href={userData.website_url} target="_blank" rel="noopener noreferrer" className="social-link">
                        Website
                      </a>
                    )}
                    {userData?.instagram_url && (
                      <a href={userData.instagram_url} target="_blank" rel="noopener noreferrer" className="social-link">
                        Instagram
                      </a>
                    )}
                    {userData?.facebook_url && (
                      <a href={userData.facebook_url} target="_blank" rel="noopener noreferrer" className="social-link">
                        Facebook
                      </a>
                    )}
                    {userData?.twitter_url && (
                      <a href={userData.twitter_url} target="_blank" rel="noopener noreferrer" className="social-link">
                        Twitter
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Account Information */}
              <div className="profile-section">
                <h3>Account Details</h3>
                
                <div className="profile-info-row">
                  <div className="profile-info-label">
                    <span className="info-icon" aria-hidden="true"></span>
                    User ID
                  </div>
                  <div className="profile-info-value user-id">{userData?.id}</div>
                </div>
                
                <div className="profile-info-row">
                  <div className="profile-info-label">
                    <span className="info-icon" aria-hidden="true"></span>
                    Account Created
                  </div>
                  <div className="profile-info-value">
                    {userData?.created_at ? new Date(userData.created_at).toLocaleString() : 'N/A'}
                  </div>
                </div>
                
                {userData?.last_login_at && (
                  <div className="profile-info-row">
                    <div className="profile-info-label">
                      <span className="info-icon" aria-hidden="true"></span>
                      Last Login
                    </div>
                    <div className="profile-info-value">
                      {new Date(userData.last_login_at).toLocaleString()}
                    </div>
                  </div>
                )}

                <div className="profile-info-row">
                  <div className="profile-info-label">
                    <span className="info-icon" aria-hidden="true"></span>
                    Account Status
                  </div>
                  <div className="profile-info-value">
                    <span className={`status-badge status-${userData?.account_status || 'active'}`}>
                      {(userData?.account_status || 'active').charAt(0).toUpperCase() + 
                       (userData?.account_status || 'active').slice(1).replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="profile-actions">
              <button onClick={() => navigate('/my-listings')} className="btn btn-primary">
                My Listings
              </button>
              <button onClick={() => navigate('/post')} className="btn btn-success">
                ➕ Create Listing
              </button>
              <button onClick={() => navigate('/settings')} className="btn btn-secondary">
                ⚙️ Account Settings
              </button>
              <button onClick={handleSignOut} className="btn btn-danger">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
