import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import '../styles/Auth.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const hashFragment = window.location.hash;
    if (!hashFragment) {
      setError('Invalid or expired password reset link');
      return;
    }

    const params = new URLSearchParams(hashFragment.substring(1));
    const token = params.get('access_token');
    const type = params.get('type');
    const errorDescription = params.get('error_description');

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

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
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
        access_token: accessToken
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
              disabled={loading || success || !accessToken}
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              disabled={loading || success || !accessToken}
            />
          </div>
          
          <button 
            type="submit" 
            className="auth-button"
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
