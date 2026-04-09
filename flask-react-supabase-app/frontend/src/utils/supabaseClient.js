import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_KEY environment variables');
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
  auth: {
    detectSessionInUrl: false,
    storage: {
      getItem: async (key) => {
        const cookies = document.cookie.split('; ');
        const cookie = cookies.find(c => c.startsWith(`${key}=`));
        return cookie ? cookie.split('=')[1] : null;
      },
      setItem: async (key, value) => {
        const secure = window.location.protocol === 'https:';
        document.cookie = `${key}=${value}; path=/; ${secure ? 'secure;' : ''} SameSite=Lax; max-age=3600 * 24 * 7`;
      },
      removeItem: async (key) => {
        document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      }
    },
    cookieSpace: 'dph'
  }
});

export const getBestAccessToken = async () => {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (session?.access_token) {
      return session.access_token;
    }

    const { data: { session: refreshSession } } = await supabase.auth.refreshSession();
    if (refreshSession?.access_token) {
      return refreshSession.access_token;
    }

    if (window.location.pathname !== '/login' && !window.location.pathname.includes('/auth/callback')) {
      window.location.href = '/login';
    }

    return null;
  } catch (error) {
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