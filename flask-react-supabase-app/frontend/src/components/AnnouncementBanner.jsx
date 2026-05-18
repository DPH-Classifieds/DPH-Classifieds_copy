import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../styles/AnnouncementBanner.css';

const STORAGE_KEY = 'dph_announcement_banner_dismissed_v1';

const AnnouncementBanner = () => {
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch (error) {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    // Don’t show on the post form itself.
    if (location.pathname === '/post-car') {
      setDismissed(true);
    }
  }, [location.pathname]);

  if (dismissed) return null;

  return (
    <div className="announcement-banner" role="region" aria-label="Announcement">
      <div className="announcement-inner">
        <div className="announcement-copy">
          <span className="announcement-text">
            Thinking of listing your car? Don’t worry — it’s free.
          </span>
          <Link className="announcement-link" to="/post-car">
            List your car
          </Link>
        </div>
        <button
          type="button"
          className="announcement-dismiss"
          aria-label="Dismiss announcement"
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem(STORAGE_KEY, '1');
            } catch (error) {
              // ignore
            }
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default AnnouncementBanner;

