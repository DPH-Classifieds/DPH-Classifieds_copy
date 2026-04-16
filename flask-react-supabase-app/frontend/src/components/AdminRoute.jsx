import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { useNavigate } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminLayout.css';

const AdminRoute = ({ children }) => {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const response = await apiClient.get('/api/auth/admin-check');
        if (response && response.is_admin === true) {
          setIsAdmin(true);
        } else {
          setError('Access denied');
        }
      } catch (error) {
        console.error('Admin check failed:', error);
        setError('Failed to verify admin access');
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [user]);

  if (loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Verifying admin access...</p>
      </div>
    );
  }

  if (!user || !isAdmin) {
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
