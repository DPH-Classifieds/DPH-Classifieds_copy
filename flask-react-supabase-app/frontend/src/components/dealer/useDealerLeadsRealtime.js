// flask-react-supabase-app/frontend/src/components/dealer/useDealerLeadsRealtime.js
import { useEffect } from 'react';
import { supabase } from '../../utils/supabaseClient';

/**
 * Subscribes to dealer_leads INSERTs filtered by dealership_id and invokes
 * the provided callback. Caller decides what to do (refetch list, show toast,
 * increment unread counter, etc.).
 *
 * Returns nothing; cleans up on unmount.
 */
export default function useDealerLeadsRealtime(dealershipId, onInsert) {
  useEffect(() => {
    if (!dealershipId || typeof onInsert !== 'function') return undefined;
    const channel = supabase
      .channel(`dealer-leads-${dealershipId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'dealer_leads',
          filter: `dealership_id=eq.${dealershipId}`,
        },
        (payload) => {
          try { onInsert(payload.new); } catch (_) { /* swallow */ }
        }
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch (_) { /* ignore */ }
    };
  }, [dealershipId, onInsert]);
}
