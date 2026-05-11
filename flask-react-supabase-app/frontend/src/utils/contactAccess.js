export const buildLoginRedirect = (pathname) =>
  `/login?redirect=${encodeURIComponent(pathname || '/')}`;

export const buildPhoneVerificationState = (user, nextRoute) => ({
  phone: user?.phone || '',
  countryCode: user?.country_code || '+971',
  purpose: 'profile_verify',
  redirect: '/profile',
  nextRoute,
});

export const ensureContactAccess = ({ user, navigate, nextRoute }) => {
  if (!user?.id) {
    navigate(buildLoginRedirect(nextRoute), { replace: true });
    return false;
  }

  if (!user.phone_verified) {
    navigate('/verify-phone', {
      replace: true,
      state: buildPhoneVerificationState(user, nextRoute),
    });
    return false;
  }

  return true;
};
