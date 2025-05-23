import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Add axios debug interceptors
axios.interceptors.request.use(request => {
  console.log('Starting Request', {
    url: request.url,
    method: request.method,
    headers: request.headers,
    data: request.data
  });
  return request;
});

axios.interceptors.response.use(
  response => {
    console.log('Response:', {
      status: response.status,
      headers: response.headers,
      data: response.data
    });
    return response;
  },
  error => {
    console.error('Response Error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    return Promise.reject(error);
  }
);

// Save auth data to local storage
const saveAuthData = (authData) => {
  console.log('Saving auth data to localStorage', { ...authData, access_token: '[REDACTED]' });
  localStorage.setItem('authData', JSON.stringify(authData));
};

// Get auth data from local storage
const getAuthData = () => {
  const authData = localStorage.getItem('authData');
  const parsedData = authData ? JSON.parse(authData) : null;
  console.log('Retrieved auth data from localStorage', parsedData ? 
    { ...parsedData, access_token: parsedData.access_token ? '[REDACTED]' : null } : null);
  return parsedData;
};

// Clear auth data from local storage
const clearAuthData = () => {
  console.log('Clearing auth data from localStorage');
  localStorage.removeItem('authData');
};

// Helper function to get the access token
export const getAccessToken = () => {
  const authData = getAuthData();
  const token = authData?.access_token || null;
  console.log('Access token retrieved:', token ? '[REDACTED TOKEN PRESENT]' : 'No token found');
  return token;
};

// Set authorization header for API requests
export const setAuthHeader = (token) => {
  if (token) {
    console.log('Setting Authorization header with token');
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
    console.log('Removing Authorization header');
    delete axios.defaults.headers.common['Authorization'];
  }
};

// Function to validate a token is working
export const validateToken = async (token) => {
  console.log('Validating token');
  if (!token) {
    console.warn('No token provided to validate');
    return false;
  }
  
  try {
    // Try to fetch user info with the token
    const response = await axios.get(`${API_URL}/api/auth/validate-token`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.status === 200) {
      console.log('Token is valid');
      return true;
    } else {
      console.warn('Token validation failed with status:', response.status);
      return false;
    }
  } catch (error) {
    console.error('Token validation error:', error);
    return false;
  }
};

// Login user with email and password
export const signIn = async (email, password) => {
  console.log(`Attempting to sign in user: ${email}`);
  try {
    console.log(`Sending login request to ${API_URL}/api/auth/login`);
    const response = await axios.post(`${API_URL}/api/auth/login`, { email, password });
    
    if (response.data && response.data.access_token) {
      console.log('Login successful, received token');
      saveAuthData(response.data);
      setAuthHeader(response.data.access_token);
      return { data: response.data, error: null };
    } else {
      console.error('Invalid response format from server:', response.data);
      throw new Error('Invalid response from server');
    }
  } catch (error) {
    console.error('Login error:', error);
    return { 
      data: null, 
      error: error.response?.data?.message || error.message || 'Failed to sign in' 
    };
  }
};

// Register user with email and password
export const signUp = async (email, password) => {
  try {
    const response = await axios.post(`${API_URL}/api/auth/signup`, { email, password });
    
    // Note: Depending on your Supabase config, this might not return tokens immediately
    // as email confirmation might be required
    return { data: response.data, error: null };
  } catch (error) {
    console.error('Signup error:', error);
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
    console.error('Logout error:', error);
    // Still clear local data even if the API call fails
    clearAuthData();
    setAuthHeader(null);
    return { error: error.message };
  }
};

// Get current user information
export const getCurrentUser = async () => {
  console.log('Getting current user information');
  try {
    const token = getAccessToken();
    if (!token) {
      console.log('No access token available, user not logged in');
      return { user: null, error: null };
    }
    
    console.log(`Sending request to ${API_URL}/api/auth/me with token`);
    const response = await axios.get(`${API_URL}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('User info retrieved successfully:', response.data);
    return { user: response.data, error: null };
  } catch (error) {
    console.error('Get user error:', error);
    
    // If unauthorized (e.g., token expired), clear local data
    if (error.response && error.response.status === 401) {
      console.warn('Unauthorized, clearing auth data');
      clearAuthData();
      setAuthHeader(null);
    }
    
    return { 
      user: null, 
      error: error.response?.data?.message || error.message || 'Failed to get user information' 
    };
  }
};

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
    console.error('Token refresh error:', error);
    return { 
      data: null, 
      error: error.response?.data?.message || error.message || 'Failed to refresh token' 
    };
  }
};

// Initialize auth - call this once when the app starts
export const initializeAuth = () => {
  console.log('Initializing authentication');
  const token = getAccessToken();
  if (token) {
    console.log('Found existing token, setting auth header');
    setAuthHeader(token);
  } else {
    console.log('No existing token found');
  }
}; 