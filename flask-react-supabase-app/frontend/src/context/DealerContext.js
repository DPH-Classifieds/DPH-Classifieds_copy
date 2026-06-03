import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';

const DealerContext = createContext(null);

export const DealerProvider = ({ children }) => {
  const [searchParams] = useSearchParams();
  const [dealership, setDealership] = useState(null);
  const [role, setRole] = useState(null);
  const [actorKind, setActorKind] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const actingAs = searchParams.get('as') || null;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (actingAs) {
        window.__ACTING_AS_DEALERSHIP__ = actingAs;
      } else {
        delete window.__ACTING_AS_DEALERSHIP__;
      }
    }
  }, [actingAs]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.get('/api/dealer/me');
      setDealership(resp.dealership || null);
      setRole(resp.role || null);
      setActorKind(resp.actor_kind || null);
    } catch (e) {
      setError(e.message || 'Failed to load dealer context');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh, actingAs]);

  return (
    <DealerContext.Provider value={{ dealership, role, actorKind, loading, error, actingAs, refresh }}>
      {children}
    </DealerContext.Provider>
  );
};

export const useDealer = () => {
  const ctx = useContext(DealerContext);
  if (!ctx) throw new Error('useDealer must be used inside <DealerProvider>');
  return ctx;
};
