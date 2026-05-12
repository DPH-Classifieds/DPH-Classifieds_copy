import { getBestAccessToken } from './supabaseClient';
// eslint-disable-next-line no-unused-vars
import * as authService from './authService';

const DEFAULT_PROD_API_URL = 'https://api.dphclassifieds.com';

// Base URL for API requests - prefer the injected env var, fall back to the live Railway API in production,
// and only use localhost when the app is actually running locally.
const API_BASE_URL = process.env.REACT_APP_API_URL
  || (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : DEFAULT_PROD_API_URL);

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
      let token = await getBestAccessToken();
      
      if (!token) {
        console.error('No authentication token available - user might not be logged in');
        
        // Create a descriptive error for better user experience
        const error = new Error('Authentication failed. Please log in again.');
        error.status = 401;
        error.details = { 
          message: "Token is missing! User session may have expired or not been established." 
        };
        throw error;
      }
      
      // Default headers - let browser set Origin automatically
      const headers = {
        ...(options.headers || {})
      };
      
      // Add authorization if token is available
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Create the full request options
      const requestOptions = {
        ...options,
        headers,
        credentials: 'include',
        mode: 'cors'
      };
      
      // Note: user_id and user_email are now extracted from JWT on the backend
      // Remove client-side user info injection for security
      if (requestOptions.body instanceof FormData) {
        // FormData - let browser set Content-Type with boundary automatically
        delete headers['Content-Type'];
      } 
      else if (requestOptions.headers && requestOptions.headers['Content-Type'] === 'application/json') {
        // Only stringify if body is not already a string (avoid double stringify)
        if (typeof requestOptions.body !== 'string' && requestOptions.body) {
          requestOptions.body = JSON.stringify(requestOptions.body);
        }
      }
      
      const shouldBypassCache = options.bypassCache === true;
      const separator = endpoint.includes('?') ? '&' : '?';
      const trackingParams = shouldBypassCache ? `${separator}_t=${Date.now()}` : '';
      
      // Create URLs for both localhost and 127.0.0.1
      const localhostUrl = `${API_BASE_URL}${endpoint}${trackingParams}`;
      const ipUrl = localhostUrl.replace('localhost', '127.0.0.1');
      
      // First try using the effective base URL
      const baseUrl = getEffectiveBaseUrl();
      const url = `${baseUrl}${endpoint}${trackingParams}`;
      
      const executeRequest = async (requestUrl, authToken) => {
        const attemptHeaders = {
          ...headers
        };

        if (authToken) {
          attemptHeaders['Authorization'] = `Bearer ${authToken}`;
        } else {
          delete attemptHeaders['Authorization'];
        }

        const requestOptionsForAttempt = {
          ...requestOptions,
          headers: attemptHeaders
        };

        return fetch(requestUrl, requestOptionsForAttempt);
      };

      // Make the request
      console.log(`Making ${options.method || 'GET'} request to ${url}`, requestOptions);
      let response;
      
      try {
        // Try with the effective URL first
        response = await executeRequest(url, token);
      } catch (error) {
        console.warn(`Request to ${url} failed with error:`, error);
        
        // If the effective URL is localhost and it failed, try with 127.0.0.1
        if (url.includes('localhost')) {
          console.log('Trying with 127.0.0.1 instead...');
          response = await executeRequest(ipUrl, token);
          // If this worked, use 127.0.0.1 for future requests
          window.API_BASE_URL_OVERRIDE = API_BASE_URL.replace('localhost', '127.0.0.1');
        } else if (url.includes('127.0.0.1')) {
          // If the effective URL is 127.0.0.1 and it failed, try with localhost
          console.log('Trying with localhost instead...');
          response = await executeRequest(localhostUrl, token);
          // If this worked, use localhost for future requests
          window.API_BASE_URL_OVERRIDE = API_BASE_URL;
        } else {
          // If none of the above, just throw the error
          throw error;
        }
      }

      if (response.status === 401 && !options.__retriedAfterRefresh) {
        let message = '';
        try {
          const errorData = await response.clone().json();
          message = String(errorData?.message || '').toLowerCase();
        } catch (error) {
          message = '';
        }

        if (
          message.includes('expired')
          || message.includes('invalid')
          || message.includes('unauthorized')
        ) {
          const refreshResult = await authService.refreshToken();
          const refreshedToken = refreshResult?.data?.access_token;
          if (refreshedToken) {
            token = refreshedToken;
            options.__retriedAfterRefresh = true;
            response = await executeRequest(url, token);
          }
        }
      }

      // Handle error responses
      if (!response.ok) {
        const responseContentType = response.headers.get('content-type') || '';
        const allowHeader = response.headers.get('allow');

        // Try to parse error details if available
        let errorData = {};
        try {
          if (responseContentType.includes('application/json')) {
            errorData = await response.json();
          } else {
            const rawText = await response.text();
            errorData = {
              status: response.status,
              message: response.statusText || 'Unknown error',
              raw: rawText || null
            };
          }
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
        const errorMessage = errorData.message || errorData.error || errorData.raw || `API request failed with status ${response.status}`;
        const error = new Error(errorMessage);
        error.status = response.status;
        error.details = errorData;
        error.allow = allowHeader;
        error.responseHeaders = {
          allow: allowHeader,
          contentType: responseContentType,
          cfRay: response.headers.get('cf-ray'),
          xRailwayRequestId: response.headers.get('x-railway-request-id')
        };
        error.url = url;
        error.requestOptions = {
          method: options.method || 'GET',
          headers: headers,
          hasFormData: requestOptions.body instanceof FormData
        };

        if (response.status === 405) {
          console.error('405 Method Not Allowed details:', {
            allow: allowHeader,
            responseHeaders: error.responseHeaders,
            url
          });
        }
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
    const isFormData = data instanceof FormData;
    
    // Ensure FormData is properly sent without content-type header
    // to let the browser set the correct content-type with boundary
    const headers = {
      ...(options.headers || {})
    };

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    
    console.log(`Making PUT request with ${isFormData ? 'FormData' : 'JSON'} payload to ${endpoint}`);
    
    try {
      const result = await this.request(endpoint, { 
        ...options,
        method: 'PUT',
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
   * Make a PATCH request
   * @param {string} endpoint - API endpoint path
   * @param {object} data - Request body data
   * @param {object} options - Additional request options
   * @returns {Promise<object>} - Response data
   */
  async patch(endpoint, data, options = {}) {
    const isFormData = data instanceof FormData;

    const headers = {
      ...(options.headers || {})
    };

    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    console.log(`Making PATCH request with ${isFormData ? 'FormData' : 'JSON'} payload to ${endpoint}`);

    try {
      const result = await this.request(endpoint, {
        ...options,
        method: 'PATCH',
        headers,
        body: isFormData ? data : JSON.stringify(data || {})
      });

      return result;
    } catch (error) {
      if (error.status === 500) {
        console.error('Server error occurred:', error);
        error.message = 'A server error occurred. Please try again or contact support.';
      }

      throw error;
    }
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
