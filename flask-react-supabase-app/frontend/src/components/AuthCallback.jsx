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
      <div className="auth-card">
        <h2>{hasError ? 'Authentication Error' : 'Email Confirmed'}</h2>
        <p className="auth-subtitle">{message}</p>
        <div className="auth-links">
          <Link to="/login" className="auth-button primary-button">
            Go to Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AuthCallback;
