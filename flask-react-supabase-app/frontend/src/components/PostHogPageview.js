import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageview } from '../utils/analytics';

// Fires a PostHog $pageview on every route change. No-ops when PostHog
// isn't configured (empty REACT_APP_POSTHOG_KEY).
const PostHogPageview = () => {
  const location = useLocation();
  useEffect(() => {
    trackPageview();
  }, [location.pathname, location.search]);
  return null;
};

export default PostHogPageview;
