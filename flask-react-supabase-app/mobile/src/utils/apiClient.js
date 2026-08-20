import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../constants/config';
import * as authService from './authService';
import { supabase } from './supabaseClient';

const AUTH_DATA_KEY = 'auth_data';

const PUBLIC_ENDPOINTS = [
  '/api/homepage/preview',
  '/api/cars',
  '/api/bikes',
  '/api/plates',
  '/api/parts',
  '/api/search',
  '/api/about',
  '/api/contact',
  '/api/listings/counts',
];

const isPublicEndpoint = (endpoint) => {
  return PUBLIC_ENDPOINTS.some((pe) => endpoint.startsWith(pe));
};

const isTokenExpired = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return !payload.exp || payload.exp * 1000 < Date.now() + 30000;
  } catch {
    return true;
  }
};

const getBestAccessToken = async () => {
  try {
    const raw = await AsyncStorage.getItem(AUTH_DATA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const token = parsed?.access_token;
      if (token) {
        if (isTokenExpired(token)) {
          const refreshed = await authService.refreshToken();
          if (refreshed?.data?.access_token) return refreshed.data.access_token;
        } else {
          return token;
        }
      }
    }
  } catch (error) {
    // fall through to the Supabase session below
  }
  // authService's auth_data is only populated by email/password sign-in.
  // Google/OAuth sign-in only ever creates a Supabase session, so without
  // this fallback every apiClient call for those users went out with no
  // Authorization header at all — silently unauthenticated, not just for
  // saved listings/searches but every authed endpoint.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
};

const executeRequest = async (url, options, token) => {
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    delete headers['Authorization'];
  }
  return fetch(url, { ...options, headers });
};

const apiClient = {
  async request(endpoint, options = {}) {
    try {
      const requiresAuth = options.requiresAuth !== false && !isPublicEndpoint(endpoint);

      let token = null;
      if (requiresAuth) {
        token = await getBestAccessToken();
      }

      if (requiresAuth && !token) {
        const error = new Error('Authentication failed. Please log in again.');
        error.status = 401;
        throw error;
      }

      const headers = {
        ...(options.headers || {}),
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const requestOptions = {
        ...options,
        headers,
      };

      if (requestOptions.body instanceof FormData) {
        delete headers['Content-Type'];
      } else if (
        requestOptions.headers &&
        requestOptions.headers['Content-Type'] === 'application/json'
      ) {
        if (typeof requestOptions.body !== 'string' && requestOptions.body) {
          requestOptions.body = JSON.stringify(requestOptions.body);
        }
      }

      const shouldBypassCache = options.bypassCache === true;
      const separator = endpoint.includes('?') ? '&' : '?';
      const trackingParams = shouldBypassCache ? `${separator}_t=${Date.now()}` : '';
      const url = `${API_BASE_URL}${endpoint}${trackingParams}`;

      let response;
      try {
        response = await executeRequest(url, requestOptions, token);
      } catch (networkError) {
        throw networkError;
      }

      if (response.status === 401 && !options.__retriedAfterRefresh) {
        let message = '';
        try {
          const errorData = await response.clone().json();
          message = String(errorData?.message || '').toLowerCase();
        } catch {
          message = '';
        }

        if (
          message.includes('expired') ||
          message.includes('invalid') ||
          message.includes('unauthorized')
        ) {
          const refreshResult = await authService.refreshToken();
          const refreshedToken = refreshResult?.data?.access_token;
          if (refreshedToken) {
            token = refreshedToken;
            options.__retriedAfterRefresh = true;
            response = await executeRequest(url, requestOptions, token);
          }
        }
      }

      if (!response.ok) {
        const responseContentType = response.headers.get('content-type') || '';
        const allowHeader = response.headers.get('allow');

        let errorData = {};
        try {
          if (responseContentType.includes('application/json')) {
            errorData = await response.json();
          } else {
            const rawText = await response.text();
            errorData = {
              status: response.status,
              message: response.statusText || 'Unknown error',
              raw: rawText || null,
            };
          }
        } catch {
          errorData = {
            status: response.status,
            message: response.statusText || 'Unknown error',
          };
        }

        const errorMessage =
          errorData.message ||
          errorData.error ||
          errorData.raw ||
          `API request failed with status ${response.status}`;
        const error = new Error(errorMessage);
        error.status = response.status;
        error.details = errorData;
        error.allow = allowHeader;

        throw error;
      }

      if (response.status === 204) {
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      throw error;
    }
  },

  async get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  },

  async post(endpoint, data, options = {}) {
    const isFormData = data instanceof FormData;
    const headers = { ...(options.headers || {}) };
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      headers,
      body: isFormData ? data : JSON.stringify(data || {}),
    });
  },

  async put(endpoint, data, options = {}) {
    const isFormData = data instanceof FormData;
    const headers = { ...(options.headers || {}) };
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      headers,
      body: isFormData ? data : JSON.stringify(data || {}),
    });
  },

  async patch(endpoint, data, options = {}) {
    const isFormData = data instanceof FormData;
    const headers = { ...(options.headers || {}) };
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      headers,
      body: isFormData ? data : JSON.stringify(data || {}),
    });
  },

  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  },
};

export default apiClient;
