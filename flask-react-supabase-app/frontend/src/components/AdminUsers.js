import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminUsers.css';

const AdminUsers = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/api/admin/users');
        setUsers(response);
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
      setUsers(response);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to make user admin');
      console.error('Error making user admin:', err);
    }
  };

  const handleStatusChange = async (userId, nextStatus) => {
    try {
      await apiClient.patch(`/api/admin/users/${userId}/status`, { status: nextStatus });
      const response = await apiClient.get('/api/admin/users');
      setUsers(response);
      setSuccess(`User ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'} successfully`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to update user status');
      console.error('Error updating user status:', err);
    }
  };

  if (!user || !user.is_admin) {
    return (
      <div className="admin-users">
        <h2>Access Denied</h2>
        <p>You must be an administrator to access this page.</p>
      </div>
    );
  }

  return (
    <div className="admin-users">
      <h1>Admin Users Management</h1>
      <p>Promote trusted members and control account access without leaving the admin workflow.</p>
      
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {loading ? (
        <LoadingSpinner message="Loading users..." size="large" />
      ) : (
        <div className="users-container">
          {users.length === 0 ? (
            <p>No users found</p>
          ) : (
            <table className="users-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Admin Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.id}</td>
                    <td>{user.email}</td>
                    <td>{user.account_status || 'active'}</td>
                    <td>{user.is_admin ? 'Yes' : 'No'}</td>
                    <td>
                      {!user.is_admin && (
                        <div className="admin-users-actions">
                          <button 
                            className="status-btn"
                            onClick={() => handleStatusChange(user.id, (user.account_status || 'active') === 'suspended' ? 'active' : 'suspended')}
                          >
                            {(user.account_status || 'active') === 'suspended' ? 'Reactivate' : 'Suspend'}
                          </button>
                          <button 
                            className="make-admin-btn"
                            onClick={() => handleMakeAdmin(user.id)}
                          >
                            Make Admin
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminUsers; 
