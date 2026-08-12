import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Hard gate: a logged-in user whose phone isn't verified cannot reach ANY route
// except the ones below until they verify. This replaces the old one-shot
// redirect-on-login (which the user could simply navigate away from), so
// verification can't be skipped by clicking a link, hitting back, or typing a URL.
// ponytail: allowlist is prefix-matched; keep it minimal — verify screen, the
// OAuth callback (it runs then routes to /verify-phone itself), and logout.
const ALLOWED_PREFIXES = ['/verify-phone', '/auth/callback', '/logout'];

const PhoneGate = ({ children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading || !user || user.phone_verified) return children;
  if (ALLOWED_PREFIXES.some((prefix) => location.pathname.startsWith(prefix))) {
    return children;
  }

  return (
    <Navigate
      to="/verify-phone"
      replace
      state={{
        phone: user.phone || '',
        countryCode: user.country_code || '+971',
        purpose: 'profile_verify',
        redirect: '/',
        nextRoute: '/',
      }}
    />
  );
};

export default PhoneGate;
