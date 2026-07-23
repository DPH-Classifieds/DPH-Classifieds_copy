import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../constants/config';

const AUTH_DATA_KEY = 'auth_data';

const readAuthData = async () => {
  try {
    const raw = await AsyncStorage.getItem(AUTH_DATA_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
};

const saveAuthData = async (authData) => {
  try {
    await AsyncStorage.setItem(AUTH_DATA_KEY, JSON.stringify(authData));
  } catch (error) {
  }
};

export const clearAuthData = async () => {
  try {
    await AsyncStorage.removeItem(AUTH_DATA_KEY);
  } catch (error) {
  }
};

export const getAccessToken = async () => {
  try {
    const authData = await readAuthData();
    return authData?.access_token || null;
  } catch (error) {
    return null;
  }
};

export const setAuthHeader = (token) => {};

export const signIn = async (email, password, cfToken) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...(cfToken ? { cf_turnstile_token: cfToken } : {}) }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { data: null, error: data.message || 'Failed to sign in' };
    }

    if (data && data.access_token) {
      await saveAuthData(data);
      setAuthHeader(data.access_token);
      return { data, error: null };
    }

    return { data: null, error: 'Invalid response from server' };
  } catch (error) {
    return { data: null, error: error.message || 'Failed to sign in' };
  }
};

export const signUp = async (email, password, additionalData = {}, cfToken) => {
  try {
    const { cf_turnstile_token: _ignored, ...restAdditionalData } = additionalData;
    const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...restAdditionalData, ...(cfToken ? { cf_turnstile_token: cfToken } : {}) }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { data: null, error: data.message || 'Failed to sign up' };
    }

    return { data, error: null };
  } catch (error) {
    return { data: null, error: error.message || 'Failed to sign up' };
  }
};

export const signOut = async () => {
  try {
    const token = await getAccessToken();
    if (token) {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
    }
  } catch (error) {
  } finally {
    await clearAuthData();
    setAuthHeader(null);
    return { error: null };
  }
};

export const getCurrentUser = async () => {
  try {
    const token = await getAccessToken();
    if (!token) {
      return { user: null, error: null };
    }

    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      // Don't clear auth on a 401 here. The apiClient already refreshes expired
      // tokens transparently, and Supabase's onAuthStateChange handles real
      // sign-outs. Clearing on every transient 401 caused pull-to-refresh on
      // gated tabs (Saved, Sell) to flip the user state to null and bounce to
      // the login screen.
      return { user: null, error: 'Failed to get user information' };
    }

    const data = await response.json();
    return { user: data, error: null };
  } catch (error) {
    return { user: null, error: error.message || 'Failed to get user information' };
  }
};

export const refreshToken = async () => {
  try {
    const authData = await readAuthData();
    if (!authData || !authData.refresh_token) {
      return { data: null, error: 'No refresh token available' };
    }

    const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: authData.refresh_token }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { data: null, error: data.message || 'Failed to refresh token' };
    }

    if (data && data.access_token) {
      await saveAuthData(data);
      setAuthHeader(data.access_token);
      return { data, error: null };
    }

    return { data: null, error: 'Invalid response from server' };
  } catch (error) {
    return { data: null, error: error.message || 'Failed to refresh token' };
  }
};

export const initializeAuth = async () => {
  const token = await getAccessToken();
  if (token) {
    setAuthHeader(token);
  }
};

export default {
  signIn,
  signUp,
  signOut,
  getCurrentUser,
  refreshToken,
  setAuthHeader,
  clearAuthData,
  getAccessToken,
  initializeAuth,
};
