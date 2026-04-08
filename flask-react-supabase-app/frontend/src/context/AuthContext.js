import React, { createContext, useContext, useState, useEffect } from 'react';
import * as authService from '../utils/authService';
import { supabase, getSession } from '../utils/supabaseClient';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Function to sync with Supabase's session
  const syncWithSupabase = async () => {
    console.log('Syncing auth state with Supabase');
    try {
      // Always check with our backend first for admin status
      try {
        const { user: backendUser, error: userError } = await authService.getCurrentUser();
        
        if (backendUser) {
          console.log('Backend user found:', backendUser.email, 'Admin:', backendUser.is_admin);
          // Keep any existing values but update with backend data
          setUser(prevUser => ({
            ...(prevUser || {}),
            ...backendUser,
            // Keep the access_token if it exists in the current user object
            access_token: prevUser?.access_token || backendUser.access_token
          }));
          return true;
        } else if (userError) {
          console.error('Error checking backend user:', userError);
        }
      } catch (err) {
        console.error('Error syncing with backend:', err);
      }
    
      // Continue with Supabase session check as backup
      const { session, error } = await getSession();
      
      console.log('Supabase session check result:', { 
        hasSession: !!session, 
        hasUser: !!(session?.user),
        error: error || 'none',
        accessToken: session?.access_token ? 'present' : 'missing'
      });
      
      if (session && session.user) {
        console.log('Supabase session found, setting user:', session.user.email);
        console.log('Access token exists:', !!session.access_token);
        
        // Include the access_token and full session data in the user object
        const enhancedUser = {
          ...session.user,
          access_token: session.access_token,
          session: session
        };
        
        console.log('Setting enhanced user object with access_token');
        setUser(enhancedUser);
        
        // Store token in localStorage as a backup
        localStorage.setItem('supabase_access_token', session.access_token);
        
        // Force update the authService's headers with new token
        authService.setAuthHeader(session.access_token);
        
        return true;
      } else if (user) {
        console.log('Supabase session not found, but AuthContext has user:', user.email);
        
        // Try to recover token from localStorage if it exists
        const storedToken = localStorage.getItem('supabase_access_token');
        if (storedToken && !user.access_token) {
          console.log('Recovering access token from localStorage');
          
          // Let's validate the token before using it
          try {
            // Attempt a simple validation request to Supabase
            const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/auth/v1/user`, {
              headers: {
                'Authorization': `Bearer ${storedToken}`,
                'apikey': process.env.REACT_APP_SUPABASE_KEY || 'public-anon-key'
              }
            });
            
            if (response.ok) {
              console.log('Recovered token is valid');
              const updatedUser = {
                ...user,
                access_token: storedToken
              };
              setUser(updatedUser);
              
              // Update authService headers with recovered token
              authService.setAuthHeader(storedToken);
              
              return true;
            } else {
              console.warn('Recovered token is invalid, status:', response.status);
              // Token is invalid, remove it from storage
              localStorage.removeItem('supabase_access_token');
              
              // Let's try to refresh the session
              console.log('Attempting to refresh the session...');
              const { data } = await supabase.auth.refreshSession();
              
              if (data?.session?.access_token) {
                console.log('Session refreshed successfully');
                const refreshedUser = {
                  ...user,
                  access_token: data.session.access_token
                };
                setUser(refreshedUser);
                
                // Store the new token
                localStorage.setItem('supabase_access_token', data.session.access_token);
                
                // Update authService headers with new token
                authService.setAuthHeader(data.session.access_token);
                
                return true;
              }
            }
          } catch (error) {
            console.error('Error validating recovered token:', error);
          }
        }
        
        // If we have a user but no valid token, we should try to reauthenticate
        return false;
      } else {
        console.log('No session or user found in context');
        
        // Try to recover token from localStorage if it exists
        const storedToken = localStorage.getItem('supabase_access_token');
        if (storedToken) {
          console.log('Found token in localStorage, but no user - attempting to validate token');
          
          try {
            // Attempt a simple validation request to Supabase
            const response = await fetch(`${process.env.REACT_APP_SUPABASE_URL}/auth/v1/user`, {
              headers: {
                'Authorization': `Bearer ${storedToken}`,
                'apikey': process.env.REACT_APP_SUPABASE_KEY || 'public-anon-key'
              }
            });
            
            if (response.ok) {
              console.log('Token is valid, retrieving user details');
              const userData = await response.json();
              
              if (userData) {
                console.log('User data retrieved from token validation');
                const recoveredUser = {
                  ...userData,
                  access_token: storedToken
                };
                setUser(recoveredUser);
                
                // Update authService headers with recovered token
                authService.setAuthHeader(storedToken);
                
                return true;
              }
            } else {
              console.warn('Token in localStorage is invalid, removing');
              localStorage.removeItem('supabase_access_token');
            }
          } catch (error) {
            console.error('Error validating localStorage token:', error);
            localStorage.removeItem('supabase_access_token');
          }
        }
        
        return false;
      }
    } catch (err) {
      console.error('Error syncing with Supabase:', err);
      return false;
    }
  };

  useEffect(() => {
    // Initialize the auth header
    authService.initializeAuth();
    
    // Check for active session on mount
    const checkSession = async () => {
      try {
        // First check our custom backend
        const { user: backendUser, error: userError } = await authService.getCurrentUser();
        
        if (backendUser) {
          console.log('Backend user found:', backendUser.email);
          setUser(backendUser);
        } else if (userError) {
          console.error('Error checking backend user:', userError);
          // If backend check fails, try Supabase directly
          await syncWithSupabase();
        } else {
          // If no backend user, try Supabase directly
          await syncWithSupabase();
        }
      } catch (err) {
        console.error('Error checking auth session:', err);
        setError(err.message);
        
        // Still try Supabase as a fallback
        await syncWithSupabase();
      } finally {
        setIsLoading(false);
      }
    };
    
    checkSession();
    
    // Set up Supabase auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Supabase auth state changed:', event);
        if (session && session.user) {
          localStorage.setItem('supabase_access_token', session.access_token);
          authService.setAuthHeader(session.access_token);

          const { user: backendUser } = await authService.getCurrentUser();
          if (backendUser) {
            setUser({
              ...backendUser,
              access_token: session.access_token,
              session
            });
          } else {
            setUser({
              ...session.user,
              access_token: session.access_token,
              session
            });
          }
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
        }
      }
    );
    
    // Setup refresh token interval
    const refreshInterval = setInterval(async () => {
      const token = authService.getAccessToken();
      if (token) {
        try {
          await authService.refreshToken();
        } catch (err) {
          console.error('Token refresh failed:', err);
        }
      }
    }, 30 * 60 * 1000); // Refresh every 30 minutes
    
    return () => {
      subscription?.unsubscribe();
      clearInterval(refreshInterval);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  // We can't add syncWithSupabase to the deps array as it would cause infinite loops

  const signUp = async (email, password, additionalData = {}, turnstileToken = '') => {
    try {
      setError(null);
      
      const { data, error } = await authService.signUp(email, password, additionalData, turnstileToken);
      
      if (error) {
        throw error;
      }
      
      // Also sync with Supabase after signup
      await syncWithSupabase();
      
      return { data, error: null };
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const signIn = async (email, password) => {
    try {
      setError(null);
      
      const { data, error } = await authService.signIn(email, password);
      
      if (error) {
        console.error("Sign in error:", error);
        throw new Error(error);
      }
      
      // Update user state - Use user data from the login response directly if available
      if (data && data.user) {
        console.log("Login successful, using user data from response:", data.user.email);
        setUser(data.user);
        
        // Also sync with Supabase after login
        await syncWithSupabase();
        
        return data;
      }
      
      // If the login response doesn't include user data, try to fetch it
      console.log("Login successful, fetching user data");
      try {
        const { user, error: userError } = await authService.getCurrentUser();
        
        if (userError) {
          console.error("Error fetching user after login:", userError);
          throw new Error(userError);
        }
        
        if (user) {
          console.log("User data successfully retrieved:", user.email);
          setUser(user);
          
          // Also sync with Supabase after login
          await syncWithSupabase();
        } else {
          console.error("No user data returned after login");
          throw new Error("Failed to get user data after login");
        }
      } catch (userErr) {
        console.error("Failed to fetch user after login:", userErr);
        // We still have the auth token, so we can create a minimal user object
        // This allows the user to still be logged in even if profile fetch fails
        const minimalUser = { 
          email: email,
          id: data.user?.id || "unknown"
        };
        console.log("Setting minimal user data:", minimalUser);
        setUser(minimalUser);
        
        // Also sync with Supabase after login
        await syncWithSupabase();
      }
      
      return data;
    } catch (err) {
      console.error("Sign in process failed:", err);
      setError(err.message || "Authentication failed");
      throw err;
    }
  };

  const signOut = async () => {
    try {
      setError(null);
      
      const { error } = await authService.signOut();
      
      if (error) {
        throw error;
      }
      
      // Also sign out from Supabase
      await supabase.auth.signOut();
      
      setUser(null);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const resetPassword = async (email) => {
    try {
      setError(null);
      
      // This functionality needs to be implemented in the backend
      // For now, we'll just placeholder it with a message
      console.warn('Reset password functionality needs to be implemented in the backend');
      
      return true;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updatePassword = async (newPassword) => {
    try {
      setError(null);
      
      // This functionality needs to be implemented in the backend
      // For now, we'll just placeholder it with a message
      console.warn('Update password functionality needs to be implemented in the backend');
      
      return true;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const value = {
    user,
    isLoading,
    error,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    syncWithSupabase,
    updateUser: (userData) => {
      console.log('AuthContext: Updating user with data:', userData);
      setUser(prevUser => {
        const updatedUser = {
          ...(prevUser || {}),
          ...userData
        };
        // Also update localStorage to persist changes
        try {
          localStorage.setItem('user', JSON.stringify(updatedUser));
          console.log('AuthContext: User data saved to localStorage');
        } catch (e) {
          console.error('AuthContext: Failed to save user to localStorage:', e);
        }
        return updatedUser;
      });
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext; 
