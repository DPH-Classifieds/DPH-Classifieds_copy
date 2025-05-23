import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';

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
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Admin Tools</h2>
      
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px' }}>
        <h3>Your User Information</h3>
        <p><strong>ID:</strong> {user?.id || 'Not available'}</p>
        <p><strong>Email:</strong> {user?.email || 'Not available'}</p>
        <p><strong>Admin Status:</strong> {user?.is_admin ? 'Yes' : 'No'}</p>
        
        <button 
          onClick={refreshUserStatus} 
          disabled={refreshing}
          style={{
            padding: '8px 15px',
            background: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: refreshing ? 'not-allowed' : 'pointer',
            opacity: refreshing ? 0.7 : 1,
            marginTop: '10px'
          }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh User Status'}
        </button>
        
        {message && (
          <div style={{ marginTop: '10px', padding: '10px', background: '#DFF2BF', color: '#4F8A10', borderRadius: '4px' }}>
            {message}
          </div>
        )}
      </div>
      
      {!user?.is_admin && (
        <div>
          <h3>Make Yourself an Admin</h3>
          <p>
            If you're the developer or owner of this application, you can make yourself an admin
            by clicking the button below.
          </p>
          <button 
            onClick={makeAdmin} 
            disabled={loading}
            style={{
              padding: '10px 15px',
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Processing...' : 'Make Me Admin'}
          </button>
          
          {error && (
            <div style={{ marginTop: '10px', padding: '10px', background: '#FFBABA', color: '#D8000C', borderRadius: '4px' }}>
              <p>{error}</p>
              
              {errorDetails && (
                <div>
                  <button 
                    onClick={() => setShowDetails(!showDetails)} 
                    style={{ 
                      background: 'transparent', 
                      border: 'none', 
                      color: '#D8000C', 
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      padding: '5px 0'
                    }}
                  >
                    {showDetails ? 'Hide Details' : 'Show Details'}
                  </button>
                  
                  {showDetails && (
                    <pre style={{ 
                      background: 'rgba(0,0,0,0.05)', 
                      padding: '10px', 
                      overflow: 'auto',
                      fontSize: '12px',
                      maxHeight: '200px'
                    }}>
                      {errorDetails}
                    </pre>
                  )}
                </div>
              )}
              
              <button
                onClick={makeAdmin}
                style={{
                  marginTop: '10px',
                  padding: '5px 10px',
                  background: '#D8000C',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1
                }}
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Try Again'}
              </button>
            </div>
          )}
        </div>
      )}
      
      {user?.is_admin && (
        <div style={{ marginTop: '10px', padding: '10px', background: '#DFF2BF', color: '#4F8A10', borderRadius: '4px' }}>
          <p>You already have admin privileges.</p>
          <p>You can now access the Admin Dashboard and manage the application.</p>
          <a 
            href="/admin" 
            style={{
              display: 'inline-block',
              marginTop: '10px',
              padding: '8px 15px',
              background: '#4F8A10',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px'
            }}
          >
            Go to Admin Dashboard
          </a>
        </div>
      )}
    </div>
  );
};

export default AdminTools; 