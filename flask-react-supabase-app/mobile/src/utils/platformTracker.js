import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from './apiClient';

const VISITOR_KEY = 'dph_platform_visitor_id';

const newId = () => `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;

let cachedVisitorId = null;
// Fresh session id per app cold start. Mirrors the web's sessionStorage
// semantics — survives navigations within a session, resets when the
// app is fully relaunched.
const sessionId = newId();

const ensureVisitorId = async () => {
  if (cachedVisitorId) return cachedVisitorId;
  try {
    const existing = await AsyncStorage.getItem(VISITOR_KEY);
    if (existing) {
      cachedVisitorId = existing;
      return existing;
    }
  } catch (_) { /* fall through to fresh ID */ }
  const fresh = newId();
  try { await AsyncStorage.setItem(VISITOR_KEY, fresh); } catch (_) { /* ignore */ }
  cachedVisitorId = fresh;
  return fresh;
};

export const getMobileAnalyticsIdentity = async () => ({
  event_id: newId(), visitor_id: await ensureVisitorId(), session_id: sessionId,
});

const PAGE_KIND_BY_ROUTE_PREFIX = {
  CarDetail: 'listing_detail',
  BikeDetail: 'listing_detail',
  PartDetail: 'listing_detail',
  PlateDetail: 'listing_detail',
  CarList: 'browse',
  BikeList: 'browse',
  PartList: 'browse',
  PlateList: 'browse',
  PostListing: 'post_form',
  AdminDashboard: 'admin',
  AdminUsers: 'admin',
  AdminListings: 'admin',
  AdminDealers: 'admin',
  AdminReports: 'admin',
  AdminMetrics: 'admin',
  Login: 'auth',
  Signup: 'auth',
  VerifyPhone: 'auth',
  ExploreMain: 'home',
};

const inferPageKind = (routeName) => PAGE_KIND_BY_ROUTE_PREFIX[routeName] || 'mobile_screen';

const LISTING_TYPE_BY_ROUTE = {
  CarDetail: 'car',
  BikeDetail: 'bike',
  PartDetail: 'part',
  PlateDetail: 'plate',
};

export const trackMobilePlatformEvent = async (eventName, payload = {}) => {
  try {
    const visitorId = await ensureVisitorId();
    await apiClient.post('/api/analytics/events', {
      event_id: newId(),
      event_name: eventName,
      platform: 'mobile',
      page_path: payload.page_path || `/mobile/${payload.route || eventName}`,
      page_kind: payload.page_kind,
      listing_type: payload.listing_type,
      listing_id: payload.listing_id,
      session_id: sessionId,
      visitor_id: visitorId,
      metadata: { platform: 'mobile', route: payload.route, ...payload.metadata },
    }, { requiresAuth: false });
  } catch (_) { /* analytics never blocks UI */ }
};

// Returns an onStateChange handler suitable for passing to
// NavigationContainer's onStateChange prop. Fires page_view on every
// route name change.
export const buildNavigationStateChangeHandler = (navigationRef) => {
  let lastRouteName = null;
  return () => {
    const route = navigationRef.current?.getCurrentRoute?.();
    const name = route?.name;
    if (!name || name === lastRouteName) return;
    lastRouteName = name;
    const listingType = LISTING_TYPE_BY_ROUTE[name];
    const listingId = route?.params?.listingId || route?.params?.itemId || route?.params?.carId;
    trackMobilePlatformEvent(listingType && listingId ? 'listing_view' : 'page_view', {
      route: name,
      page_path: `/mobile/${name}`,
      page_kind: inferPageKind(name),
      listing_type: listingType,
      listing_id: listingId,
    });
  };
};
