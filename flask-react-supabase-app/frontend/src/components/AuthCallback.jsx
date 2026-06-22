import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { trackEvent } from '../utils/analytics';
import '../styles/Auth.css';

// Treat the user as "new" if their auth row was created within this many
// seconds of the OAuth callback firing. Anything older is a returning user.
const NEW_USER_WINDOW_SECONDS = 120;

const AuthCallback = () => {
  const navigate = useNavigate();
  const { syncWithSupabase } = useAuth();
  const syncRef = useRef(syncWithSupabase);
  useEffect(() => { syncRef.current = syncWithSupabase; });
  const [message, setMessage] = useState('Processing authentication...');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const oauthProvider = searchParams.get('oauth'); // 'google', etc.
    const redirectTarget = searchParams.get('redirect');
    const safeRedirect = redirectTarget && redirectTarget.startsWith('/') ? redirectTarget : '/profile';
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

    const completeOAuth = async () => {
      if (!accessToken || !refreshToken) {
        setMessage('Email confirmed successfully! You can log in.');
        return;
      }

      const { data: setData, error: setErr } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (setErr) {
        setHasError(true);
        setMessage('Authentication completed, but we could not start a session. Please try signing in again.');
        return;
      }

      const supabaseUser = setData?.user;

      // Decide login vs sign_up before we hit our backend. Supabase's
      // auth.users created_at fires once per identity; we treat anyone created
      // in the last few minutes as a fresh sign-up.
      const createdAtMs = supabaseUser?.created_at ? Date.parse(supabaseUser.created_at) : null;
      const isFreshSignup = createdAtMs && (Date.now() - createdAtMs) < NEW_USER_WINDOW_SECONDS * 1000;
      const eventMethod = oauthProvider || 'oauth';

      try {
        if (isFreshSignup) {
          trackEvent('sign_up', { method: eventMethod, platform: 'web' });
        }
        trackEvent('login', { method: eventMethod, platform: 'web' });
      } catch (_) { /* analytics never blocks auth */ }

      // syncWithSupabase will call /api/auth/me which auto-creates the
      // public.users row for first-time OAuth users (see
      // _get_user_details_with_admin_status in backend/app.py).
      try {
        await syncRef.current({ forceBackendCheck: true });
      } catch (_) { /* fall through — we'll surface phone state below */ }

      // Re-read fresh user state to decide where to send them. We pull from
      // the AuthContext via the next-tick getSession because syncWithSupabase
      // may not flush its state setter in time for this effect closure.
      const { data: { session: refreshedSession } } = await supabase.auth.getSession();
      const accessTokenForCheck = refreshedSession?.access_token || accessToken;

      let phoneVerified = false;
      let backendUser = null;
      try {
        const me = await fetch(`${process.env.REACT_APP_API_URL || ''}/api/auth/me`, {
          headers: { Authorization: `Bearer ${accessTokenForCheck}` },
        });
        if (me.ok) {
          backendUser = await me.json();
          phoneVerified = Boolean(backendUser?.phone_verified);
        }
      } catch (_) { /* treat as unverified */ }

      if (!phoneVerified) {
        setMessage('Almost done — let’s verify your phone number.');
        setTimeout(() => navigate('/verify-phone', {
          replace: true,
          state: {
            phone: backendUser?.phone || '',
            countryCode: backendUser?.country_code || '+971',
            purpose: 'profile_verify',
            redirect: safeRedirect,
            nextRoute: safeRedirect,
          },
        }), 600);
        return;
      }

      setMessage('Signed in! Redirecting...');
      setTimeout(() => navigate(safeRedirect, { replace: true }), 600);
    };

    completeOAuth();
  }, [navigate]); // syncWithSupabase accessed via ref — must not be a dep or the OAuth flow re-fires on every token refresh

  return (
    <div className="auth-container">
      <div className="auth-card check-email-card">
        <div className="check-email-status">
          <span className="check-email-status-label">
            {hasError ? 'Authentication issue' : 'Signing you in'}
          </span>
          <h2 className="auth-title">{hasError ? 'We hit a verification issue' : 'Please wait'}</h2>
          <p className="auth-subtitle">{message}</p>
        </div>
        <div className={`auth-status-panel ${hasError ? 'error' : 'success'}`}>
          <strong>
            {hasError
              ? 'The sign-in did not complete cleanly.'
              : 'You will be redirected automatically in a moment.'}
          </strong>
          {hasError && (
            <p>
              Use the button below to return to login. If the issue persists,
              try a different sign-in method or contact support.
            </p>
          )}
        </div>
        <div className="check-email-actions">
          <Link to={hasError ? '/login' : '/profile'} className="auth-button">
            {hasError ? 'Go to login' : 'Continue'}
          </Link>
          <Link to="/login" className="auth-inline-action">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AuthCallback;
