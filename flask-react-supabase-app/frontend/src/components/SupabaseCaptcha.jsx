import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

const SupabaseCaptcha = ({ onVerify, siteKey }) => {
  const [captchaToken, setCaptchaToken] = useState(null);
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!siteKey) {
      console.warn('hCaptcha site key not configured');
      return;
    }

    const renderCaptcha = () => {
      if (window.hcaptcha && containerRef.current && !widgetIdRef.current) {
        widgetIdRef.current = window.hcaptcha.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            setCaptchaToken(token);
            if (onVerify) onVerify(token);
          },
          'expired-callback': () => {
            setCaptchaToken(null);
            if (onVerify) onVerify(null);
          },
          'error-callback': () => {
            console.error('hCaptcha error');
            setCaptchaToken(null);
          }
        });
      }
    };

    if (window.hcaptcha) {
      renderCaptcha();
    } else {
      const script = document.createElement('script');
      script.src = 'https://js.hs-scripts.com/5169131.js'; // hCaptcha script
      script.async = true;
      script.onload = () => {
        if (window.hcaptcha) {
          renderCaptcha();
        }
      };
      document.head.appendChild(script);
    }

    return () => {
      if (widgetIdRef.current && window.hcaptcha) {
        window.hcaptcha.remove(widgetIdRef.current);
      }
    };
  }, [siteKey, onVerify]);

  if (!siteKey) {
    return null;
  }

  return (
    <div 
      id="hcaptcha-container" 
      ref={containerRef}
      className="hcaptcha-container"
      style={{ marginBottom: '1rem' }}
    />
  );
};

export default SupabaseCaptcha;