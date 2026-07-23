import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as authService from '../utils/authService';
import { supabase, getSession, signInWithGoogle as supabaseSignInWithGoogle } from '../utils/supabaseClient';
import { API_BASE_URL } from '../constants/config';
import { trackEvent } from '../utils/analytics';
import { registerForPushNotifications, unregisterPushToken } from '../utils/pushNotifications';

// Treat the user as newly registered if their auth row was created within
// this many seconds of the OAuth completion. Used to fire sign_up vs login.
const NEW_USER_WINDOW_SECONDS = 120;

// Persisted snapshot of the last-known user, used to render authed UI
// immediately on cold start. Only safe public fields — no tokens here.
const CACHED_USER_KEY = 'cached_user_v1';
const CACHED_USER_FIELDS = [
  'id', 'email', 'first_name', 'last_name', 'username', 'display_name',
  'full_name', 'profile_photo', 'avatar_url', 'phone_verified', 'is_dealer',
  'is_admin', 'created_at', 'phone', 'country_code', 'bio',
];

const persistUserSnapshot = (u) => {
  if (!u) {
    AsyncStorage.removeItem(CACHED_USER_KEY).catch(() => {});
    return;
  }
  const snapshot = {};
  CACHED_USER_FIELDS.forEach((k) => {
    if (u[k] !== undefined) snapshot[k] = u[k];
  });
  AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(snapshot)).catch(() => {});
};

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const isAuthCheckingRef = useRef(false);
  const backendDisagreedOnceRef = useRef(false);
  const pushUserIdRef = useRef(null);

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

    // Step 1 — synchronously rehydrate from AsyncStorage so authed users see
    // their tab content on the very first paint. The backend check below runs
    // in parallel and overwrites if it disagrees.
    AsyncStorage.getItem(CACHED_USER_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const cached = JSON.parse(raw);
          if (cached?.id) setUser((prev) => prev || cached);
        } catch {}
      })
      .catch(() => {});

    const checkSession = async () => {
      try {
        const { user: backendUser } = await authService.getCurrentUser();
        if (backendUser) {
          setUser(backendUser);
          backendDisagreedOnceRef.current = false;
        } else {
          // Backend says no user. Don't immediately drop a cached session —
          // a single transient failure shouldn't kick the user out. Sign out
          // only on the second consecutive failure.
          if (backendDisagreedOnceRef.current) {
            setUser(null);
          } else {
            backendDisagreedOnceRef.current = true;
            await syncWithSupabase();
          }
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

  // Mirror every user state change into the cache so the next cold start
  // can rehydrate instantly.
  useEffect(() => {
    persistUserSnapshot(user);
  }, [user]);

  // Sync the Expo push token to whichever user is signed in. Keyed on user id
  // so profile-field updates don't re-trigger it; covers email/Google/session
  // restore (register) and logout (unregister) from one place.
  useEffect(() => {
    if (user?.id && user.id !== pushUserIdRef.current) {
      pushUserIdRef.current = user.id;
      registerForPushNotifications();
    } else if (!user && pushUserIdRef.current) {
      pushUserIdRef.current = null;
      unregisterPushToken();
    }
  }, [user]);

  const signIn = async (email, password, cfToken) => {
    try {
      setError(null);
      const { data, error } = await authService.signIn(email, password, cfToken);
      if (error) throw new Error(error);
      trackEvent('login', { method: 'email', platform: 'mobile' });
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

  const signUp = async (email, password, additionalData = {}, cfToken) => {
    try {
      setError(null);
      const { data, error } = await authService.signUp(email, password, additionalData, cfToken);
      if (error) throw error;
      trackEvent('sign_up', {
        method: 'email',
        platform: 'mobile',
        account_type: additionalData?.accountType || 'individual',
      });
      await syncWithSupabase({ forceBackendCheck: true });
      return { data, error: null };
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const signInWithGoogle = async () => {
    try {
      setError(null);
      const { data, error } = await supabaseSignInWithGoogle();
      if (error) throw error;

      const supabaseUser = data?.user || data?.session?.user;
      const createdAtMs = supabaseUser?.created_at ? Date.parse(supabaseUser.created_at) : null;
      const isFreshSignup = createdAtMs && (Date.now() - createdAtMs) < NEW_USER_WINDOW_SECONDS * 1000;
      try {
        if (isFreshSignup) {
          trackEvent('sign_up', { method: 'google', platform: 'mobile' });
        }
        trackEvent('login', { method: 'google', platform: 'mobile' });
      } catch (_) { /* analytics never blocks auth */ }

      // syncWithSupabase pulls /api/auth/me, which auto-creates the
      // public.users row on first Google sign-in. The returned user is
      // immediately readable from this hook's `user` state after sync.
      await syncWithSupabase({ forceBackendCheck: true });
      return { data, error: null };
    } catch (err) {
      setError(err?.message || 'Google sign-in failed');
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

  const resetPassword = async (email) => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to send reset email');
      return { error: null };
    } catch (err) {
      setError(err.message);
      return { error: err.message };
    }
  };

  const updatePassword = async (password) => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE_URL}/api/auth/update-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to update password');
      return { error: null };
    } catch (err) {
      setError(err.message);
      return { error: err.message };
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
    <AuthContext.Provider value={{ user, isLoading, error, signIn, signUp, signInWithGoogle, signOut, updateUser, syncWithSupabase, resetPassword, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
