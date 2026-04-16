import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import '../styles/AdminLayout.css';

const AdminHeader = ({ onToggleSidebar, sidebarOpen }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await apiClient.post('/api/auth/logout');
      logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      // Still clear local state even if API call fails
      logout();
      navigate('/login');
    }
  };

  return (
    <header className="admin-header">
      <div className="header-left">
        <button
          className="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? '◀' : '▶'}
        </button>
        <h1 className="header-title">DPH Classifieds Admin</h1>
      </div>
      <div className="header-right">
        <div className="user-info">
          <span className="user-name">{user?.display_name || user?.email || 'Admin'}</span>
          <button onClick={handleLogout} className="logout-btn">
            Logout
          </button>
        </div>
      </div>
    </header>
  );
};

export default AdminHeader;
