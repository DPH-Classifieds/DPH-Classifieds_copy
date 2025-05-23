import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/authService';
import '../styles/Profile.css';

const Profile = () => {
  const { user, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [profileData, setProfileData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Fetch extended profile info from the backend if needed
    if (user) {
      fetchProfileData();
    }
  }, [user]);

  const fetchProfileData = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = getAccessToken();
      
      if (!token) {
        throw new Error('Not authenticated');
      }
      
      console.log('Fetching profile data with token');
      const response = await fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/api/user/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Profile fetch error:', response.status, errorData);
        throw new Error(errorData.message || `Failed to fetch profile data: ${response.status}`);
      }

      const data = await response.json();
      console.log('Profile data fetched successfully:', data);
      setProfileData(data);
    } catch (err) {
      console.error('Error fetching profile:', err);
      setError('Could not load profile information. Please try again later.');
    } finally {
      setLoading(false);
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
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <h1 className="section-title">My Profile</h1>
      
      {error && <div className="alert alert-danger">{error}</div>}
      
      {!userData.email ? (
        <div className="alert alert-warning">
          Unable to load profile data. Please try logging in again.
        </div>
      ) : (
        <div className="profile-card">
          <div className="profile-header">
            <div className="profile-avatar-large">
              {userData?.email?.charAt(0).toUpperCase() || '?'}
            </div>
            <div className="profile-basic-info">
              <h2>{userData?.email}</h2>
              <p>Member since {userData?.created_at ? new Date(userData.created_at).toLocaleDateString() : 'N/A'}</p>
            </div>
          </div>
          
          <div className="profile-details">
            <div className="profile-section">
              <h3>Account Information</h3>
              <div className="profile-info-row">
                <div className="profile-info-label">Email</div>
                <div className="profile-info-value">{userData?.email}</div>
              </div>
              
              <div className="profile-info-row">
                <div className="profile-info-label">User ID</div>
                <div className="profile-info-value user-id">{userData?.id}</div>
              </div>
              
              <div className="profile-info-row">
                <div className="profile-info-label">Account Created</div>
                <div className="profile-info-value">
                  {userData?.created_at ? new Date(userData.created_at).toLocaleString() : 'N/A'}
                </div>
              </div>
              
              <div className="profile-info-row">
                <div className="profile-info-label">Last Sign In</div>
                <div className="profile-info-value">
                  {userData?.last_sign_in_at ? new Date(userData.last_sign_in_at).toLocaleString() : 'N/A'}
                </div>
              </div>
            </div>
          </div>
          
          <div className="profile-actions">
            <button onClick={() => navigate('/my-listings')} className="btn btn-primary">
              My Listings
            </button>
            <button onClick={() => navigate('/settings')} className="btn btn-secondary">
              Account Settings
            </button>
            <button onClick={handleSignOut} className="btn btn-danger">
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile; 