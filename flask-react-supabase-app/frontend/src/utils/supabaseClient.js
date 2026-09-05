import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.REACT_APP_SUPABASE_KEY || 'local-development-anon-key';

if (!process.env.REACT_APP_SUPABASE_URL || !process.env.REACT_APP_SUPABASE_KEY) {
  console.warn('Supabase environment variables are missing; authentication is unavailable until configured.');
}

// Keep browser sessions tab-scoped. Access tokens are bearer credentials and
// should not survive a browser restart in persistent localStorage.
const authStorage = typeof window !== 'undefined' ? window.sessionStorage : undefined;

const clearLegacyPersistentAuth = () => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem('supabase_access_token');
    window.localStorage.removeItem('authData');
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('sb-') && key.endsWith('-auth-token'))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch (error) {
    console.error('Failed to clear persistent auth storage:', error);
  }
};

clearLegacyPersistentAuth();

export const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
  auth: {
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true,
    storage: authStorage
  }
});

const syncStoredAccessToken = (token) => {
  if (!token) return;

  try {
    window.sessionStorage.setItem('supabase_access_token', token);
    window.localStorage.removeItem('supabase_access_token');
  } catch (error) {
    console.error('Failed to sync supabase_access_token:', error);
  }

  try {
    const storage = window.sessionStorage;
    const authData = storage.getItem('authData');
    if (!authData) return;

    const parsed = JSON.parse(authData);
    if (!parsed || parsed.access_token === token) return;

    storage.setItem(
      'authData',
      JSON.stringify({
        ...parsed,
        access_token: token
      })
    );
  } catch (error) {
    console.error('Failed to sync authData token:', error);
  }
};

const isTokenExpired = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Expire 30 seconds early to avoid edge-case races
    return !payload.exp || (payload.exp * 1000) < (Date.now() + 30000);
  } catch {
    return true;
  }
};

// Per-page-load trace gate. Every API call goes through getBestAccessToken(),
// so an unconditional console.log here filled the console with 60+ identical
// "Got valid token from localStorage" lines per page. Trace logs now fire only
// when explicitly opted-in via ?debug-auth=1 or localStorage.DEBUG_AUTH='1',
// and the first line per source is throttled so even with the flag on you
// don't drown in repeats. Errors / warnings still fire unconditionally.
const _AUTH_TRACE = (() => {
  if (typeof window === 'undefined') return false;
  try {
    if (window.location?.search?.includes('debug-auth=1')) return true;
    return window.localStorage?.getItem('DEBUG_AUTH') === '1';
  } catch {
    return false;
  }
})();

const _seenTraceKeys = new Set();
const _trace = (key, ...args) => {
  if (!_AUTH_TRACE) return;
  if (_seenTraceKeys.has(key)) return;
  _seenTraceKeys.add(key);
  console.log(...args);
};

export const getBestAccessToken = async () => {
  try {
    // Prefer the live Supabase session first because it auto-refreshes.
    let { data: { session } } = await supabase.auth.getSession();

    // If we have a session but the access token is expired, try to refresh.
    if (session?.access_token && isTokenExpired(session.access_token)) {
      _trace('refresh-attempt', 'Supabase access token expired, attempting refresh...');
      const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
      if (!error && refreshed?.access_token) {
        _trace('refresh-ok', 'Supabase session refreshed successfully');
        session = refreshed;
      } else {
        // Refresh failures are real signal — keep at warn level so prod ops see them.
        console.warn('Supabase session refresh failed:', error?.message);
        session = null;
      }
    }

    if (session?.access_token && !isTokenExpired(session.access_token)) {
      _trace('source-session', 'Got valid token from Supabase session');
      syncStoredAccessToken(session.access_token);
      return session.access_token;
    }

    // Supabase session unavailable/expired — try tab-scoped stored tokens.
    const sessionToken = window.sessionStorage.getItem('supabase_access_token');
    if (sessionToken && !isTokenExpired(sessionToken)) {
      _trace('source-session-storage', 'Got valid token from sessionStorage supabase_access_token');
      syncStoredAccessToken(sessionToken);
      return sessionToken;
    }

    const sessionAuthData = window.sessionStorage.getItem('authData');
    if (sessionAuthData) {
      try {
        const parsed = JSON.parse(sessionAuthData);
        if (parsed.access_token && !isTokenExpired(parsed.access_token)) {
          _trace('source-session-authdata', 'Got valid token from authData sessionStorage');
          syncStoredAccessToken(parsed.access_token);
          return parsed.access_token;
        }
      } catch (e) {
        console.error('Error parsing session authData:', e);
      }
    }

    // Missing token IS signal (every API call will 401 from here), so keep
    // this one at warn level — once per page is fine, it's not in a hot loop.
    if (!_seenTraceKeys.has('no-token')) {
      _seenTraceKeys.add('no-token');
      console.warn('No valid token found — all sources expired or missing');
    }
    return null;
  } catch (error) {
    console.error('getBestAccessToken error:', error);
    return null;
  }
};

export const getAccessToken = async () => {
  return getBestAccessToken();
};

export const signUp = async (email, password) => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

export const signIn = async (email, password) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

// Start the Google OAuth flow. Supabase redirects to Google, Google redirects
// back to https://<supabase>/auth/v1/callback, Supabase then sends the user to
// `redirectTo` with the session in the URL hash. AuthCallback.jsx picks up
// from there and handles phone-verify gating + analytics events.
export const signInWithGoogle = async ({ redirectAfter = '/' } = {}) => {
  try {
    const target = redirectAfter && redirectAfter.startsWith('/') ? redirectAfter : '/';
    const redirectTo = `${window.location.origin}/auth/callback?oauth=google&redirect=${encodeURIComponent(target)}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          // Force account chooser so users with multiple Google accounts
          // can pick the right one rather than getting auto-routed.
          prompt: 'select_account',
        },
      },
    });
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    return { data: null, error };
  }
};

export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { error: null };
  } catch (error) {
    return { error };
  }
};

export const getCurrentUser = async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return { user: data.user, error: null };
  } catch (error) {
    return { user: null, error };
  }
};

export const getSession = async () => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return { session: data.session, error: null };
  } catch (error) {
    return { session: null, error };
  }
};
