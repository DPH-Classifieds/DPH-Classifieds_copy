import React, { useEffect, useState } from 'react';
import './CookieBanner.css';

const COOKIE_CONSENT_KEY = 'cookie_consent';

const CookieBanner = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!stored) {
      setVisible(true);
    }
  }, []);

  const accept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ accepted: true, date: new Date().toISOString() }));
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({ accepted: false, date: new Date().toISOString() }));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="cookie-banner" role="dialog" aria-label="Cookie consent">
      <div className="cookie-banner-content">
        <p>
          We use cookies to keep you signed in and improve your experience. By continuing, you agree to our{' '}
          <a href="/privacy-policy">Privacy Policy</a>.
        </p>
        <div className="cookie-banner-actions">
          <button className="cookie-btn cookie-btn-accept" onClick={accept}>Accept</button>
          <button className="cookie-btn cookie-btn-decline" onClick={decline}>Decline</button>
        </div>
      </div>
    </div>
  );
};

export default CookieBanner;
