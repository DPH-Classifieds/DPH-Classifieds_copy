export function uploadProgressLabel({ percent = 0, phase = 'uploading', documentCount = 1 } = {}) {
  if (phase === 'scanning') {
    return `Upload complete · scanning ${documentCount > 1 ? 'documents' : 'document'}…`;
  }
  return `Uploading ${documentCount > 1 ? 'documents' : 'document'}… ${Math.round(percent)}%`;
}

/**
 * Upload FormData while exposing byte progress. Fetch does not provide upload
 * progress events, so document uploads use XHR; the response contract remains
 * the same shape callers already use with fetch.
 */
export function uploadFormDataWithProgress(url, {
  body,
  headers = {},
  onProgress,
  timeoutMs = 120000,
} = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.timeout = timeoutMs;

    Object.entries(headers).forEach(([name, value]) => {
      if (value != null) xhr.setRequestHeader(name, value);
    });

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    xhr.upload.addEventListener('load', () => {
      // The request body is fully sent while the server may still be running
      // OCR. Keep the user informed during that gap instead of leaving them
      // staring at a completed-looking button with no feedback.
      if (typeof onProgress === 'function') onProgress(100);
    });

    xhr.addEventListener('load', () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      let data = {};
      if (xhr.responseText) {
        try {
          data = contentType.includes('application/json')
            ? JSON.parse(xhr.responseText)
            : { error: 'The upload service returned an invalid response.' };
        } catch (_) {
          data = { error: 'The server returned an unreadable response.' };
        }
      }
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        data,
      });
    });

    xhr.addEventListener('error', () => reject(new Error('Network error while uploading document')));
    xhr.addEventListener('abort', () => reject(new Error('Document upload was cancelled')));
    xhr.addEventListener('timeout', () => reject(new Error('Document upload timed out. Please try again.')));

    try {
      xhr.send(body);
    } catch (error) {
      reject(error);
    }
  });
}
