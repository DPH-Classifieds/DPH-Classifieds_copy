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

export const getBestAccessToken = async () => {
  try {
    // First, try to get token from localStorage (where authService stores it)
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const parsed = JSON.parse(authData);
        if (parsed.access_token) {
          console.log('Got token from authData localStorage');
          return parsed.access_token;
        }
      } catch (e) {
        console.error('Error parsing authData:', e);
      }
    }

    // Fallback to supabase_access_token
    const storedToken = localStorage.getItem('supabase_access_token');
    if (storedToken) {
      console.log('Got token from supabase_access_token');
      return storedToken;
    }

    // Try Supabase session as last resort
    const { data: { session }, error } = await supabase.auth.getSession();
    if (session?.access_token) {
      console.log('Got token from Supabase session');
      return session.access_token;
    }

    console.log('No valid token found');
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
