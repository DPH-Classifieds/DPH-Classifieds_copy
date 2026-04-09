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
      setResendStatus({
        type: 'error',
        message: 'Missing email address. Please go back to signup and try again.',
      });
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
        setResendStatus({
          type: 'success',
          message: 'Confirmation email resent. Check your inbox and spam folder.',
          guidance: 'If nothing arrives, the project auth email sender may still need production SMTP setup in Supabase.',
        });
      } else {
        setResendStatus({
          type: 'error',
          message: data?.message || 'Failed to resend confirmation email.',
          guidance: data?.guidance || null,
        });
      }
    } catch (error) {
      setResendStatus({
        type: 'error',
        message: 'Failed to resend confirmation email. Please try again.',
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card check-email-card">
        <div className="check-email-status">
          <span className="check-email-status-label">Email confirmation</span>
          <h1 className="auth-title">Check your inbox</h1>
          <p className="auth-subtitle">
            Your account is almost ready. Confirm your email to activate DPH Classifieds access.
          </p>
        </div>
        {email && (
          <div className="check-email-highlight">
            <span className="check-email-highlight-label">Sent to</span>
            <strong>{email}</strong>
          </div>
        )}
        <div className="check-email-steps">
          <div className="check-email-step">
            <span className="check-email-step-number">01</span>
            <div>
              <strong>Open the confirmation email</strong>
              <p>Use the verify link in the message to finish your signup.</p>
            </div>
          </div>
          <div className="check-email-step">
            <span className="check-email-step-number">02</span>
            <div>
              <strong>Check spam or promotions</strong>
              <p>Some providers filter new transactional emails the first time they arrive.</p>
            </div>
          </div>
        </div>
        <p className="auth-note check-email-note">
          If the email does not arrive, resend it below. Public auth email delivery depends on Supabase email configuration in production.
        </p>
        {resendStatus && (
          <div className={`auth-status-panel ${resendStatus.type || 'note'}`}>
            <strong>{resendStatus.message}</strong>
            {resendStatus.guidance && <p>{resendStatus.guidance}</p>}
          </div>
        )}
        <div className="auth-action-row">
          <button
            type="button"
            className="auth-button"
            onClick={handleResend}
            disabled={resending || !email}
          >
            {resending ? 'Resending...' : 'Resend confirmation email'}
          </button>
          <Link to="/login" className="auth-button auth-button-secondary">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CheckEmail;
