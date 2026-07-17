import apiClient from './apiClient';

// Best-effort client-side error report -> backend app_errors -> admin "Errors" tab.
// NEVER throws: reporting a failure must not create a new one. Precursor to Sentry.
export async function reportError(context, message, { errorCode = null, details = null } = {}) {
  try {
    await apiClient.post('/api/errors', {
      context,
      message: String(message || '').slice(0, 2000),
      error_code: errorCode,
      details,
      url: typeof window !== 'undefined' ? window.location.href : null,
    });
  } catch (_e) {
    // swallow — logging must never break the UI
  }
}

export default reportError;
