import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from './LoadingSpinner';

const PhoneVerifiedRoute = () => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LoadingSpinner message="Loading..." size="large" />;
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (!user.phone_verified) {
    return (
      <Navigate
        to="/verify-phone"
        replace
        state={{
          phone: user.phone || '',
          countryCode: user.country_code || '+971',
          purpose: 'profile_verify',
          redirect: '/profile',
          nextRoute: `${location.pathname}${location.search}`,
        }}
      />
    );
  }

  return <Outlet />;
};

export default PhoneVerifiedRoute;
