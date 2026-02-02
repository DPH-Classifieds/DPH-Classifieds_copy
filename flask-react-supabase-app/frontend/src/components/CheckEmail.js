import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../styles/Auth.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const CheckEmail = () => {
  const location = useLocation();
  const email = location.state?.email;
  const [resendStatus, setResendStatus] = useState(null);
  const [resending, setResending] = useState(false);

  const handleResend = async () => {
    if (!email) {
      setResendStatus('Missing email address. Please go back to signup.');
      return;
    }

    setResending(true);
    setResendStatus(null);

    try {
      const response = await fetch(`${API_URL}/api/auth/resend-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/auth/callback`
        })
      });

      const data = await response.json();
      if (response.ok) {
        setResendStatus('Confirmation email resent. Please check your inbox.');
      } else {
        setResendStatus(data?.message || 'Failed to resend confirmation email.');
      }
    } catch (error) {
      setResendStatus('Failed to resend confirmation email. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Almost ready!</h1>
        <p className="auth-subtitle">Please check your inbox to confirm your email.</p>
        {email && (
          <p className="auth-note">We sent the confirmation link to <strong>{email}</strong>.</p>
        )}
        <p className="auth-note">
          If you do not see the message, check your spam folder or try resending the confirmation from the login page.
        </p>
        {resendStatus && <div className="auth-note">{resendStatus}</div>}
        <button
          type="button"
          className="auth-button"
          onClick={handleResend}
          disabled={resending || !email}
        >
          {resending ? 'Resending...' : 'Resend confirmation email'}
        </button>
        <Link to="/login" className="auth-button primary-button">
          Go back to login
        </Link>
      </div>
    </div>
  );
};

export default CheckEmail;
