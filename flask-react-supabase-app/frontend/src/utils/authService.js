import axios from 'axios';
import logger from './logger';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const CURRENT_USER_CACHE_KEY = 'dph_current_user_cache_v1';
const CURRENT_USER_CACHE_TTL_MS = 2 * 60 * 1000;

let currentUserRequestPromise = null;

const readCurrentUserCache = () => {
  try {
    const raw = sessionStorage.getItem(CURRENT_USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.timestamp || !parsed.user) return null;
    if (Date.now() - parsed.timestamp > CURRENT_USER_CACHE_TTL_MS) {
      sessionStorage.removeItem(CURRENT_USER_CACHE_KEY);
      return null;
    }
    return parsed.user;
  } catch (error) {
    logger.debug('Failed to read current user cache:', error);
    return null;
  }
};

const writeCurrentUserCache = (user) => {
  try {
    if (!user) {
      sessionStorage.removeItem(CURRENT_USER_CACHE_KEY);
      return;
    }
    sessionStorage.setItem(
      CURRENT_USER_CACHE_KEY,
      JSON.stringify({ user, timestamp: Date.now() })
    );
  } catch (error) {
    logger.debug('Failed to write current user cache:', error);
  }
};

// Add axios debug interceptors
axios.interceptors.request.use(request => {
  logger.debug('Starting Request', {
    url: request.url,
    method: request.method,
    headers: request.headers,
    data: request.data
  });
  return request;
});

axios.interceptors.response.use(
  response => {
    logger.debug('Response:', {
      status: response.status,
      headers: response.headers,
      data: response.data
    });
    return response;
  },
  error => {
    logger.error('Response Error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    return Promise.reject(error);
  }
);

// Save auth data to local storage
export const saveAuthData = (authData) => {
  logger.debug('Saving auth data to localStorage', { ...authData, access_token: '[REDACTED]' });
  localStorage.setItem('authData', JSON.stringify(authData));
};

// Get auth data from local storage
export const getAuthData = () => {
  const authData = localStorage.getItem('authData');
  const parsedData = authData ? JSON.parse(authData) : null;
  logger.debug('Retrieved auth data from localStorage', parsedData ?
    { ...parsedData, access_token: parsedData.access_token ? '[REDACTED]' : null } : null);
  return parsedData;
};

// Clear auth data from local storage
export const clearAuthData = () => {
  logger.debug('Clearing auth data from localStorage');
  localStorage.removeItem('authData');
  try {
    sessionStorage.removeItem(CURRENT_USER_CACHE_KEY);
  } catch (error) {
    logger.debug('Failed to clear current user cache:', error);
  }
};

// Helper function to get the access token
export const getAccessToken = () => {
  // Try multiple sources for the token
  const authData = getAuthData();
  let token = authData?.access_token || null;
  
  // Fallback to supabase_access_token if authData doesn't have it
  if (!token) {
    token = localStorage.getItem('supabase_access_token');
  }
  
  logger.debug('Access token retrieved:', token ? '[REDACTED TOKEN PRESENT]' : 'No token found');
  return token;
};

// Set authorization header for API requests
export const setAuthHeader = (token) => {
  if (token) {
    logger.debug('Setting Authorization header with token');
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    
    // Also update localStorage with the latest token
    const currentData = getAuthData() || {};
    saveAuthData({
      ...currentData,
      access_token: token
    });
    
    // Add to supabase_access_token as well for the apiClient usage
    localStorage.setItem('supabase_access_token', token);
  } else {
    logger.debug('Removing Authorization header');
    delete axios.defaults.headers.common['Authorization'];
  }
};

// Function to validate a token is working
export const validateToken = async (token) => {
  logger.debug('Validating token');
  if (!token) {
    logger.warn('No token provided to validate');
    return false;
  }
  
  try {
    // Try to fetch user info with the token
    const response = await axios.get(`${API_URL}/api/auth/validate-token`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.status === 200) {
      logger.debug('Token is valid');
      return true;
    } else {
      logger.warn('Token validation failed with status:', response.status);
      return false;
    }
  } catch (error) {
    logger.error('Token validation error:', error);
    return false;
  }
};

// Login user with email and password
export const signIn = async (email, password) => {
  logger.info(`Attempting to sign in user: ${email}`);
  try {
    logger.debug(`Sending login request to ${API_URL}/api/auth/login`);
    const response = await axios.post(`${API_URL}/api/auth/login`, {
      email,
      password
    });
    
    if (response.data && response.data.access_token) {
      logger.info('Login successful, received token');
      saveAuthData(response.data);
      setAuthHeader(response.data.access_token);
      // Also store in supabase_access_token for apiClient
      localStorage.setItem('supabase_access_token', response.data.access_token);
      return { data: response.data, error: null };
    } else {
      logger.error('Invalid response format from server:', response.data);
      throw new Error('Invalid response from server');
    }
  } catch (error) {
    logger.error('Login error:', error);
    return { 
      data: null, 
      error: error.response?.data?.message || error.message || 'Failed to sign in' 
    };
  }
};

// Register user with email and password
export const signUp = async (email, password, additionalData = {}) => {
  try {
    const signupPayload = {
      email,
      password,
      ...additionalData
    };
    
    const response = await axios.post(`${API_URL}/api/auth/signup`, signupPayload);
    
    // Note: Depending on your Supabase config, this might not return tokens immediately
    // as email confirmation might be required
    return { data: response.data, error: null };
  } catch (error) {
    logger.error('Signup error:', error);
    return { 
      data: null, 
      error: error.response?.data?.message || error.message || 'Failed to sign up' 
    };
  }
};

// Logout user
export const signOut = async () => {
  try {
    // Call the logout endpoint if you want to track logouts
    const token = getAccessToken();
    if (token) {
      await axios.post(`${API_URL}/api/auth/logout`, {}, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }
    
    clearAuthData();
    setAuthHeader(null);
    return { error: null };
  } catch (error) {
    logger.error('Logout error:', error);
    // Still clear local data even if the API call fails
    clearAuthData();
    setAuthHeader(null);
    return { error: error.message };
  }
};

// Get current user information
export const getCurrentUser = async (forceRefresh = false) => {
  logger.debug('Getting current user information');
  const token = getAccessToken();
  if (!token) {
    logger.debug('No access token available, user not logged in');
    return { user: null, error: null };
  }

  if (!forceRefresh) {
    const cachedUser = readCurrentUserCache();
    if (cachedUser) {
      logger.debug('Returning cached current user');
      return { user: cachedUser, error: null, cached: true };
    }
  }

  if (!forceRefresh && currentUserRequestPromise) {
    logger.debug('Reusing in-flight current user request');
    return currentUserRequestPromise;
  }

  const request = (async () => {
    logger.debug(`Sending request to ${API_URL}/api/auth/me with token`);
    const response = await axios.get(`${API_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    logger.info('User info retrieved successfully:', response.data);
    writeCurrentUserCache(response.data);
    return { user: response.data, error: null };
  })();

  if (!forceRefresh) {
    currentUserRequestPromise = request;
  }

  try {
    return await request;
  } catch (error) {
    logger.error('Get user error:', error);

    if (error.response && error.response.status === 401) {
      logger.warn('Unauthorized (token may be expired)');
      const backendMessage = String(error.response?.data?.message || '').toLowerCase();
      if (
        backendMessage.includes('expired')
        || backendMessage.includes('invalid')
        || backendMessage.includes('unauthorized')
      ) {
        clearAuthData();
        setAuthHeader(null);
      }
    }

    return {
      user: null,
      error: error.response?.data?.message || error.message || 'Failed to get user information'
    };
  } finally {
    if (!forceRefresh) {
      currentUserRequestPromise = null;
    }
  }
};

export const getCurrentUserCached = getCurrentUser;

// Refresh the authentication token
export const refreshToken = async () => {
  try {
    const authData = getAuthData();
    if (!authData || !authData.refresh_token) {
      return { data: null, error: 'No refresh token available' };
    }
    
    const response = await axios.post(`${API_URL}/api/auth/refresh`, {
      refresh_token: authData.refresh_token
    });
    
    if (response.data && response.data.access_token) {
      saveAuthData(response.data);
      setAuthHeader(response.data.access_token);
      return { data: response.data, error: null };
    } else {
      throw new Error('Invalid response from server');
    }
  } catch (error) {
    logger.error('Token refresh error:', error);
    return { 
      data: null, 
      error: error.response?.data?.message || error.message || 'Failed to refresh token' 
    };
  }
};

// Initialize auth - call this once when the app starts
export const initializeAuth = () => {
  logger.info('Initializing authentication');
  const token = getAccessToken();
  if (token) {
    logger.debug('Found existing token, setting auth header');
    setAuthHeader(token);
  } else {
    logger.debug('No existing token found');
  }
}; 
