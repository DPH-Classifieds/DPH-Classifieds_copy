import { createClient } from '@supabase/supabase-js';

// These values should be in your .env file in a production environment
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://ltjatsyhpmvewancqdjw.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0amF0c3locG12ZXdhbmNxZGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIzMjAxMDQsImV4cCI6MjA1Nzg5NjEwNH0.k7stpvp2saDgVlqv9d-alX0sMsyQtFMWeYHdojZ68I8';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to get the most reliable access token for API calls
export const getBestAccessToken = async () => {
  try {
    console.log('Getting best available access token');
    
    // First try to get the current session
    const { data: sessionData } = await supabase.auth.getSession();
    
    if (sessionData?.session?.access_token) {
      console.log('Got fresh access token from session');
      localStorage.setItem('supabase_access_token', sessionData.session.access_token);
      return sessionData.session.access_token;
    }

    // If no session, try to refresh it
    const { data: refreshData } = await supabase.auth.refreshSession();
    if (refreshData?.session?.access_token) {
      console.log('Got token from refreshed session');
      localStorage.setItem('supabase_access_token', refreshData.session.access_token);
      return refreshData.session.access_token;
    }

    // If refresh failed, check localStorage
    const localToken = localStorage.getItem('supabase_access_token');
    if (localToken) {
      // Validate the token
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          'Authorization': `Bearer ${localToken}`,
          'apikey': supabaseKey
        }
      });

      if (response.ok) {
        console.log('Using validated token from localStorage');
        return localToken;
      } else {
        console.warn('localStorage token is invalid');
        localStorage.removeItem('supabase_access_token');
      }
    }

    // No valid token found, redirect to login if not already there
    if (window.location.pathname !== '/login' && !window.location.pathname.includes('/auth/callback')) {
      console.log('No valid token found, redirecting to login...');
      localStorage.setItem('returnUrl', window.location.pathname);
      window.location.href = '/login';
    }

    return null;
  } catch (error) {
    console.error('Error in getBestAccessToken:', error);
    return null;
  }
};

// Helper function to get the access token for API calls (kept for backward compatibility)
export const getAccessToken = async () => {
  return getBestAccessToken();
};

// Helper functions for authentication
export const signUp = async (email, password) => {
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error signing up:', error.message);
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
    console.error('Error signing in:', error.message);
    return { data: null, error };
  }
};

export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { error: null };
  } catch (error) {
    console.error('Error signing out:', error.message);
    return { error };
  }
};

export const getCurrentUser = async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return { user: data.user, error: null };
  } catch (error) {
    console.error('Error getting current user:', error.message);
    return { user: null, error };
  }
};

export const getSession = async () => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return { session: data.session, error: null };
  } catch (error) {
    console.error('Error getting session:', error.message);
    return { session: null, error };
  }
}; 