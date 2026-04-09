import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/Auth.css';

const Login = () => {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const { signIn, syncWithSupabase } = useAuth();
  const navigate = useNavigate();
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    // Basic validation
    if (!emailOrUsername.trim()) {
      setError('Email or username is required');
      setLoading(false);
      return;
    }
    
    if (!password) {
      setError('Password is required');
      setLoading(false);
      return;
    }

    try {
      console.log('Attempting to sign in with:', emailOrUsername);
      const result = await signIn(emailOrUsername, password);
      console.log('Login successful, syncing with Supabase');
      
      // Force sync to ensure we have the token
      await syncWithSupabase();
      
      // Store the user info and token in localStorage as an additional backup
      if (result && result.data && result.data.session) {
        console.log('Storing session and token in localStorage');
        localStorage.setItem('supabase_access_token', result.data.session.access_token);
        localStorage.setItem('user_identifier', emailOrUsername);
      }
      
      console.log('Login and sync successful, navigating to profile');
      navigate('/profile');
    } catch (err) {
      console.error('Login error:', err);
      if (err.message && err.message.toLowerCase().includes('network')) {
        setError('Network error. Please check your connection and try again.');
      } else {
        const authMessage = err.message || 'Failed to sign in. Please check your credentials and try again.';
        const forgotMessage = authMessage.toLowerCase().includes('forgot password')
          ? authMessage
          : `${authMessage} If needed, use Forgot Password or resend the reset link below.`;
        setError(forgotMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendReset = async () => {
    setResetStatus(null);

    if (!emailOrUsername || !emailOrUsername.includes('@')) {
      setResetStatus('Enter your email address above to resend the reset link.');
      return;
    }

    setResetLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailOrUsername,
          redirectTo: `${window.location.origin}/reset-password`
        })
      });

      const data = await response.json();
      if (response.ok) {
        setResetStatus('Password reset email sent. Please check your inbox.');
      } else {
        setResetStatus(data?.message || 'Failed to send reset email.');
      }
    } catch (err) {
      setResetStatus('Failed to send reset email. Please try again.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Log In</h1>
        
        {error && <div className="auth-error">{error}</div>}
        {resetStatus && <div className="auth-note">{resetStatus}</div>}
        
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="emailOrUsername">Email or Username</label>
            <input
              type="text"
              id="emailOrUsername"
              value={emailOrUsername}
              onChange={(e) => setEmailOrUsername(e.target.value)}
              placeholder="Enter your email or username"
              required
              autoComplete="username"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          
          <button 
            type="submit" 
            className="auth-button primary-button"
            disabled={loading}
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
        
        <div className="auth-links auth-links-inline">
          <Link to="/forgot-password" className="auth-link">
            Forgot Password?
          </Link>
          <span className="auth-divider">•</span>
          <Link to="/signup" className="auth-link">
            Create Account
          </Link>
        </div>
        <div className="auth-support-panel">
          <p className="auth-support-title">Still missing the reset email?</p>
          <p className="auth-support-copy">
            Enter your email above, then request a fresh reset link.
          </p>
          <button
            type="button"
            className="auth-button auth-button-secondary"
            onClick={handleResendReset}
            disabled={resetLoading}
          >
            {resetLoading ? 'Sending reset link...' : 'Resend reset link'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login; 
