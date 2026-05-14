import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import apiClient from '../utils/apiClient';
import { useAuth } from './AuthContext';

const SavedListingsContext = createContext();

export const useSavedListings = () => useContext(SavedListingsContext);

const normalizeType = (type) => {
  const map = { cars: 'car', bikes: 'bike', plates: 'plate', parts: 'part' };
  return map[type] || type;
};

const pluralizeType = (type) => {
  const map = { car: 'cars', bike: 'bikes', plate: 'plates', part: 'parts' };
  return map[type] || type;
};

export const SavedListingsProvider = ({ children }) => {
  const { user } = useAuth();
  const [savedListings, setSavedListings] = useState({ cars: [], bikes: [], plates: [], parts: [] });
  const [loading, setLoading] = useState(false);
  const [savingKeys, setSavingKeys] = useState(new Set());
  const previousListingsRef = useRef(null);

  const loadSavedListings = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await apiClient.get('/api/user/saved-listings');
      if (data && typeof data === 'object') {
        setSavedListings({
          cars: data.cars || [],
          bikes: data.bikes || [],
          plates: data.plates || [],
          parts: data.parts || [],
        });
      }
    } catch (err) {
      // silent
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) loadSavedListings();
    else setSavedListings({ cars: [], bikes: [], plates: [], parts: [] });
  }, [user, loadSavedListings]);

  const savedLookup = useMemo(() => {
    const lookup = {};
    Object.entries(savedListings).forEach(([pluralType, items]) => {
      const singularType = normalizeType(pluralType);
      items.forEach((item) => {
        const id = item.id || item.listing_id;
        if (id) lookup[`${singularType}:${id}`] = true;
      });
    });
    return lookup;
  }, [savedListings]);

  const savedCounts = useMemo(() => ({
    total: Object.values(savedListings).reduce((sum, arr) => sum + arr.length, 0),
    cars: savedListings.cars?.length || 0,
    bikes: savedListings.bikes?.length || 0,
    plates: savedListings.plates?.length || 0,
    parts: savedListings.parts?.length || 0,
  }), [savedListings]);

  const toggleSaveListing = useCallback(async (type, listing) => {
    if (!user) return false;
    const normalizedType = normalizeType(type);
    const pluralType = pluralizeType(normalizedType);
    const id = listing.id || listing.listing_id;
    const key = `${normalizedType}:${id}`;
    const isCurrentlySaved = !!savedLookup[key];

    previousListingsRef.current = { ...savedListings };
    setSavingKeys(prev => new Set([...prev, key]));

    if (isCurrentlySaved) {
      setSavedListings(prev => ({
        ...prev,
        [pluralType]: (prev[pluralType] || []).filter(l => (l.id || l.listing_id) !== id),
      }));
      try {
        await apiClient.delete(`/api/user/saved-listings/${pluralType}/${id}`);
        return true;
      } catch (err) {
        setSavedListings(previousListingsRef.current);
        return false;
      } finally {
        setSavingKeys(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    } else {
      setSavedListings(prev => ({
        ...prev,
        [pluralType]: [...(prev[pluralType] || []), listing],
      }));
      try {
        await apiClient.post('/api/user/saved-listings', {
          listing_type: normalizedType,
          listing_id: id,
        });
        return true;
      } catch (err) {
        setSavedListings(previousListingsRef.current);
        return false;
      } finally {
        setSavingKeys(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }
  }, [user, savedListings, savedLookup]);

  const isSaved = useCallback((type, id) => {
    const normalizedType = normalizeType(type);
    return !!savedLookup[`${normalizedType}:${id}`];
  }, [savedLookup]);

  const isSaving = useCallback((type, id) => {
    const normalizedType = normalizeType(type);
    return savingKeys.has(`${normalizedType}:${id}`);
  }, [savingKeys]);

  return (
    <SavedListingsContext.Provider value={{
      savedListings, loading, loadSavedListings,
      toggleSaveListing, isSaved, isSaving, savedCounts,
    }}>
      {children}
    </SavedListingsContext.Provider>
  );
};

export default SavedListingsContext;
