import { createClient } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { SUPABASE_URL, SUPABASE_KEY } from '../constants/config';

if (!SUPABASE_URL || !SUPABASE_KEY) {
}

export const supabase = createClient(SUPABASE_URL || '', SUPABASE_KEY || '', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // false because we manually pick up the OAuth redirect via deep links
    // (see signInWithGoogle below).
    detectSessionInUrl: false,
  },
});

export const getSession = async () => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return { session: data.session, error: null };
  } catch (error) {
    return { session: null, error };
  }
};

// Deep-link target Supabase redirects to after Google completes. Matches the
// scheme declared in app.json ("dphclassifieds"). Must be added as an
// allowed redirect in Supabase → Auth → URL Configuration → Additional
// Redirect URLs as `dphclassifieds://auth-callback`.
const MOBILE_REDIRECT_URL = Linking.createURL('auth-callback');

const parseHashParams = (url) => {
  if (!url) return null;
  try {
    const parsed = Linking.parse(url);
    // Supabase puts tokens in the URL fragment (after #), expo-linking
    // exposes those as parsed.queryParams when fragmentRouting is enabled,
    // but to be safe we parse the raw URL ourselves.
    const fragment = url.split('#')[1];
    if (!fragment) return parsed.queryParams || null;
    const search = new URLSearchParams(fragment);
    const out = {};
    search.forEach((value, key) => { out[key] = value; });
    return out;
  } catch (_) {
    return null;
  }
};

// Kick off the Google OAuth flow. Opens an in-app browser to Supabase's
// hosted OAuth URL, waits for the redirect back to dphclassifieds://auth-callback,
// then extracts the access/refresh tokens from the redirect URL hash and
// asks supabase-js to install the session.
export const signInWithGoogle = async () => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: MOBILE_REDIRECT_URL,
        skipBrowserRedirect: true,
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
    if (!data?.url) throw new Error('Google sign-in unavailable. Try again.');

    const result = await WebBrowser.openAuthSessionAsync(data.url, MOBILE_REDIRECT_URL);
    if (result.type !== 'success' || !result.url) {
      return { data: null, error: result.type === 'cancel'
        ? new Error('Sign-in cancelled')
        : new Error('Sign-in did not complete') };
    }

    const params = parseHashParams(result.url) || {};
    if (params.error_description) {
      return { data: null, error: new Error(decodeURIComponent(String(params.error_description))) };
    }
    if (!params.access_token || !params.refresh_token) {
      return { data: null, error: new Error('Sign-in returned no session tokens.') };
    }

    const { data: setData, error: setErr } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (setErr) throw setErr;
    return { data: setData, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

export default supabase;
