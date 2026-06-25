import Toast from 'react-native-toast-message';

export const showToast = (type, title, message) => {
  Toast.show({
    type: type || 'info',
    text1: title,
    text2: message,
    visibilityTime: 4000,
    position: 'top',
  });
};

export const showError = (title, message) => showToast('error', title, message);
export const showSuccess = (title, message) => showToast('success', title, message);
export const showInfo = (title, message) => showToast('info', title, message);

export const toastApiError = (err) => {
  const status = err?.status;
  if (status === 401) { showError('Session expired', 'Please log in again.'); return; }
  if (status === 403) { showError('Not allowed', "You don't have permission to do that."); return; }
  if (status === 400) { showError('Error', err?.data?.error || err?.message || 'Invalid request.'); return; }
  if (status >= 500) { showError('Server error', 'Please try again in a moment.'); return; }
  showError('Error', err?.data?.error || err?.message || 'Something went wrong.');
};
