import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { useNavigate } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminLayout.css';

const AdminRoute = ({ children }) => {
  const { user, isLoading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminStatus = async () => {
      // Wait for auth to load
      if (authLoading) {
        return;
      }

      // If not logged in, redirect to login
      if (!user) {
        console.log('AdminRoute: No user found, redirecting to login');
        navigate('/login', { state: { from: '/admin' } });
        return;
      }

      try {
        console.log('AdminRoute: Checking admin status for user:', user.id);
        const response = await apiClient.get('/api/auth/admin-check');
        console.log('AdminRoute: Admin check response:', response);
        
        if (response && response.is_admin === true) {
          console.log('AdminRoute: User is admin, granting access');
          setIsAdmin(true);
        } else {
          console.log('AdminRoute: User is not admin');
          setError('Access denied - Admin privileges required');
        }
      } catch (error) {
        console.error('AdminRoute: Admin check failed:', error);
        setError('Failed to verify admin access: ' + (error.message || 'Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [user, authLoading, navigate]);

  // Show loading while auth is loading or admin check is in progress
  if (authLoading || loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Verifying admin access...</p>
      </div>
    );
  }

  // If no user, don't render anything (redirect is happening)
  if (!user) {
    return null;
  }

  // If not admin, show access denied
  if (!isAdmin) {
    return (
      <div className="admin-access-denied">
        <div className="access-denied-content">
          <h2>Access Denied</h2>
          <p>You do not have permission to access this page.</p>
          {error && <p className="error-message">{error}</p>}
          <button onClick={() => navigate('/')} className="back-btn">
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return children;
};

export default AdminRoute;
