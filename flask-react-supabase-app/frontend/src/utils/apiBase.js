const DEFAULT_PROD_API_URL = 'https://api.dphclassifieds.com';

const isLocalHost = () => (
  typeof window !== 'undefined'
  && ['localhost', '127.0.0.1'].includes(window.location.hostname)
);

export const API_BASE_URL = (
  process.env.REACT_APP_API_URL
  || (isLocalHost() ? 'http://localhost:8000' : DEFAULT_PROD_API_URL)
).replace(/\/$/, '');

export default API_BASE_URL;
