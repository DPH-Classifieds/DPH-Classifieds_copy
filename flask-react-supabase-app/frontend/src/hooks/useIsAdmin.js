import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';

// Shared with ProfileMenu.js (desktop) — used by Header.js's mobile menu too
// so the Admin Panel link shows in both places instead of just the desktop
// dropdown.
export default function useIsAdmin(user) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let active = true;
    apiClient
      .get('/api/auth/admin-check')
      .then((response) => {
        if (active) {
          setIsAdmin(Boolean(response && (response.is_admin === true || response.is_super_admin === true)));
        }
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => { active = false; };
  }, [user]);

  return isAdmin;
}
