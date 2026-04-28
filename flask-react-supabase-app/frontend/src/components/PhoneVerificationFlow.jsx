import React, { useEffect, useState } from 'react';
import { getAccessToken } from '../utils/supabaseClient';
import { formatVerificationPhone } from '../utils/countryCodes';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const PhoneVerificationFlow = ({
  mode = 'modal',
  open = true,
  title = 'Verify your phone',
  description = 'We sent a one-time code to your phone number.',
  phone,
  countryCode,
  purpose = 'vin_reveal',
  listingId,
  verificationId: initialVerificationId = null,
  onClose,
  onVerified,
  onCancel,
  autoStart = true,
  hideClose = false,
  continueLabel = 'Continue',
  className = '',
}) => {
  const [verificationId, setVerificationId] = useState(initialVerificationId);
  const [phoneInput, setPhoneInput] = useState(phone || '');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [phoneVerification, setPhoneVerification] = useState(null);
  const [verified, setVerified] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const RESEND_COOLDOWN = 50;
  const displayPhone = phoneVerification?.masked_phone
    || (phoneInput || phone ? formatVerificationPhone(phoneInput || phone, countryCode) : '');

  useEffect(() => {
    setVerificationId(initialVerificationId);
    setPhoneInput(phone || '');
    setPhoneVerification(null);
    setVerified(false);
    setCode('');
  }, [initialVerificationId, phone, purpose, listingId]);

  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = setInterval(() => {
      setCooldownRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  useEffect(() => {
    if (!open || verified) {
      return;
    }

    if (initialVerificationId) {
      setPhoneVerification((prev) => prev || {
        verification_id: initialVerificationId,
        phone,
        purpose,
        listing_id: listingId,
        status: 'pending',
        masked_phone: phone ? `***${String(phone).slice(-4)}` : null,
      });
      return;
    }

    if (!autoStart || !phoneInput || starting || verificationId) {
      return;
    }

    const startVerification = async () => {
      setStarting(true);
      setError('');
      setMessage('Sending verification code...');

      try {
        const token = await getAccessToken();
        const response = await fetch(`${API_URL}/api/phone-verifications/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            phone: phoneInput,
            country_code: countryCode,
            purpose,
            listing_id: listingId,
            source: mode,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.message || 'Failed to send verification code');
        }

        if (data.already_verified) {
          setVerified(true);
          setMessage('Phone is already verified.');
          if (onVerified) onVerified(data);
          return;
        }

        setVerificationId(data.phone_verification?.verification_id || null);
        setPhoneVerification(data.phone_verification || null);
        setMessage('Verification code sent.');
        setCooldownRemaining(RESEND_COOLDOWN);
      } catch (sendError) {
        setError(sendError.message || 'Failed to send verification code');
      } finally {
        setStarting(false);
      }
    };

    startVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    autoStart,
    phoneInput,
    phone,
    countryCode,
    purpose,
    listingId,
    starting,
    verificationId,
    verified,
    initialVerificationId,
  ]);

  const sendOrResend = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const token = await getAccessToken();
      const response = await fetch(`${API_URL}/api/phone-verifications/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(
          verificationId
            ? { verification_id: verificationId, source: mode }
            : {
                phone: phoneInput,
                country_code: countryCode,
                purpose,
                listing_id: listingId,
                source: mode,
              }
        ),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to send verification code');
      }

      setVerificationId(data.phone_verification?.verification_id || verificationId);
      setPhoneVerification(data.phone_verification || phoneVerification);
      setMessage('Verification code sent.');
      setCooldownRemaining(RESEND_COOLDOWN);
    } catch (sendError) {
      setError(sendError.message || 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (event) => {
    if (event) {
      event.preventDefault();
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      const token = await getAccessToken();
      const response = await fetch(`${API_URL}/api/phone-verifications/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          verification_id: verificationId,
          code,
          purpose,
          listing_id: listingId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.message || 'Failed to verify code');
      }

      setVerified(true);
      setMessage('Phone verified successfully.');
      if (onVerified) {
        onVerified(data);
      }
    } catch (verifyError) {
      setError(verifyError.message || 'Failed to verify code');
    } finally {
      setLoading(false);
    }
  };

  if (!open && mode === 'modal') {
    return null;
  }

  const content = (
    <form className={`phone-verification-flow ${className}`} onSubmit={verifyCode}>
      <div className="phone-verification-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      {phoneVerification?.masked_phone || phone ? (
        <div className="phone-verification-highlight">
          <span>Sent to</span>
          <strong>{displayPhone}</strong>
        </div>
      ) : null}

      {message && <div className="auth-note">{message}</div>}
      {error && <div className="auth-error">{error}</div>}

      <div className="form-group">
        <label htmlFor="phone-verification-phone">Phone number</label>
        <input
          id="phone-verification-phone"
          type="tel"
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          placeholder="+971501234567 or 0501234567"
          autoComplete="tel"
        />
        <small className="form-hint">
          Enter the number however you normally write it. We normalize it before sending the SMS.
        </small>
      </div>

      <div className="form-group">
        <label htmlFor="phone-verification-code">Verification code</label>
        <input
          id="phone-verification-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Enter the 6-digit code"
          maxLength={6}
        />
      </div>

      <div className="phone-verification-actions">
        {!hideClose && onClose && (
          <button type="button" className="auth-button auth-button-secondary" onClick={onClose}>
            Cancel
          </button>
        )}
        {!verified && (
          <button
            type="button"
            className="auth-button auth-button-secondary"
            onClick={sendOrResend}
            disabled={loading || starting || cooldownRemaining > 0}
          >
            {cooldownRemaining > 0 ? `Resend in ${cooldownRemaining}s` : verificationId ? 'Resend code' : 'Send code'}
          </button>
        )}
        <button type="submit" className="auth-button primary-button" disabled={loading || verified || !code.trim()}>
          {verified ? continueLabel : loading ? 'Verifying...' : 'Verify code'}
        </button>
      </div>
    </form>
  );

  if (mode === 'page') {
    return (
      <div className="auth-container">
        <div className="auth-card check-email-card">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="cd-phone-modal-overlay" role="dialog" aria-modal="true">
      <div className="cd-phone-modal">
        {content}
      </div>
    </div>
  );
};

export default PhoneVerificationFlow;
