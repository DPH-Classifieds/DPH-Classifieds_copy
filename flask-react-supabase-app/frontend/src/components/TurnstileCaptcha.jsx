import React, { useEffect, useState } from 'react';

const Turnstile = ({ onVerify }) => {
  const [loading, setLoading] = useState(true);
  const siteKey = process.env.REACT_APP_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) {
      console.warn('Turnstile site key not configured');
      setLoading(false);
      return;
    }

    const renderTurnstile = () => {
      if (window.turnstile) {
        window.turnstile.render('#turnstile-container', {
          sitekey: siteKey,
          callback: (token) => {
            window.turnstileToken = token;
            if (onVerify) onVerify(token);
          },
          'expired-callback': () => {
            window.turnstileToken = null;
          },
          'error-callback': () => {
            console.error('Turnstile error');
          }
        });
      }
    };

    if (window.turnstile) {
      renderTurnstile();
    } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.onload = renderTurnstile;
      document.head.appendChild(script);
    }
  }, [siteKey, onVerify]);

  if (!siteKey) {
    return null;
  }

  return (
    <div id="turnstile-container" className="turnstile-container" style={{ marginBottom: '1rem' }}></div>
  );
};

export default Turnstile;