import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LIGHT_COLORS, DARK_COLORS } from '../constants/theme';

const STORAGE_KEY = 'dph-mobile-theme';

const ThemeContext = createContext({
  theme: 'light',
  colors: LIGHT_COLORS,
  setTheme: () => {},
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
  // Cold start always renders light first — AsyncStorage is async, so a
  // previously-saved 'dark' preference (if any) applies a moment later once
  // it resolves, not synchronously on first paint.
  const [theme, setThemeState] = useState('light');

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (mounted && (saved === 'light' || saved === 'dark')) {
          setThemeState(saved);
        }
      })
      .catch(() => {
        // AsyncStorage unavailable — stay on the light default.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setTheme = (next) => {
    setThemeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // ignore write failures
    });
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const value = useMemo(
    () => ({
      theme,
      colors: theme === 'dark' ? DARK_COLORS : LIGHT_COLORS,
      setTheme,
      toggleTheme,
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
