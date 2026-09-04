import { API_BASE_URL as API_URL } from '../utils/apiBase';
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/Auth.css';


const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const navigate = useNavigate();

  const getPasswordErrors = (value) => {
    const errors = [];
    if (!value) {
      errors.push('Password is required');
      return errors;
    }
    if (value.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    if (!/[0-9]/.test(value)) {
      errors.push('Password must include a number');
    }
    if (!/[^a-zA-Z0-9]/.test(value)) {
      errors.push('Password must include a symbol');
    }
    return errors;
  };

  useEffect(() => {
    const hashFragment = window.location.hash ? window.location.hash.substring(1) : '';
    const queryParams = new URLSearchParams(window.location.search || '');
    const hashParams = new URLSearchParams(hashFragment);
    const token = hashParams.get('access_token') || queryParams.get('access_token');
    const type = hashParams.get('type') || queryParams.get('type');
    const errorDescription = hashParams.get('error_description') || queryParams.get('error_description');

    if (errorDescription) {
      setError(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
      return;
    }

    if (type && type !== 'recovery') {
      setError('Invalid password reset link');
      return;
    }

    if (token) {
      setAccessToken(token);
    } else {
      setError('Invalid or expired password reset link');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Form validation
    if (!password || !confirmPassword) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    const passwordErrors = getPasswordErrors(password);
    if (passwordErrors.length > 0) {
      setError(passwordErrors.join('. '));
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setLoading(false);
      return;
    }

    try {
      // Note: We need to implement this endpoint in the backend
      const response = await axios.post(`${API_URL}/api/auth/update-password`, {
        password,
        access_token: accessToken,
        hash: window.location.hash ? window.location.hash.substring(1) : ''
      });
      
      if (response.status === 200) {
        setSuccess(true);
        // Redirect to login page after successful password reset
        setTimeout(() => navigate('/login'), 3000);
      } else {
        setError('Failed to reset password. Please try again.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'An unexpected error occurred. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Reset Your Password</h2>
        <p className="auth-subtitle">Please create a new password</p>
        
        {error && <div className="auth-error">{error}</div>}
        {success && (
          <div className="auth-success">
            Your password has been reset successfully! Redirecting to login...
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="password">New Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              minLength="8"
              disabled={loading || success || !accessToken}
            />
            <small className="form-hint">
              Use at least 8 characters with a number and a symbol
            </small>
          </div>
          
          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              minLength="8"
              disabled={loading || success || !accessToken}
            />
          </div>
          
          <button 
            type="submit" 
            className="auth-button primary-button"
            disabled={loading || success || !accessToken}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
        
        <div className="auth-links">
          <p>
            <Link to="/login">Back to Login</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword; 
