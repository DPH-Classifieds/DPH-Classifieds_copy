import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from './apiClient';
import { router } from 'expo-router';

const ENABLED_KEY = 'dph_push_enabled'; // user toggle, defaults on
const TOKEN_KEY = 'dph_push_token'; // last token synced to backend (dedupe)
const HANDLED_NOTIF_KEY = 'dph_handled_notif_id'; // last routed cold-start notification

// Foreground presentation: show the banner + play sound even while the app is
// open. Module-level so it's set once on import.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const isPushEnabledPref = async () => {
  try {
    const v = await AsyncStorage.getItem(ENABLED_KEY);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
};

const getProjectId = () =>
  Constants?.expoConfig?.extra?.eas?.projectId ||
  Constants?.easConfig?.projectId ||
  undefined;

// Registers the device for push and syncs the Expo token to the backend.
// Safe to call repeatedly: no-ops on simulators, when permission is denied,
// when the user disabled push, and when the token is unchanged.
export const registerForPushNotifications = async () => {
  try {
    if (!(await isPushEnabledPref())) return null;
    if (!Device.isDevice) return null; // Expo push tokens only issue on real hardware

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#01351c',
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    const projectId = getProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    if (!token) return null;

    const last = await AsyncStorage.getItem(TOKEN_KEY);
    if (token !== last) {
      await apiClient.post('/api/user/push-token', {
        expo_push_token: token,
        platform: Platform.OS,
        device_id: Device.osInternalBuildId || Device.modelId || undefined,
      });
      await AsyncStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch (e) {
    if (__DEV__) console.warn('registerForPushNotifications failed', e);
    return null;
  }
};

export const unregisterPushToken = async () => {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      await apiClient.delete(
        `/api/user/push-token?expo_push_token=${encodeURIComponent(token)}`
      );
    }
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    if (__DEV__) console.warn('unregisterPushToken failed', e);
  }
};

export const setPushEnabledPref = async (enabled) => {
  try {
    await AsyncStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {}
  if (enabled) await registerForPushNotifications();
  else await unregisterPushToken();
};

// Translate a notification's data payload into a navigation action. Backend
// push payloads set { listing_type, listing_id } for listing deep-links or
// { screen } to open a profile-stack screen.
const DETAIL_PATH_BY_TYPE = {
  car: '/(tabs)/(explore)/CarDetail',
  bike: '/(tabs)/(explore)/BikeDetail',
  plate: '/(tabs)/(explore)/PlateDetail',
  part: '/(tabs)/(explore)/PartDetail',
};

// Route a notification tap under Expo Router (uses the global router; no
// navigationRef needed). Maps listing_type -> the explore-group detail route.
export const routeFromNotificationData = (data) => {
  if (!data) return;
  try {
    const pathname = DETAIL_PATH_BY_TYPE[data.listing_type];
    if (pathname && data.listing_id) {
      router.push({ pathname, params: { listingId: String(data.listing_id) } });
      return;
    }
    // Non-listing notifications may carry an explicit route path (e.g. "/(auth)/...").
    if (data.path) router.push(String(data.path));
  } catch (e) {
    if (__DEV__) console.warn('routeFromNotificationData failed', e);
  }
};

// Wires tap-to-open handlers. Returns a cleanup fn. Handles both the
// cold-start case (app opened from a killed state via a notification) and the
// warm case (tapped while backgrounded).
export const attachNotificationResponseHandler = () => {
  const handle = async (response, persist) => {
    const request = response?.notification?.request;
    const data = request?.content?.data;
    if (!data) return;
    // getLastNotificationResponseAsync persists across launches, so on a plain
    // cold start it can replay a stale tap. Persist the handled id and skip
    // repeats so we don't re-navigate to an old listing (or double-navigate).
    if (persist) {
      const id = request?.identifier;
      try {
        if (id && (await AsyncStorage.getItem(HANDLED_NOTIF_KEY)) === id) return;
        if (id) await AsyncStorage.setItem(HANDLED_NOTIF_KEY, id);
      } catch { /* ignore — worst case a duplicate nav */ }
    }
    routeFromNotificationData(data);
  };
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) setTimeout(() => handle(response, true), 400);
  });
  const sub = Notifications.addNotificationResponseReceivedListener((response) => handle(response, false));
  return () => sub.remove();
};
