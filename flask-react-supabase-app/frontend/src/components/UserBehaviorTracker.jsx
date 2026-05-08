import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackView, trackSearch } from '../utils/userBehavior';

const LISTING_PATH_RE = /^\/(cars|car-parts|plates|bikes)\/([^/]+)/;
const SEARCH_PARAM_RE = /[?&]q=([^&]+)/;

const UserBehaviorTracker = () => {
  const location = useLocation();
  const lastPathRef = useRef('');

  useEffect(() => {
    const path = `${location.pathname}${location.search}`;

    if (path === lastPathRef.current) return;
    lastPathRef.current = path;

    const listingMatch = path.match(LISTING_PATH_RE);
    if (listingMatch) {
      const typeMap = { cars: 'car', 'car-parts': 'part', plates: 'plate', bikes: 'bike' };
      const type = typeMap[listingMatch[1]] || listingMatch[1];
      const id = listingMatch[2];
      trackView(type, id, { path });
    }

    const searchMatch = path.match(SEARCH_PARAM_RE);
    if (searchMatch) {
      const query = decodeURIComponent(searchMatch[1]);
      trackSearch(query);
    }
  }, [location]);

  return null;
};

export default UserBehaviorTracker;
