import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminDashboard.css';
import '../styles/AdminUsers.css';

const AdminUsers = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

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
    <div className="admin-users">
      <div className="page-header">
        <h1>User Management</h1>
        <p>Manage user accounts and permissions</p>
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
      </div>

      <div className="search-section">
        <input
          type="text"
          placeholder="Search users by name, email, or username..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
        <span className="user-count">{filteredUsers.length} users found</span>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="empty-state">
          <h2>No users found</h2>
          <p>Try adjusting your search query</p>
        </div>
      ) : (
        <div className="users-grid">
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
                  onClick={() => {
                    setSelectedUser(u);
                    setShowDetailModal(true);
                  }}
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

      {showDetailModal && selectedUser && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>User Details</h2>
              <button
                onClick={() => setShowDetailModal(false)}
                className="close-modal"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="user-detail-header">
                <div className="user-avatar large">
                  {selectedUser.profile_photo_url ? (
                    <img src={selectedUser.profile_photo_url} alt={getDisplayName(selectedUser)} />
                  ) : (
                    <div className="avatar-placeholder">{getInitials(selectedUser)}</div>
                  )}
                </div>
                <div>
                  <h3>{getDisplayName(selectedUser)}</h3>
                  <p>{selectedUser.email}</p>
                </div>
              </div>
              
              <div className="detail-grid">
                <div className="detail-item">
                  <label>User ID</label>
                  <span>{selectedUser.id}</span>
                </div>
                <div className="detail-item">
                  <label>Username</label>
                  <span>{selectedUser.username || 'Not set'}</span>
                </div>
                <div className="detail-item">
                  <label>Phone</label>
                  <span>{selectedUser.phone || 'Not set'}</span>
                </div>
                <div className="detail-item">
                  <label>Location</label>
                  <span>{selectedUser.city || selectedUser.emirate || 'Not set'}</span>
                </div>
                <div className="detail-item">
                  <label>Account Status</label>
                  <span className={`status-badge status-${selectedUser.account_status || 'active'}`}>
                    {selectedUser.account_status || 'active'}
                  </span>
                </div>
                <div className="detail-item">
                  <label>Admin Status</label>
                  <span className={`status-badge ${selectedUser.is_admin ? 'status-admin' : ''}`}>
                    {selectedUser.is_admin ? 'Admin' : 'Regular User'}
                  </span>
                </div>
                <div className="detail-item">
                  <label>Joined</label>
                  <span>{selectedUser.created_at ? new Date(selectedUser.created_at).toLocaleString() : 'N/A'}</span>
                </div>
                <div className="detail-item">
                  <label>Last Login</label>
                  <span>{selectedUser.last_login_at ? new Date(selectedUser.last_login_at).toLocaleString() : 'Never'}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                onClick={() => setShowDetailModal(false)}
                className="action-button secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminUsers;
