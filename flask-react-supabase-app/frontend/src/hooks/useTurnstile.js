import { useEffect, useRef, useState } from 'react';

const SCRIPT_ID = 'cf-turnstile-script';

export default function useTurnstile() {
  const containerRef = useRef(null);
  const [token, setToken] = useState('');
  const [widgetId, setWidgetId] = useState(null);

  useEffect(() => {
    const siteKey = process.env.REACT_APP_TURNSTILE_SITE_KEY;
    if (!siteKey || !containerRef.current) {
      return;
    }

    const renderWidget = () => {
      if (!window.turnstile || widgetId !== null) {
        return;
      }

      const id = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (value) => setToken(value),
        'error-callback': () => setToken(''),
        'expired-callback': () => setToken('')
      });

      setWidgetId(id);
    };

    const attachScript = () => {
      const existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        if (window.turnstile) {
          renderWidget();
        } else {
          const onLoad = () => renderWidget();
          existing.addEventListener('load', onLoad);
          return () => existing.removeEventListener('load', onLoad);
        }
        return;
      }

      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    };

    const cleanup = attachScript();
    return cleanup;
  }, [widgetId]);

  const reset = () => {
    if (widgetId !== null && window.turnstile) {
      window.turnstile.reset(widgetId);
    }
    setToken('');
  };

  return { containerRef, token, reset };
}
