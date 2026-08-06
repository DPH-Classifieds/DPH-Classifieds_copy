// MSG91 OTP for mobile (React Native SDK side of the two-sided widget flow).
//
// The native SDK (@msg91comm/sendotp-react-native) sends & verifies the OTP and
// returns a JWT, which we hand to the backend's /api/phone-verifications/verify-token
// (same endpoint the web widget uses). Requires a dev build — the native module does
// NOT run in Expo Go.
//
// Gated by env: if EXPO_PUBLIC_MSG91_WIDGET_ID/_TOKEN_AUTH are unset (or the native
// module isn't present), shouldUseMsg91() is false and callers fall back to the
// existing backend SMS flow. Lazy-require keeps the app alive if the module is absent.

const WIDGET_ID = process.env.EXPO_PUBLIC_MSG91_WIDGET_ID;
const TOKEN_AUTH = process.env.EXPO_PUBLIC_MSG91_TOKEN_AUTH;
// Matched against the MSG91 identifier (97158...), so normalize local prefixes:
// "058"/"0" -> "97158"/"971". Default "971" = all UAE.
const normalizePrefix = (raw) => {
  const d = String(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('971')) return d;
  return `971${d.replace(/^0+/, '')}`;
};
const PREFIXES = (process.env.EXPO_PUBLIC_MSG91_PREFIXES || '971')
  .split(',')
  .map(normalizePrefix)
  .filter(Boolean);

export const MSG91_OTP_LENGTH = 4;

let _sdk = null;
let _sdkTried = false;
const getSdk = () => {
  if (_sdkTried) return _sdk;
  _sdkTried = true;
  try {
    // eslint-disable-next-line global-require
    _sdk = require('@msg91comm/sendotp-react-native').OTPWidget;
  } catch (e) {
    _sdk = null; // module not installed / not built into this binary
  }
  return _sdk;
};

// UAE identifier for MSG91: country code + number, digits only, no '+'.
export const toMsg91Identifier = (phone, countryCode = '+971') => {
  let digits = String(phone || '').replace(/\D/g, '');
  const cc = String(countryCode || '').replace(/\D/g, '') || '971';
  if (digits.startsWith(cc)) return digits;
  digits = digits.replace(/^0+/, '');
  return `${cc}${digits}`;
};

export const isMsg91Enabled = () => Boolean(WIDGET_ID && TOKEN_AUTH && getSdk());

export const shouldUseMsg91 = (phone, countryCode = '+971') => {
  if (!isMsg91Enabled()) return false;
  const identifier = toMsg91Identifier(phone, countryCode);
  return PREFIXES.some((prefix) => identifier.startsWith(prefix));
};

let _inited = false;
const ensureInit = () => {
  const sdk = getSdk();
  if (!sdk) throw new Error('MSG91 SDK unavailable');
  if (!_inited) {
    sdk.initializeWidget(WIDGET_ID, TOKEN_AUTH);
    _inited = true;
  }
  return sdk;
};

// Send an OTP; resolves with the reqId used for verify/retry.
export const msg91SendOtp = async (identifier) => {
  const sdk = ensureInit();
  const res = await sdk.sendOTP({ identifier });
  const reqId = res?.message || res?.reqId;
  if (res?.type === 'error' || !reqId) {
    throw new Error(res?.message || 'Failed to send code');
  }
  return reqId;
};

export const msg91RetryOtp = async (reqId) => {
  const sdk = ensureInit();
  return sdk.retryOTP({ reqId });
};

// Verify the entered OTP; resolves with the access-token JWT for the backend.
export const msg91VerifyOtp = async (reqId, otp) => {
  const sdk = ensureInit();
  const res = await sdk.verifyOTP({ reqId, otp });
  const token = res?.message || res?.['access-token'];
  if (res?.type === 'error' || !token) {
    throw new Error(res?.message || 'Invalid code');
  }
  return token;
};
