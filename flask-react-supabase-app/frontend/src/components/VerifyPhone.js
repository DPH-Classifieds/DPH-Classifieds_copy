import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getCurrentUser } from '../utils/authService';
import PhoneVerificationFlow from './PhoneVerificationFlow';

const VerifyPhone = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { updateUser } = useAuth();

  const state = location.state || {};
  const params = new URLSearchParams(location.search);

  const verificationId = state.verificationId || params.get('verification_id') || '';
  const phone = state.phone || params.get('phone') || '';
  const purpose = state.purpose || params.get('purpose') || 'signup';
  const countryCode = state.countryCode || params.get('country_code') || '+971';
  const email = state.email || params.get('email') || '';
  const redirect = state.redirect || params.get('redirect') || '/profile';
  const nextRoute = state.nextRoute || params.get('next') || '';

  const handleVerified = async () => {
    // Refresh user data so phone_verified is up-to-date before navigating
    try {
      const { user: refreshedUser } = await getCurrentUser(true);
      if (refreshedUser && refreshedUser.id) {
        updateUser(refreshedUser);
      }
    } catch (err) {
      console.error('Failed to refresh user after phone verification:', err);
    }

    if (purpose === 'signup') {
      navigate('/check-email', {
        replace: true,
        state: {
          email,
          redirect,
        },
      });
      return;
    }

    if (nextRoute) {
      navigate(nextRoute, { replace: true });
      return;
    }

    navigate(redirect, { replace: true });
  };

  return (
    <PhoneVerificationFlow
      mode="page"
      open
      title={purpose === 'signup' ? 'Verify your phone to continue signup' : 'Verify your phone number'}
      description={purpose === 'signup'
        ? 'Enter the SMS code we sent so we can finish setting up your account. UAE numbers only (+971).'
        : 'Enter the SMS code to confirm this phone number. UAE numbers only (+971).'}
      phone={phone}
      countryCode={countryCode}
      purpose={purpose}
      verificationId={verificationId || null}
      autoStart={false}
      onVerified={handleVerified}
      continueLabel={purpose === 'signup' ? 'Continue to email confirmation' : 'Finish verification'}
    />
  );
};

export default VerifyPhone;
