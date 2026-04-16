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
      <div className="stat-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </div>
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
          <h1>Welcome back, {user?.display_name || user?.email || 'Admin'}</h1>
          <p>Here is what is happening with your platform today.</p>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          title="Pending Cars"
          count={stats.pendingCars}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
              <circle cx="7" cy="17" r="2" />
              <path d="M9 17h6" />
              <circle cx="17" cy="17" r="2" />
            </svg>
          }
          path="/admin/listings?filter=cars"
          color="#8bd6b4"
        />
        <StatCard
          title="Pending Parts"
          count={stats.pendingParts}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
          path="/admin/listings?filter=parts"
          color="#a8b4ac"
        />
        <StatCard
          title="Pending Plates"
          count={stats.pendingPlates}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="3" width="15" height="13" />
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
          }
          path="/admin/listings?filter=plates"
          color="#4caf50"
        />
        <StatCard
          title="Pending Bikes"
          count={stats.pendingBikes}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18.5" cy="17.5" r="3.5" />
              <circle cx="5.5" cy="17.5" r="3.5" />
              <circle cx="15" cy="5" r="1" />
              <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
            </svg>
          }
          path="/admin/listings?filter=bikes"
          color="#ff9800"
        />
        <StatCard
          title="Pending Dealers"
          count={stats.pendingDealers}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          }
          path="/admin/dealers?filter=pending"
          color="#2196f3"
        />
        <StatCard
          title="Total Users"
          count={stats.totalUsers}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
          path="/admin/users"
          color="#8bd6b4"
        />
        <StatCard
          title="Reports"
          count={stats.totalReports}
          icon={
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          }
          path="/admin/reports"
          color="#f44336"
        />
      </div>

      <div className="quick-actions-section">
        <h2>Quick Actions</h2>
        <div className="quick-actions-grid">
          <QuickAction
            title="Manage Listings"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            }
            path="/admin/listings"
            color="#8bd6b4"
          />
          <QuickAction
            title="Manage Dealers"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            }
            path="/admin/dealers"
            color="#4caf50"
          />
          <QuickAction
            title="Manage Users"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
            path="/admin/users"
            color="#a8b4ac"
          />
          <QuickAction
            title="View Reports"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            }
            path="/admin/reports"
            color="#ff9800"
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
