// Country codes for phone number input
export const countryCodes = [
  { code: '+971', country: 'United Arab Emirates', flag: '🇦🇪' },
  { code: '+1', country: 'United States/Canada', flag: '🇺🇸' },
  { code: '+44', country: 'United Kingdom', flag: '🇬🇧' },
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+92', country: 'Pakistan', flag: '🇵🇰' },
  { code: '+880', country: 'Bangladesh', flag: '🇧🇩' },
  { code: '+20', country: 'Egypt', flag: '🇪🇬' },
  { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦' },
  { code: '+965', country: 'Kuwait', flag: '🇰🇼' },
  { code: '+968', country: 'Oman', flag: '🇴🇲' },
  { code: '+974', country: 'Qatar', flag: '🇶🇦' },
  { code: '+973', country: 'Bahrain', flag: '🇧🇭' },
  { code: '+961', country: 'Lebanon', flag: '🇱🇧' },
  { code: '+962', country: 'Jordan', flag: '🇯🇴' },
  { code: '+964', country: 'Iraq', flag: '🇮🇶' },
  { code: '+98', country: 'Iran', flag: '🇮🇷' },
  { code: '+90', country: 'Turkey', flag: '🇹🇷' },
  { code: '+93', country: 'Afghanistan', flag: '🇦🇫' },
  { code: '+86', country: 'China', flag: '🇨🇳' },
  { code: '+81', country: 'Japan', flag: '🇯🇵' },
  { code: '+82', country: 'South Korea', flag: '🇰🇷' },
  { code: '+63', country: 'Philippines', flag: '🇵🇭' },
  { code: '+84', country: 'Vietnam', flag: '🇻🇳' },
  { code: '+66', country: 'Thailand', flag: '🇹🇭' },
  { code: '+60', country: 'Malaysia', flag: '🇲🇾' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬' },
  { code: '+62', country: 'Indonesia', flag: '🇮🇩' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+64', country: 'New Zealand', flag: '🇳🇿' },
  { code: '+27', country: 'South Africa', flag: '🇿🇦' },
  { code: '+234', country: 'Nigeria', flag: '🇳🇬' },
  { code: '+254', country: 'Kenya', flag: '🇰🇪' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+39', country: 'Italy', flag: '🇮🇹' },
  { code: '+34', country: 'Spain', flag: '🇪🇸' },
  { code: '+31', country: 'Netherlands', flag: '🇳🇱' },
  { code: '+32', country: 'Belgium', flag: '🇧🇪' },
  { code: '+41', country: 'Switzerland', flag: '🇨🇭' },
  { code: '+43', country: 'Austria', flag: '🇦🇹' },
  { code: '+45', country: 'Denmark', flag: '🇩🇰' },
  { code: '+46', country: 'Sweden', flag: '🇸🇪' },
  { code: '+47', country: 'Norway', flag: '🇳🇴' },
  { code: '+358', country: 'Finland', flag: '🇫🇮' },
  { code: '+48', country: 'Poland', flag: '🇵🇱' },
  { code: '+30', country: 'Greece', flag: '🇬🇷' },
  { code: '+351', country: 'Portugal', flag: '🇵🇹' },
  { code: '+7', country: 'Russia', flag: '🇷🇺' },
  { code: '+380', country: 'Ukraine', flag: '🇺🇦' },
  { code: '+55', country: 'Brazil', flag: '🇧🇷' },
  { code: '+52', country: 'Mexico', flag: '🇲🇽' },
  { code: '+54', country: 'Argentina', flag: '🇦🇷' },
  { code: '+56', country: 'Chile', flag: '🇨🇱' },
  { code: '+57', country: 'Colombia', flag: '🇨🇴' },
  { code: '+51', country: 'Peru', flag: '🇵🇪' },
];

// Default country code (UAE)
export const defaultCountryCode = '+971';

const stripPhoneDigits = (value) => String(value || '').replace(/[^\d]/g, '');

const normalizeCountryCode = (countryCode = defaultCountryCode) => {
  const resolvedCountryCode = String(countryCode || '').trim();
  const digits = stripPhoneDigits(resolvedCountryCode) || stripPhoneDigits(defaultCountryCode);
  return digits ? `+${digits}` : defaultCountryCode;
};

export const splitPhoneNumberForInput = (phoneNumber, countryCode = defaultCountryCode) => {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const rawPhone = String(phoneNumber || '').trim();

  if (!rawPhone) {
    return {
      countryCode: normalizedCountryCode,
      phoneNumber: '',
    };
  }

  const digits = stripPhoneDigits(rawPhone);
  if (!digits) {
    return {
      countryCode: normalizedCountryCode,
      phoneNumber: '',
    };
  }

  const countryDigits = stripPhoneDigits(normalizedCountryCode);
  const localNumber = digits.startsWith(countryDigits) && digits.length > countryDigits.length
    ? digits.slice(countryDigits.length)
    : digits;

  return {
    countryCode: normalizedCountryCode,
    phoneNumber: localNumber.replace(/^0+/, ''),
  };
};

const normalizePhoneForDisplay = (phoneNumber, countryCode = defaultCountryCode) => {
  if (!phoneNumber) return 'N/A';

  const { countryCode: resolvedCountryCode, phoneNumber: localNumber } = splitPhoneNumberForInput(
    phoneNumber,
    countryCode,
  );

  if (!localNumber) return 'N/A';
  return `${resolvedCountryCode} ${localNumber}`;
};

// Helper function to format phone number for display
export const formatPhoneNumber = (countryCode, phoneNumber) => {
  return normalizePhoneForDisplay(phoneNumber, countryCode);
};

export const formatVerificationPhone = (phoneNumber, countryCode) => {
  return normalizePhoneForDisplay(phoneNumber, countryCode);
};

// Helper function to get country info by code
export const getCountryByCode = (code) => {
  return countryCodes.find(c => c.code === code) || countryCodes[0];
};
