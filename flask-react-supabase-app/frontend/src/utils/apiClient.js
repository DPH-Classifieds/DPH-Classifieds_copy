import { getBestAccessToken } from './supabaseClient';
import * as authService from './authService';

// Base URL for API requests - use environment variable or fallback to localhost
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Check if we need to use 127.0.0.1 instead of localhost due to CORS
// Some backends have CORS configured only for 127.0.0.1
const checkAndUpdateBaseUrl = () => {
  // If we're running on localhost, we might need to switch to 127.0.0.1
  if (window.location.hostname === 'localhost') {
    // Check if the current hostname is allowed by the server
    fetch(`${API_BASE_URL}/`, { method: 'OPTIONS' })
      .then(response => {
        console.log('CORS check response:', response.status);
        // If we get a successful response, we're good to go
        return;
      })
      .catch(error => {
        console.warn('CORS check failed with localhost, trying 127.0.0.1 instead:', error);
        // Try with 127.0.0.1 instead
        const altBaseUrl = API_BASE_URL.replace('localhost', '127.0.0.1');
        
        fetch(`${altBaseUrl}/`, { method: 'OPTIONS' })
          .then(response => {
            if (response.ok) {
              console.log('127.0.0.1 works for CORS, using it instead of localhost');
              window.API_BASE_URL_OVERRIDE = altBaseUrl;
            }
          })
          .catch(e => {
            console.error('Both localhost and 127.0.0.1 failed CORS check:', e);
          });
      });
  }
};

// Run the CORS check when the module loads
checkAndUpdateBaseUrl();

// Get the effective base URL, considering any CORS-based overrides
const getEffectiveBaseUrl = () => window.API_BASE_URL_OVERRIDE || API_BASE_URL;

/**
 * API client utility that handles authenticated requests to the backend
 */
export const apiClient = {
  /**
   * Make an authenticated API request with proper error handling for auth issues
   * @param {string} endpoint - API endpoint path (e.g., '/api/plates')
   * @param {object} options - Request options
   * @returns {Promise<object>} - Response data
   */
  async request(endpoint, options = {}) {
    try {
      // Get authorization token
      const token = await getBestAccessToken();
      
      // Log token info for debugging (obscured for security)
      if (token) {
        const tokenPreview = token.substring(0, 10) + '...' + token.substring(token.length - 5);
        console.log(`Got token: ${tokenPreview}`);
      } else {
        console.error('No authentication token available - user might not be logged in');
        
        // Create a descriptive error for better user experience
        const error = new Error('Authentication failed. Please log in again.');
        error.status = 401;
        error.details = { 
          message: "Token is missing! User session may have expired or not been established." 
        };
        throw error;
      }
      
      // Default headers
      const headers = {
        ...(options.headers || {}),
        // Add Origin header to help with CORS
        'Origin': window.location.origin
      };
      
      // Add authorization if token is available
      if (token) {
        // Make sure we use the correct Bearer format
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      // Get user info from localStorage as fallback
      const userEmail = localStorage.getItem('user_email');
      const userId = localStorage.getItem('user_id');
      
      // Create the full request options
      const requestOptions = {
        ...options,
        headers,
        // Don't use 'include' mode as it might cause issues with CORS
        credentials: 'same-origin',
        // Add mode for CORS
        mode: 'cors'
      };
      
      // For form data payloads, add user info to the form data
      if (requestOptions.body instanceof FormData) {
        if (userEmail) requestOptions.body.append('user_email', userEmail);
        if (userId) requestOptions.body.append('user_id', userId);
      } 
      // For JSON payloads, add user info to the payload
      else if (requestOptions.headers && requestOptions.headers['Content-Type'] === 'application/json') {
        let payload = {};
        
        // Try to parse existing body if it's a string
        if (typeof requestOptions.body === 'string') {
          try {
            payload = JSON.parse(requestOptions.body);
          } catch (e) {
            console.error('Error parsing JSON body:', e);
          }
        } else if (requestOptions.body) {
          payload = requestOptions.body;
        }
        
        // Add user info to payload
        if (userEmail) payload.user_email = userEmail;
        if (userId) payload.user_id = userId;
        
        // Stringify and update the request body
        requestOptions.body = JSON.stringify(payload);
      }
      
      // Add tracking info to URL for debugging
      const separator = endpoint.includes('?') ? '&' : '?';
      const trackingParams = `${separator}_t=${Date.now()}`;
      
      // Create URLs for both localhost and 127.0.0.1
      const localhostUrl = `${API_BASE_URL}${endpoint}${trackingParams}`;
      const ipUrl = localhostUrl.replace('localhost', '127.0.0.1');
      
      // First try using the effective base URL
      const baseUrl = getEffectiveBaseUrl();
      const url = `${baseUrl}${endpoint}${trackingParams}`;
      
      // Make the request
      console.log(`Making ${options.method || 'GET'} request to ${url}`, requestOptions);
      let response;
      
      try {
        // Try with the effective URL first
        response = await fetch(url, requestOptions);
      } catch (error) {
        console.warn(`Request to ${url} failed with error:`, error);
        
        // If the effective URL is localhost and it failed, try with 127.0.0.1
        if (url.includes('localhost')) {
          console.log('Trying with 127.0.0.1 instead...');
          response = await fetch(ipUrl, requestOptions);
          // If this worked, use 127.0.0.1 for future requests
          window.API_BASE_URL_OVERRIDE = API_BASE_URL.replace('localhost', '127.0.0.1');
        } else if (url.includes('127.0.0.1')) {
          // If the effective URL is 127.0.0.1 and it failed, try with localhost
          console.log('Trying with localhost instead...');
          response = await fetch(localhostUrl, requestOptions);
          // If this worked, use localhost for future requests
          window.API_BASE_URL_OVERRIDE = API_BASE_URL;
        } else {
          // If none of the above, just throw the error
          throw error;
        }
      }
      
      // Handle error responses
      if (!response.ok) {
        // Try to parse error details if available
        let errorData = {};
        try {
          errorData = await response.json();
        } catch (e) {
          // If parsing fails, create a basic error object
          errorData = { 
            status: response.status,
            message: response.statusText || 'Unknown error'
          };
        }
        
        // Special handling for 404 errors
        if (response.status === 404) {
          console.error(`API endpoint not found: ${url}`);
          console.error('This suggests the backend API route does not exist or is not configured correctly.');
          console.error('Available alternatives to try:');
          console.error('- /api/listing/plates');
          console.error('- /api/license-plates');
          console.error('- /api/plates/create');
          console.error('- /api/listings/plate');
        }
        
        // Create an error with detailed information
        const error = new Error(errorData.message || `API request failed with status ${response.status}`);
        error.status = response.status;
        error.details = errorData;
        error.url = url;
        error.requestOptions = {
          method: options.method || 'GET',
          headers: headers,
          hasFormData: requestOptions.body instanceof FormData
        };
        throw error;
      }
      
      // Handle empty responses
      if (response.status === 204) {
        return null;
      }
      
      // Parse JSON response
      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`API request to ${endpoint} failed:`, error);
      throw error;
    }
  },

  /**
   * Make a GET request
   * @param {string} endpoint - API endpoint path
   * @param {object} options - Additional request options
   * @returns {Promise<object>} - Response data
   */
  async get(endpoint, options = {}) {
    console.log(`DEBUG: Making GET request to ${endpoint}`, { options });
    try {
      const result = await this.request(endpoint, { ...options, method: 'GET' });
      console.log(`DEBUG: GET request to ${endpoint} successful:`, result);
      
      // Return the data directly - our Flask API returns JSON directly, not wrapped in a data property
      return result;
    } catch (error) {
      console.error(`DEBUG: GET request to ${endpoint} failed:`, error);
      throw error;
    }
  },

  /**
   * Make a POST request
   * @param {string} endpoint - API endpoint path
   * @param {object|FormData} data - Request body data
   * @param {object} options - Additional request options
   * @returns {Promise<object>} - Response data
   */
  async post(endpoint, data, options = {}) {
    const isFormData = data instanceof FormData;
    
    // Ensure FormData is properly sent without content-type header
    // to let the browser set the correct content-type with boundary
    const headers = {
      ...(options.headers || {})
    };

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    
    console.log(`Making POST request with ${isFormData ? 'FormData' : 'JSON'} payload to ${endpoint}`);
    
    try {
      const result = await this.request(endpoint, { 
        ...options,
        method: 'POST',
        headers,
        body: isFormData ? data : JSON.stringify(data || {})
      });
      
      return result;
    } catch (error) {
      // Enhance error with more details for debugging
      if (error.status === 500) {
        console.error('Server error occurred:', error);
        error.message = 'A server error occurred. Please try again or contact support.';
      }
      
      throw error;
    }
  },

  /**
   * Make a PUT request
   * @param {string} endpoint - API endpoint path
   * @param {object} data - Request body data
   * @param {object} options - Additional request options
   * @returns {Promise<object>} - Response data
   */
  async put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: JSON.stringify(data)
    });
  },

  /**
   * Make a DELETE request
   * @param {string} endpoint - API endpoint path
   * @param {object} options - Additional request options
   * @returns {Promise<object>} - Response data
   */
  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }
};

export default apiClient; 