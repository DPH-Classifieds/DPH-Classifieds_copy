const DEFAULT_PROD_API_URL = 'https://api.dphclassifieds.com';
const DEFAULT_DEV_API_URL = 'http://localhost:8000';

const isDev = __DEV__;

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (isDev ? DEFAULT_DEV_API_URL : DEFAULT_PROD_API_URL);

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY must be set in .env');
}

export const APP_NAME = 'DPH Classifieds';

export default { API_BASE_URL, SUPABASE_URL, SUPABASE_KEY, APP_NAME };
