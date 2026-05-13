import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import apiClient from '../utils/apiClient';
import { useAuth } from './AuthContext';

const SavedListingsContext = createContext();

export const useSavedListings = () => useContext(SavedListingsContext);

export const SavedListingsProvider = ({ children }) => {
  const { user } = useAuth();
  const [savedListings, setSavedListings] = useState({ cars: [], bikes: [], plates: [], parts: [] });
  const [loading, setLoading] = useState(false);

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
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) loadSavedListings();
    else setSavedListings({ cars: [], bikes: [], plates: [], parts: [] });
  }, [user, loadSavedListings]);

  const toggleSaveListing = async (type, listing) => {
    if (!user) return false;
    const id = listing.id || listing.listing_id;
    const isCurrentlySaved = savedListings[type]?.some(l => (l.id || l.listing_id) === id);
    try {
      if (isCurrentlySaved) {
        await apiClient.delete(`/api/user/saved-listings/${type}/${id}`);
        setSavedListings(prev => ({
          ...prev,
          [type]: prev[type].filter(l => (l.id || l.listing_id) !== id),
        }));
      } else {
        await apiClient.post('/api/user/saved-listings', { listing_type: type, listing_id: id });
        setSavedListings(prev => ({
          ...prev,
          [type]: [...(prev[type] || []), listing],
        }));
      }
      return true;
    } catch (err) {
      return false;
    }
  };

  const isSaved = (type, id) => {
    return savedListings[type]?.some(l => (l.id || l.listing_id) === id) || false;
  };

  return (
    <SavedListingsContext.Provider value={{ savedListings, loading, loadSavedListings, toggleSaveListing, isSaved }}>
      {children}
    </SavedListingsContext.Provider>
  );
};

export default SavedListingsContext;
