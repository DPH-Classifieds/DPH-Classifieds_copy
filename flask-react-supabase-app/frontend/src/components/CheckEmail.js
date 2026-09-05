import { API_BASE_URL as API_URL } from '../utils/apiBase';
import { getAuthenticatedHeaders } from '../utils/authenticatedApi';
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../styles/Auth.css';


const CheckEmail = () => {
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const redirectTarget = location.state?.redirect;
  const safeRedirect = redirectTarget && redirectTarget.startsWith('/') ? redirectTarget : '/';
  const [resendStatus, setResendStatus] = useState(null);
  const [resending, setResending] = useState(false);
  const [showChangeEmail, setShowChangeEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [updatingEmail, setUpdatingEmail] = useState(false);

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
          redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(safeRedirect)}`
        })
      });

      const data = await response.json();
      if (response.ok) {
        setShowChangeEmail(false);
        setResendStatus({
          type: 'success',
          message: 'Confirmation email sent. Check your inbox, spam, or Promotions folder.',
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

  const handleUpdateEmail = async () => {
    if (!newEmail.trim()) {
      setResendStatus({ type: 'error', message: 'Please enter a new email address.' });
      return;
    }

    if (!/\S+@\S+\.\S+/.test(newEmail)) {
      setResendStatus({ type: 'error', message: 'Please enter a valid email address.' });
      return;
    }

    setUpdatingEmail(true);
    setResendStatus(null);

    try {
      const authHeaders = await getAuthenticatedHeaders();
      if (!authHeaders) {
        setResendStatus({
          type: 'error',
          message: 'Your signup session has expired. Please sign up again to change the email address.',
        });
        return;
      }
      const response = await fetch(`${API_URL}/api/auth/update-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          current_email: email,
          new_email: newEmail.trim(),
          redirect_to: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(safeRedirect)}`,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setEmail(newEmail.trim());
        setNewEmail('');
        setShowChangeEmail(false);
        setResendStatus({
          type: 'success',
          message: 'Email updated! A new confirmation has been sent to your updated address.',
        });
      } else {
        setResendStatus({
          type: 'error',
          message: data?.error || data?.message || 'Failed to update email. Please try again.',
        });
      }
    } catch (err) {
      setResendStatus({
        type: 'error',
        message: 'Failed to update email. Please try again.',
      });
    } finally {
      setUpdatingEmail(false);
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
        <p className="auth-note check-email-note">Didn't receive it? You can send another confirmation email.</p>
        {resendStatus && (
          <div className={`auth-status-panel ${resendStatus.type || 'note'}`}>
            <strong>{resendStatus.message}</strong>
            {resendStatus.guidance && <p>{resendStatus.guidance}</p>}
          </div>
        )}
        <div className="check-email-actions">
          <button
            type="button"
            className="auth-button"
            onClick={handleResend}
            disabled={resending || !email}
          >
            {resending ? 'Resending...' : 'Resend confirmation email'}
          </button>
          {!resendStatus?.type || resendStatus.type !== 'success' ? (
            <button
              type="button"
              className="auth-button auth-button-secondary"
              onClick={() => setShowChangeEmail(!showChangeEmail)}
            >
              Wrong email? Change it
            </button>
          ) : null}
          <Link to={`/login?redirect=${encodeURIComponent(safeRedirect)}`} className="auth-inline-action">
            Back to login
          </Link>
        </div>

        {showChangeEmail && (
          <div className="check-email-change-form">
            <p>Enter your correct email address below. We'll send a new confirmation there.</p>
            <div className="check-email-change-row">
              <input
                type="email"
                placeholder="New email address"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={updatingEmail}
                className="auth-input"
              />
              <button
                type="button"
                className="auth-button"
                onClick={handleUpdateEmail}
                disabled={updatingEmail || !newEmail.trim()}
              >
                {updatingEmail ? 'Updating...' : 'Update & Resend'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckEmail;
