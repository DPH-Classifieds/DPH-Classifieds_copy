import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_KEY environment variables');
}

// Use default localStorage for session storage - more reliable than custom cookies
export const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
  auth: {
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true
  }
});

const syncStoredAccessToken = (token) => {
  if (!token) return;

  try {
    const sessionToken = window.sessionStorage.getItem('supabase_access_token');
    if (sessionToken || window.sessionStorage.getItem('authData')) {
      window.sessionStorage.setItem('supabase_access_token', token);
      window.localStorage.removeItem('supabase_access_token');
    } else {
      window.localStorage.setItem('supabase_access_token', token);
    }
  } catch (error) {
    console.error('Failed to sync supabase_access_token:', error);
  }

  try {
    const storage = window.sessionStorage.getItem('authData') ? window.sessionStorage : window.localStorage;
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

export const getBestAccessToken = async () => {
  try {
    // Prefer the live Supabase session first because it auto-refreshes.
    let { data: { session } } = await supabase.auth.getSession();

    // If we have a session but the access token is expired, try to refresh.
    if (session?.access_token && isTokenExpired(session.access_token)) {
      console.log('Supabase access token expired, attempting refresh...');
      const { data: { session: refreshed }, error } = await supabase.auth.refreshSession();
      if (!error && refreshed?.access_token) {
        console.log('Supabase session refreshed successfully');
        session = refreshed;
      } else {
        console.warn('Supabase session refresh failed:', error?.message);
        session = null;
      }
    }

    if (session?.access_token && !isTokenExpired(session.access_token)) {
      console.log('Got valid token from Supabase session');
      syncStoredAccessToken(session.access_token);
      return session.access_token;
    }

    // Supabase session unavailable/expired — try stored tokens.
    // If they're also expired, clear them so we don't keep sending stale tokens.
    const sessionToken = window.sessionStorage.getItem('supabase_access_token');
    if (sessionToken && !isTokenExpired(sessionToken)) {
      console.log('Got valid token from sessionStorage supabase_access_token');
      syncStoredAccessToken(sessionToken);
      return sessionToken;
    }

    const storedToken = localStorage.getItem('supabase_access_token');
    if (storedToken && !isTokenExpired(storedToken)) {
      console.log('Got valid token from localStorage supabase_access_token');
      syncStoredAccessToken(storedToken);
      return storedToken;
    }

    const sessionAuthData = window.sessionStorage.getItem('authData');
    if (sessionAuthData) {
      try {
        const parsed = JSON.parse(sessionAuthData);
        if (parsed.access_token && !isTokenExpired(parsed.access_token)) {
          console.log('Got valid token from authData sessionStorage');
          syncStoredAccessToken(parsed.access_token);
          return parsed.access_token;
        }
      } catch (e) {
        console.error('Error parsing session authData:', e);
      }
    }

    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const parsed = JSON.parse(authData);
        if (parsed.access_token && !isTokenExpired(parsed.access_token)) {
          console.log('Got valid token from authData localStorage');
          syncStoredAccessToken(parsed.access_token);
          return parsed.access_token;
        }
      } catch (e) {
        console.error('Error parsing authData:', e);
      }
    }

    console.log('No valid token found — all sources expired or missing');
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
