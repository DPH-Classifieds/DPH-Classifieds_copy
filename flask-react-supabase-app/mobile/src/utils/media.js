import { API_BASE_URL } from '../constants/config';

export const resolveMediaUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('file:') ||
    value.startsWith('content:') ||
    value.startsWith('ph:')
  ) {
    return value;
  }

  const normalizedValue = value.startsWith('/') ? value : `/${value}`;
  return `${API_BASE_URL.replace(/\/$/, '')}${normalizedValue}`;
};
