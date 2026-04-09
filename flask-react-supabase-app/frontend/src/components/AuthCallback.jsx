import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import '../styles/Auth.css';

const AuthCallback = () => {
  const navigate = useNavigate();
  const [message, setMessage] = useState('Processing authentication...');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const hash = window.location.hash ? window.location.hash.substring(1) : '';
    const params = new URLSearchParams(hash);
    const type = params.get('type');
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const errorDescription = params.get('error_description');

    if (errorDescription) {
      setHasError(true);
      setMessage(decodeURIComponent(errorDescription.replace(/\+/g, ' ')));
      return;
    }

    if (type === 'recovery') {
      navigate(`/reset-password${window.location.hash}`);
      return;
    }

    if (accessToken && refreshToken) {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) {
            setHasError(true);
            setMessage('Email confirmed, but we could not start a session. Please log in.');
            return;
          }
          setMessage('Email confirmed successfully! You can continue.');
          setTimeout(() => navigate('/profile'), 1200);
        });
      return;
    }

    setMessage('Email confirmed successfully! You can log in.');
  }, [navigate]);

  return (
    <div className="auth-container">
      <div className="auth-card check-email-card">
        <div className="check-email-status">
          <span className="check-email-status-label">
            {hasError ? 'Authentication issue' : 'Email confirmed'}
          </span>
          <h2 className="auth-title">{hasError ? 'We hit a verification issue' : 'You are confirmed'}</h2>
          <p className="auth-subtitle">{message}</p>
        </div>
        <div className={`auth-status-panel ${hasError ? 'error' : 'success'}`}>
          <strong>
            {hasError
              ? 'The confirmation link did not complete cleanly.'
              : 'Your email verification completed successfully.'}
          </strong>
          <p>
            {hasError
              ? 'Use the button below to return to login. If the issue persists, request a fresh confirmation email.'
              : 'You can continue to your profile or return to login if you prefer to sign in again.'}
          </p>
        </div>
        <div className="auth-action-row">
          <Link to={hasError ? '/login' : '/profile'} className="auth-button">
            {hasError ? 'Go to login' : 'Continue'}
          </Link>
          <Link to="/login" className="auth-button auth-button-secondary">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AuthCallback;
