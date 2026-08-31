import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../utils/apiClient';
import { useAuth } from './AuthContext';
import { buildListingSaveData } from '../utils/listingRouteState';

const SavedListingsContext = createContext(null);

const normalizeSavedType = (listingType, listingId) => {
  const type = String(listingType || '').toLowerCase();
  const normalizedType = (
    type === 'cars' ? 'car' :
    type === 'car' ? 'car' :
    type === 'bikes' ? 'bike' :
    type === 'bike' ? 'bike' :
    type === 'parts' || type === 'car-parts' ? 'part' :
    type === 'part' ? 'part' :
    type === 'plates' ? 'plate' :
    type === 'plate' ? 'plate' :
    type
  );

  if (!normalizedType || !listingId) {
    return null;
  }

  return `${normalizedType}:${listingId}`;
};

const buildLoginRedirect = () => {
  if (typeof window === 'undefined') {
    return '/login';
  }

  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/login?redirect=${encodeURIComponent(path)}`;
};

export const SavedListingsProvider = ({ children }) => {
  const { user, isLoading: authLoading } = useAuth();
  const [savedListings, setSavedListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingKeys, setSavingKeys] = useState({});
  const [notice, setNotice] = useState(null);
  const noticeTimerRef = useRef(null);

  const showNotice = useCallback((message, type = 'success') => {
    setNotice({ message, type });
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const refreshSavedListings = useCallback(async () => {
    if (!user) {
      setSavedListings([]);
      return [];
    }

    setLoading(true);
    try {
      const response = await apiClient.request('/api/user/saved-listings');
      const items = Array.isArray(response?.items)
        ? response.items.map(buildListingSaveData)
        : [];
      setSavedListings(items);
      return items;
    } catch (error) {
      console.error('Failed to load saved listings:', error);
      const details = error?.details?.error || error?.details?.message || error?.message;
      showNotice(
        details
          ? `We could not load your favourites right now: ${details}`
          : 'We could not load your favourites right now. Please try again or contact support.',
        'error'
      );
      setSavedListings([]);
      return [];
    } finally {
      setLoading(false);
    }
  // Depend on user?.id only so a token refresh (same user, new access_token)
  // doesn't create a new callback reference and re-trigger the fetch effect.
  }, [showNotice, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Wait until auth has finished initializing so we always have a valid
    // Supabase token before making the first request.
    if (authLoading) return;
    if (!user?.id) { setSavedListings([]); return; }
    refreshSavedListings();
  }, [refreshSavedListings, user?.id, authLoading]);

  const savedLookup = useMemo(() => {
    return new Set(
      savedListings
        .map((item) => normalizeSavedType(item?.listingType || item?.listing_type || item?.categoryKey, item?.id))
        .filter(Boolean)
    );
  }, [savedListings]);

  const savedCounts = useMemo(() => {
    return savedListings.reduce(
      (acc, item) => {
        const listingType = String(item?.listingType || item?.listing_type || '').toLowerCase();
        if (listingType === 'car') acc.cars += 1;
        else if (listingType === 'bike') acc.bikes += 1;
        else if (listingType === 'part') acc.parts += 1;
        else if (listingType === 'plate') acc.plates += 1;
        acc.total += 1;
        return acc;
      },
      { total: 0, cars: 0, bikes: 0, parts: 0, plates: 0 }
    );
  }, [savedListings]);

  const isSaved = useCallback(
    (listingType, listingId) => savedLookup.has(normalizeSavedType(listingType, listingId)),
    [savedLookup]
  );

  const isSaving = useCallback(
    (listingType, listingId) => Boolean(savingKeys[normalizeSavedType(listingType, listingId)]),
    [savingKeys]
  );

  const toggleSavedListing = useCallback(
    async ({ listingType, listingId, listingData }) => {
      const key = normalizeSavedType(listingType, listingId);
      const normalizedType = key ? key.split(':')[0] : null;

      if (!key || !normalizedType) {
        return { saved: false, error: new Error('Invalid listing reference') };
      }

      if (!user) {
        showNotice('Sign in to save listings to your favourites.', 'error');
        return { saved: false, requiresAuth: true, redirectTo: buildLoginRedirect() };
      }

      const currentlySaved = savedLookup.has(key);
      const previousListings = savedListings;
      const optimisticItem = {
        ...buildListingSaveData(listingData),
        id: listingId,
        listingType: normalizedType,
        isSaved: true,
      };

      setSavingKeys((current) => ({ ...current, [key]: true }));

      if (currentlySaved) {
        setSavedListings((current) => current.filter((item) => normalizeSavedType(item?.listingType || item?.listing_type || item?.categoryKey, item?.id) !== key));
        try {
          await apiClient.request(`/api/user/saved-listings/${normalizedType}/${listingId}`, {
            method: 'DELETE',
          });
          showNotice('Removed from favourites.');
          return { saved: false };
        } catch (error) {
          console.error('Failed to remove saved listing:', error);
          setSavedListings(previousListings);
          showNotice('We could not update that favourite. Please try again or contact support.', 'error');
          return { saved: true, error };
        } finally {
          setSavingKeys((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
        }
      }

      setSavedListings((current) => [optimisticItem, ...current.filter((item) => normalizeSavedType(item?.listingType || item?.listing_type || item?.categoryKey, item?.id) !== key)]);

      try {
        const response = await apiClient.request('/api/user/saved-listings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {
            listing_type: normalizedType,
            listing_id: listingId,
          },
        });

        const nextItem = buildListingSaveData(response?.listing || optimisticItem);
        setSavedListings((current) => [nextItem, ...current.filter((item) => normalizeSavedType(item?.listingType || item?.listing_type || item?.categoryKey, item?.id) !== key)]);
        showNotice('Added to favourites.');
        return { saved: true, listing: nextItem };
      } catch (error) {
        console.error('Failed to save listing:', error);
        setSavedListings(previousListings);
        showNotice('We could not save that listing. Please try again or contact support.', 'error');
        return { saved: false, error };
      } finally {
        setSavingKeys((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    },
    [savedListings, savedLookup, showNotice, !!user] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const value = useMemo(
    () => ({
      savedListings,
      savedCounts,
      loading,
      notice,
      clearNotice: () => setNotice(null),
      refreshSavedListings,
      isSaved,
      isSaving,
      toggleSavedListing,
    }),
    [isSaved, isSaving, loading, notice, refreshSavedListings, savedCounts, savedListings, toggleSavedListing]
  );

  return (
    <SavedListingsContext.Provider value={value}>
      {children}
    </SavedListingsContext.Provider>
  );
};

export const useSavedListings = () => useContext(SavedListingsContext);
