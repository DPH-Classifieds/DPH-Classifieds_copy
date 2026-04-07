import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/AdminTools.css';

const AdminTools = () => {
  const { user, syncWithSupabase } = useAuth();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const makeAdmin = async () => {
    setLoading(true);
    setMessage('');
    setError('');
    setErrorDetails('');
    setShowDetails(false);
    
    try {
      // Call the backend endpoint to make yourself an admin
      const response = await apiClient.post('/api/auth/make-admin');
      
      if (response && response.success) {
        setMessage(response.message || 'You are now an admin. Please refresh the page.');
        
        // Force a sync with Supabase to update the user object
        await syncWithSupabase();
        
        // Reload the page after a short delay
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setError('Response received but admin status was not updated successfully.');
        if (response && response.details) {
          setErrorDetails(JSON.stringify(response.details, null, 2));
        }
      }
    } catch (err) {
      // Handle specific error status codes
      if (err.status === 503) {
        setError('Server connection error: Unable to reach authentication service. Please try again later.');
      } else if (err.status === 401) {
        setError('Authentication error: Your session may have expired. Please log in again.');
      } else if (err.details && err.details.message) {
        setError(`Error: ${err.details.message}`);
      } else {
        setError(`Failed to make you an admin: ${err.message || 'Unknown error'}`);
      }
      
      // Set error details for troubleshooting
      if (err.details) {
        setErrorDetails(JSON.stringify(err.details, null, 2));
      } else if (err.response) {
        setErrorDetails(JSON.stringify(err.response, null, 2));
      } else {
        setErrorDetails(JSON.stringify(err, null, 2));
      }
      
      console.error('Make admin error:', err);
    } finally {
      setLoading(false);
    }
  };

  const refreshUserStatus = async () => {
    setRefreshing(true);
    setMessage('');
    setError('');
    
    try {
      // Force a sync with Supabase to update the user object
      const success = await syncWithSupabase();
      
      if (success) {
        setMessage('User data refreshed successfully!');
        // Wait a moment to show the success message
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        setError('Failed to refresh user data. Please try again.');
      }
    } catch (err) {
      setError(`Error refreshing user data: ${err.message || 'Unknown error'}`);
      console.error('Refresh error:', err);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="admin-tools">
      <div className="admin-tools-shell">
      <h2>Admin Tools</h2>
      
      <div className="admin-tools-card">
        <h3>Your User Information</h3>
        <p><strong>ID:</strong> <span>{user?.id || 'Not available'}</span></p>
        <p><strong>Email:</strong> <span>{user?.email || 'Not available'}</span></p>
        <p><strong>Admin Status:</strong> <span>{user?.is_admin ? 'Yes' : 'No'}</span></p>
        
        <button 
          onClick={refreshUserStatus} 
          disabled={refreshing}
          className="admin-tools-button admin-tools-button-secondary"
        >
          {refreshing ? 'Refreshing...' : 'Refresh User Status'}
        </button>
        
        {message && (
          <div className="admin-tools-alert admin-tools-alert-success">
            {message}
          </div>
        )}
      </div>
      
      {!user?.is_admin && (
        <div className="admin-tools-card">
          <h3>Make Yourself an Admin</h3>
          <p>
            If you're the developer or owner of this application, you can make yourself an admin
            by clicking the button below.
          </p>
          <button 
            onClick={makeAdmin} 
            disabled={loading}
            className="admin-tools-button admin-tools-button-primary"
          >
            {loading ? 'Processing...' : 'Make Me Admin'}
          </button>
          
          {error && (
            <div className="admin-tools-alert admin-tools-alert-error">
              <p>{error}</p>
              
              {errorDetails && (
                <div className="admin-tools-details">
                  <button 
                    onClick={() => setShowDetails(!showDetails)} 
                    className="admin-tools-toggle"
                  >
                    {showDetails ? 'Hide Details' : 'Show Details'}
                  </button>
                  
                  {showDetails && (
                    <pre className="admin-tools-pre">
                      {errorDetails}
                    </pre>
                  )}
                </div>
              )}
              
              <button
                onClick={makeAdmin}
                className="admin-tools-button admin-tools-button-danger"
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Try Again'}
              </button>
            </div>
          )}
        </div>
      )}
      
      {user?.is_admin && (
        <div className="admin-tools-card admin-tools-card-success">
          <p>You already have admin privileges.</p>
          <p>You can now access the Admin Dashboard and manage the application.</p>
          <a 
            href="/admin" 
            className="admin-tools-link"
          >
            Go to Admin Dashboard
          </a>
        </div>
      )}
      </div>
    </div>
  );
};

export default AdminTools; 
