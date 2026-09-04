import { API_BASE_URL as API_URL } from '../utils/apiBase';
import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCurrentUser, saveAuthData, setAuthHeader, setTokenStorageMode, storeAccessToken } from '../utils/authService';
import { signInWithGoogle } from '../utils/supabaseClient';
import '../styles/Auth.css';


const Login = () => {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resetStatus, setResetStatus] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [rememberMe, setRememberMe] = useState(true);

  // Admin can turn Google sign-in off (public flag); hide the button when so.
  useEffect(() => {
    fetch(`${API_URL}/api/config/google-signin`)
      .then((r) => r.json())
      .then((d) => setGoogleEnabled(Boolean(d.enabled)))
      .catch(() => {}); // on error keep it shown (default true)
  }, []);
  const { syncWithSupabase } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTarget = new URLSearchParams(location.search).get('redirect');

  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const { error: oauthError } = await signInWithGoogle({ redirectAfter: redirectTarget || '/' });
      if (oauthError) throw new Error(oauthError.message || 'Could not start Google sign-in.');
      // Supabase redirects the page to Google; nothing else to do here.
    } catch (err) {
      setError(err.message || 'Could not start Google sign-in. Please try again.');
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

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
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailOrUsername, password, remember_me: rememberMe }),
        credentials: 'include'
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // Save token so syncWithSupabase can find the authenticated user
      if (data.access_token) {
        setTokenStorageMode(rememberMe ? 'local' : 'session');
        saveAuthData(data);
        storeAccessToken(data.access_token);
        setAuthHeader(data.access_token);
      }

      const safeRedirect = redirectTarget && redirectTarget.startsWith('/') ? redirectTarget : '/';
      await syncWithSupabase({ forceBackendCheck: true });
      const { user: backendUser } = await getCurrentUser(true);
      if (backendUser?.id && !backendUser.phone_verified) {
        navigate('/verify-phone', {
          replace: true,
          state: {
            phone: backendUser.phone || '',
            countryCode: backendUser.country_code || '+971',
            purpose: 'profile_verify',
            redirect: safeRedirect,
            nextRoute: safeRedirect,
          },
        });
        return;
      }
      navigate(safeRedirect, { replace: true });
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('network')) {
        setError('Network error. Please check your connection and try again.');
      } else {
        setError(err.message || 'Failed to sign in. Please check your credentials and try again.');
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

        {googleEnabled && (<>
        <button
          type="button"
          className="auth-button auth-google-button"
          onClick={handleGoogle}
          disabled={googleLoading || loading}
        >
          <svg className="auth-google-icon" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.568 2.684-3.874 2.684-6.615z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
          </svg>
          {googleLoading ? 'Opening Google...' : 'Continue with Google'}
        </button>

        <div className="auth-divider-row" aria-hidden="true">
          <span className="auth-divider-line" />
          <span className="auth-divider-label">or</span>
          <span className="auth-divider-line" />
        </div>
        </>)}

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

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>Keep me logged in</span>
          </label>
          
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
          <Link to={redirectTarget && redirectTarget.startsWith('/') ? `/signup?redirect=${encodeURIComponent(redirectTarget)}` : '/signup'} className="auth-link">
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
            className="auth-inline-button"
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
