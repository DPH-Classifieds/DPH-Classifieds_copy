const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export const resolveMediaUrl = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    return value;
  }

  const normalizedValue = value.startsWith('/') ? value : `/${value}`;
  return `${API_URL.replace(/\/$/, '')}${normalizedValue}`;
};
