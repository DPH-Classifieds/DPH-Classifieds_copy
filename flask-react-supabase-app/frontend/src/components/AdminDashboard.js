import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminDashboard.css';

const AdminDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [stats, setStats] = useState({
    pendingCars: 0,
    pendingParts: 0,
    pendingPlates: 0,
    pendingBikes: 0,
    pendingDealers: 0,
    totalUsers: 0,
    totalReports: 0
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        
        // Fetch all stats in parallel
        const [carsRes, partsRes, platesRes, bikesRes, dealersRes, usersRes, reportsRes] = await Promise.all([
          apiClient.get('/api/admin/approve/cars').catch(() => []),
          apiClient.get('/api/admin/approve/parts').catch(() => []),
          apiClient.get('/api/admin/approve/plates').catch(() => []),
          apiClient.get('/api/admin/approve/bikes').catch(() => []),
          apiClient.get('/api/admin/dealers/pending').catch(() => []),
          apiClient.get('/api/admin/users').catch(() => []),
          apiClient.get('/api/admin/reports').catch(() => [])
        ]);

        setStats({
          pendingCars: Array.isArray(carsRes) ? carsRes.length : 0,
          pendingParts: Array.isArray(partsRes) ? partsRes.length : 0,
          pendingPlates: Array.isArray(platesRes) ? platesRes.length : 0,
          pendingBikes: Array.isArray(bikesRes) ? bikesRes.length : 0,
          pendingDealers: Array.isArray(dealersRes) ? dealersRes.length : 0,
          totalUsers: Array.isArray(usersRes) ? usersRes.length : 0,
          totalReports: Array.isArray(reportsRes) ? reportsRes.length : 0
        });
      } catch (error) {
        console.error('Failed to fetch stats:', error);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const StatCard = ({ title, count, icon, path, color }) => (
    <div
      className="stat-card"
      onClick={() => navigate(path)}
      role="button"
      tabIndex={0}
      style={{ '--card-color': color }}
    >
      <div className="stat-icon" style={{ backgroundColor: `${color}20`, color }}>
        {icon}
      </div>
      <div className="stat-content">
        <div className="stat-count">{count}</div>
        <div className="stat-title">{title}</div>
      </div>
      <div className="stat-arrow">→</div>
    </div>
  );

  const QuickAction = ({ title, icon, path, color }) => (
    <button
      className="quick-action"
      onClick={() => navigate(path)}
      style={{ '--action-color': color }}
    >
      <span className="action-icon">{icon}</span>
      <span className="action-title">{title}</span>
    </button>
  );

  if (loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <div className="header-content">
          <h1>Welcome back, {user?.display_name || user?.email || 'Admin'}!</h1>
          <p>Here's what's happening with your platform today.</p>
        </div>
        {successMessage && (
          <div className="success-message">
            {successMessage}
          </div>
        )}
      </div>

      <div className="stats-grid">
        <StatCard
          title="Pending Cars"
          count={stats.pendingCars}
          icon="🚗"
          path="/admin/listings?filter=cars"
          color="#3b82f6"
        />
        <StatCard
          title="Pending Parts"
          count={stats.pendingParts}
          icon="⚙️"
          path="/admin/listings?filter=parts"
          color="#8b5cf6"
        />
        <StatCard
          title="Pending Plates"
          count={stats.pendingPlates}
          icon="🚙"
          path="/admin/listings?filter=plates"
          color="#10b981"
        />
        <StatCard
          title="Pending Bikes"
          count={stats.pendingBikes}
          icon="🏍️"
          path="/admin/listings?filter=bikes"
          color="#f59e0b"
        />
        <StatCard
          title="Pending Dealers"
          count={stats.pendingDealers}
          icon="🏪"
          path="/admin/dealers?filter=pending"
          color="#ef4444"
        />
        <StatCard
          title="Total Users"
          count={stats.totalUsers}
          icon="👥"
          path="/admin/users"
          color="#06b6d4"
        />
        <StatCard
          title="Reports"
          count={stats.totalReports}
          icon="📋"
          path="/admin/reports"
          color="#ec4899"
        />
      </div>

      <div className="quick-actions-section">
        <h2>Quick Actions</h2>
        <div className="quick-actions-grid">
          <QuickAction
            title="Manage Listings"
            icon="📝"
            path="/admin/listings"
            color="#3b82f6"
          />
          <QuickAction
            title="Manage Dealers"
            icon="🏪"
            path="/admin/dealers"
            color="#10b981"
          />
          <QuickAction
            title="Manage Users"
            icon="👥"
            path="/admin/users"
            color="#8b5cf6"
          />
          <QuickAction
            title="View Reports"
            icon="📋"
            path="/admin/reports"
            color="#f59e0b"
          />
        </div>
      </div>

      <div className="recent-activity-section">
        <h2>Platform Overview</h2>
        <div className="overview-cards">
          <div className="overview-card">
            <h3>Pending Approvals</h3>
            <p className="overview-count">
              {stats.pendingCars + stats.pendingParts + stats.pendingPlates + stats.pendingBikes}
            </p>
            <span className="overview-label">Items waiting for review</span>
          </div>
          <div className="overview-card">
            <h3>Dealer Verifications</h3>
            <p className="overview-count">{stats.pendingDealers}</p>
            <span className="overview-label">Dealers pending verification</span>
          </div>
          <div className="overview-card">
            <h3>User Reports</h3>
            <p className="overview-count">{stats.totalReports}</p>
            <span className="overview-label">Reports to review</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
