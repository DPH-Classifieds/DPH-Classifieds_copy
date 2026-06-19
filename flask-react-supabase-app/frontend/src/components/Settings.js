import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/authService';
import '../styles/Settings.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const Settings = () => {
  const { user, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

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

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    
    // Form validation
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    
    const passwordErrors = getPasswordErrors(newPassword);
    if (passwordErrors.length > 0) {
      setError(passwordErrors.join('. '));
      return;
    }
    
    setLoading(true);
    
    try {
      const token = await getAccessToken();
      
      if (!token) {
        throw new Error('Authentication token not found');
      }
      
      const response = await fetch(`${API_URL}/api/user/update-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to update password');
      }
      
      // Clear form fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
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
        
        if (!token) {
          throw new Error('Authentication token not found');
        }
        
        const response = await fetch(`${API_URL}/api/user/delete-account`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || data.message || 'Failed to delete account');
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
    <div className="settings-container">
      <h1 className="settings-title">Account Settings</h1>
      
      {message && <div className="alert alert-success">{message}</div>}
      {error && <div className="alert alert-danger">{error}</div>}
      
      <section className="settings-section">
        <h2>Account Information</h2>
        {user ? (
          <div className="account-info">
            <p><strong>Email:</strong> {user.email}</p>
            <p><strong>User ID:</strong> {user.id}</p>
            {user.created_at && (
              <p><strong>Member Since:</strong> {new Date(user.created_at).toLocaleDateString()}</p>
            )}
          </div>
        ) : (
          <p className="alert alert-warning">No user information available</p>
        )}
      </section>
      
      <section className="settings-section">
        <h2>Update Password</h2>
        <form onSubmit={handleUpdatePassword} className="settings-form">
          <div className="form-group">
            <label htmlFor="currentPassword">Current Password</label>
            <input
              type="password"
              id="currentPassword"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              minLength="8"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <input
              type="password"
              id="newPassword"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength="8"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
      </section>
      
      <section className="settings-section danger-zone">
        <h2>Danger Zone</h2>
        <p>
          Deleting your account will permanently remove all your data including listings.
          This action cannot be undone.
        </p>
        <button 
          onClick={handleDeleteAccount}
          className="btn btn-danger"
          disabled={loading}
        >
          {loading ? 'Processing...' : 'Delete Account'}
        </button>
      </section>
    </div>
  );
};

export default Settings; 
