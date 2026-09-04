import API_BASE_URL from './apiBase';
import { getBestAccessToken } from './supabaseClient';
// eslint-disable-next-line no-unused-vars
import * as authService from './authService';
import logger from './logger';
const transientFailureCounts = new Map();

const resetTransientFailures = (endpoint) => transientFailureCounts.delete(endpoint);

const userFacingTransientMessage = (endpoint) => {
  const nextCount = (transientFailureCounts.get(endpoint) || 0) + 1;
  transientFailureCounts.set(endpoint, nextCount);
  return nextCount > 2
    ? 'The server is busy. Please try again in a few minutes.'
    : 'We could not complete that right now. Please try again.';
};

// Base URL for API requests - prefer the injected env var, fall back to the live Railway API in production,
// and only use localhost when the app is actually running locally.
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
    let didRetryAfterRefresh = false;
    try {
      // Get authorization token
      let token = await getBestAccessToken();
      
      if (!token) {
        // If storage is temporarily out of sync, try a one-shot refresh before
        // giving up. This avoids false 401s on admin surfaces during auth
        // hydration and after token rotation.
        const refreshResult = await authService.refreshToken();
        token = refreshResult?.data?.access_token || null;
      }

      if (!token) {
        logger.debug('No authentication token available - user might not be logged in');

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

      // Forward acting-as dealership header when an admin is impersonating a dealership
      if (typeof window !== 'undefined' && window.__ACTING_AS_DEALERSHIP__) {
        headers['X-Acting-As-Dealership'] = window.__ACTING_AS_DEALERSHIP__;
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

      logger.debug(`Making ${options.method || 'GET'} request to ${url}`, requestOptions);
      let response;

      try {
        response = await executeRequest(url, token);
      } catch (error) {
        logger.debug(`Request to ${url} failed with error:`, error);

        if (url.includes('localhost')) {
          logger.debug('Trying with 127.0.0.1 instead...');
          response = await executeRequest(ipUrl, token);
          window.API_BASE_URL_OVERRIDE = API_BASE_URL.replace('localhost', '127.0.0.1');
        } else if (url.includes('127.0.0.1')) {
          logger.debug('Trying with localhost instead...');
          response = await executeRequest(localhostUrl, token);
          window.API_BASE_URL_OVERRIDE = API_BASE_URL;
        } else {
          throw error;
        }
      }

      if (response.status === 401 && !didRetryAfterRefresh) {
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
            didRetryAfterRefresh = true;
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
        
        if (response.status === 404) {
          logger.debug(`API endpoint not found: ${url}`);
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
        if (response.status === 429 || response.status >= 500) {
          error.userMessage = userFacingTransientMessage(endpoint);
        }
        error.requestOptions = {
          method: options.method || 'GET',
          headers: headers,
          hasFormData: requestOptions.body instanceof FormData
        };

        if (response.status === 405) {
          logger.debug('405 Method Not Allowed details:', {
            allow: allowHeader,
            responseHeaders: error.responseHeaders,
            url
          });
        }
        throw error;
      }
      
      // Handle empty responses
      if (response.status === 204) {
        resetTransientFailures(endpoint);
        return null;
      }
      
      // Parse JSON response
      const data = await response.json();
      resetTransientFailures(endpoint);
      return data;
    } catch (error) {
      // Log only in development; callers decide how to surface to users.
      logger.debug(`API request to ${endpoint} failed:`, error);
      if (!error.userMessage && (!error.status || error.status >= 500)) {
        error.userMessage = userFacingTransientMessage(endpoint);
      }
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
    logger.debug(`GET ${endpoint}`, { options });
    try {
      const result = await this.request(endpoint, { ...options, method: 'GET' });
      logger.debug(`GET ${endpoint} OK`);
      return result;
    } catch (error) {
      logger.debug(`GET ${endpoint} failed:`, error);
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
    
    logger.debug(`POST (${isFormData ? 'FormData' : 'JSON'}) ${endpoint}`);
    
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
        logger.debug('Server error occurred:', error);
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
    
    logger.debug(`PUT (${isFormData ? 'FormData' : 'JSON'}) ${endpoint}`);
    
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
        logger.debug('Server error occurred:', error);
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

    logger.debug(`PATCH (${isFormData ? 'FormData' : 'JSON'}) ${endpoint}`);

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
        logger.debug('Server error occurred:', error);
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
