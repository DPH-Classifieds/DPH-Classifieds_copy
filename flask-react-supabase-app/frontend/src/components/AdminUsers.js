import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminOps.css';

const AdminUsers = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/api/admin/users');
        setUsers(Array.isArray(response) ? response : []);
        setError(null);
      } catch (err) {
        setError('Failed to fetch users');
        console.error('Error fetching users:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const handleMakeAdmin = async (userId) => {
    try {
      await apiClient.post(`/api/admin/users/${userId}/make-admin`);
      setSuccess('User has been made an admin successfully');
      const response = await apiClient.get('/api/admin/users');
      setUsers(Array.isArray(response) ? response : []);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to make user admin');
      console.error('Error making user admin:', err);
    }
  };

  const handleRemoveAdmin = async (userId) => {
    try {
      await apiClient.post(`/api/admin/users/${userId}/remove-admin`);
      setSuccess('Admin privileges removed successfully');
      const response = await apiClient.get('/api/admin/users');
      setUsers(Array.isArray(response) ? response : []);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to remove admin privileges');
      console.error('Error removing admin:', err);
    }
  };

  const handleStatusChange = async (userId, nextStatus) => {
    try {
      await apiClient.patch(`/api/admin/users/${userId}/status`, { status: nextStatus });
      const response = await apiClient.get('/api/admin/users');
      setUsers(Array.isArray(response) ? response : []);
      setSuccess(`User ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'} successfully`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to update user status');
      console.error('Error updating user status:', err);
    }
  };

  const filteredUsers = users.filter(u => {
    const searchLower = searchQuery.toLowerCase();
    return (
      u.email?.toLowerCase().includes(searchLower) ||
      u.first_name?.toLowerCase().includes(searchLower) ||
      u.last_name?.toLowerCase().includes(searchLower) ||
      u.username?.toLowerCase().includes(searchLower) ||
      u.display_name?.toLowerCase().includes(searchLower)
    );
  });

  const userSummary = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.is_admin).length;
    const dealers = users.filter((u) => u.is_dealer).length;
    const suspended = users.filter((u) => (u.account_status || 'active') === 'suspended' || (u.account_status || 'active') === 'banned').length;
    const verified = users.filter((u) => u.email_verified && u.phone_verified).length;
    return { total, admins, dealers, suspended, verified };
  }, [users]);

  const getDisplayName = (u) => {
    if (u.display_name) return u.display_name;
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`;
    if (u.first_name) return u.first_name;
    if (u.username) return u.username;
    return u.email;
  };

  const getInitials = (u) => {
    if (u.first_name && u.last_name) {
      return `${u.first_name[0]}${u.last_name[0]}`.toUpperCase();
    }
    if (u.first_name) return u.first_name[0].toUpperCase();
    if (u.username) return u.username[0].toUpperCase();
    if (u.email) return u.email[0].toUpperCase();
    return 'U';
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Loading users...</p>
      </div>
    );
  }

  return (
    <div className="admin-ops admin-page admin-users">
      <div className="admin-page-header">
        <div>
          <div className="admin-label">People</div>
          <h1 className="admin-page-title">User intelligence and moderation</h1>
          <p className="admin-page-subtitle">Search every account, inspect verification status, and jump into a deep user profile with listing and activity context.</p>
        </div>
        <div className="admin-actions">
          <span className="admin-status-pill tone-success">{userSummary.verified} verified</span>
          <span className="admin-status-pill tone-warning">{userSummary.suspended} restricted</span>
          <span className="admin-status-pill">{userSummary.dealers} dealers</span>
        </div>
      </div>
      <div className="admin-kpi-grid" style={{ marginBottom: '18px' }}>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total users</div>
          <div className="admin-kpi-value">{userSummary.total}</div>
          <div className="admin-kpi-note">All user records in the platform.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Admins</div>
          <div className="admin-kpi-value">{userSummary.admins}</div>
          <div className="admin-kpi-note">Accounts with admin privileges.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Dealers</div>
          <div className="admin-kpi-value">{userSummary.dealers}</div>
          <div className="admin-kpi-note">Accounts flagged as dealers.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Restricted</div>
          <div className="admin-kpi-value">{userSummary.suspended}</div>
          <div className="admin-kpi-note">Suspended or banned accounts.</div>
        </div>
      </div>

      <div className="admin-surface">
        <h2 style={{ marginTop: 0 }}>Search users</h2>
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        <div className="search-section" style={{ marginTop: '16px' }}>
        <input
          type="text"
          placeholder="Search users by name, email, or username..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        <span className="user-count">{filteredUsers.length} users found</span>
      </div>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="empty-state admin-section">
          <h2>No users found</h2>
          <p>Try adjusting your search query</p>
        </div>
      ) : (
        <div className="users-grid admin-section">
          {filteredUsers.map((u) => (
            <div key={u.id} className="user-card">
              <div className="user-header">
                <div className="user-avatar">
                  {u.profile_photo_url ? (
                    <img src={u.profile_photo_url} alt={getDisplayName(u)} />
                  ) : (
                    <div className="avatar-placeholder">{getInitials(u)}</div>
                  )}
                </div>
                <div className="user-info">
                  <h3>{getDisplayName(u)}</h3>
                  <p>{u.email}</p>
                  <p className="user-joined">Joined: {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}</p>
                </div>
              </div>
              
              <div className="user-status">
                <span className={`status-badge status-${u.account_status || 'active'}`}>
                  {u.account_status || 'active'}
                </span>
                {u.is_admin && (
                  <span className="status-badge status-admin">Admin</span>
                )}
              </div>

              <div className="user-actions">
                <button
                  className="action-button view-btn"
                  onClick={() => navigate(`/admin/users/${u.id}`)}
                >
                  View Details
                </button>
                {u.is_admin ? (
                  <button
                    className="action-button secondary"
                    onClick={() => handleRemoveAdmin(u.id)}
                    disabled={u.id === user?.id}
                    title={u.id === user?.id ? "Cannot remove your own admin status" : ""}
                  >
                    Remove Admin
                  </button>
                ) : (
                  <button
                    className="action-button approve-btn"
                    onClick={() => handleMakeAdmin(u.id)}
                  >
                    Make Admin
                  </button>
                )}
                <button
                  className={`action-button ${(u.account_status || 'active') === 'suspended' ? 'approve-btn' : 'reject-btn'}`}
                  onClick={() => handleStatusChange(u.id, (u.account_status || 'active') === 'suspended' ? 'active' : 'suspended')}
                  disabled={u.id === user?.id}
                  title={u.id === user?.id ? "Cannot suspend your own account" : ""}
                >
                  {(u.account_status || 'active') === 'suspended' ? 'Activate' : 'Suspend'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
};

export default AdminUsers;
