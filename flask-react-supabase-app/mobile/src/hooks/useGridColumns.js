import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// One shared listing-layout preference (1 = single card per row, 2 = grid) used
// by the Explore feed and every category list screen, so a toggle in one place
// carries across the app.
// ponytail: screens read the stored value on mount and persist their own
// toggles; they don't live-sync to each other while both mounted. Add a context
// if that ever matters.
const KEY = 'listing_columns_v1';

export function useGridColumns() {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(KEY).then((v) => {
      if (!cancelled && v === '2') setColumns(2);
    });
    return () => { cancelled = true; };
  }, []);

  const toggleColumns = useCallback(() => {
    setColumns((prev) => {
      const next = prev === 1 ? 2 : 1;
      AsyncStorage.setItem(KEY, String(next));
      return next;
    });
  }, []);

  return { columns, toggleColumns };
}
