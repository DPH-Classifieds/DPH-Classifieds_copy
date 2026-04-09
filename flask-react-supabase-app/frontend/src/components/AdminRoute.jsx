import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { useNavigate } from 'react-router-dom';
import LoadingSpinner from './LoadingSpinner';

const AdminRoute = ({ children }) => {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const response = await apiClient.get('/api/auth/admin-check');
        if (response && response.is_admin) {
          setIsAdmin(true);
        }
      } catch (error) {
        console.error('Admin check failed:', error);
      } finally {
        setLoading(false);
      }
    };

    checkAdminStatus();
  }, [user]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!user || !isAdmin) {
    return (
      <div className="admin-access-denied">
        <h2>Access Denied</h2>
        <p>You do not have permission to access this page.</p>
        <button onClick={() => navigate('/')}>Return to Home</button>
      </div>
    );
  }

  return children;
};

export default AdminRoute;
