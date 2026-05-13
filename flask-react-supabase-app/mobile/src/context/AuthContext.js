import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as authService from '../utils/authService';
import { supabase, getSession } from '../utils/supabaseClient';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const isAuthCheckingRef = useRef(false);

  const syncWithSupabase = async ({ forceBackendCheck = false } = {}) => {
    if (isAuthCheckingRef.current) return false;
    isAuthCheckingRef.current = true;
    try {
      const { data: { session: refreshedSession } } = await supabase.auth.refreshSession();
      if (refreshedSession?.access_token) {
        authService.setAuthHeader(refreshedSession.access_token);
      }
      try {
        const { user: backendUser } = await authService.getCurrentUser(forceBackendCheck);
        if (backendUser) {
          setUser(prev => ({
            ...(prev || {}),
            ...backendUser,
            access_token: prev?.access_token || backendUser.access_token
          }));
          return true;
        }
      } catch (err) {
      }
      const { session } = await getSession();
      if (session?.user) {
        const enhancedUser = {
          ...session.user,
          access_token: session.access_token,
          session
        };
        setUser(enhancedUser);
        authService.setAuthHeader(session.access_token);
        return true;
      }
      return false;
    } catch (err) {
      return false;
    } finally {
      isAuthCheckingRef.current = false;
    }
  };

  useEffect(() => {
    authService.initializeAuth();
    const checkSession = async () => {
      try {
        const { user: backendUser } = await authService.getCurrentUser();
        if (backendUser) {
          setUser(backendUser);
        } else {
          await syncWithSupabase();
        }
      } catch (err) {
        await syncWithSupabase();
      } finally {
        setIsLoading(false);
      }
    };
    checkSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        authService.setAuthHeader(session.access_token);
        const { user: backendUser } = await authService.getCurrentUser();
        if (backendUser) {
          setUser({ ...backendUser, access_token: session.access_token, session });
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });
    return () => subscription?.unsubscribe();
  }, []);

  const signIn = async (email, password) => {
    try {
      setError(null);
      const { data, error } = await authService.signIn(email, password);
      if (error) throw new Error(error);
      if (data?.user) {
        setUser(data.user);
        await syncWithSupabase({ forceBackendCheck: true });
        return data;
      }
      const { user: fetchedUser } = await authService.getCurrentUser(true);
      if (fetchedUser) setUser(fetchedUser);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const signUp = async (email, password, additionalData = {}) => {
    try {
      setError(null);
      const { data, error } = await authService.signUp(email, password, additionalData);
      if (error) throw error;
      await syncWithSupabase({ forceBackendCheck: true });
      return { data, error: null };
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const signOut = async () => {
    try {
      setError(null);
      await authService.signOut();
      await supabase.auth.signOut();
      setUser(null);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const updateUser = (userData) => {
    setUser(prev => {
      const updated = { ...(prev || {}), ...userData };
      try {
        const { access_token, session, ...safeData } = updated;
        AsyncStorage.setItem('user_profile', JSON.stringify(safeData)).catch(() => {});
      } catch {}
      return updated;
    });
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, error, signIn, signUp, signOut, updateUser, syncWithSupabase }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
