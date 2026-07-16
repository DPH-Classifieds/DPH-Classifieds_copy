import { isVinValid, isVinChecksumApplicable, normalizeVin } from './vinValidation';

test('normalizes separators without changing a valid non-North-American VIN', () => {
  expect(normalizeVin('SALYJ-2EX4NA-123456')).toBe('SALYJ2EX4NA123456');
  expect(isVinValid('SALYJ-2EX4NA-123456')).toBe(true);
});

test('checksum is applicable only for North-American (1-5) VINs', () => {
  expect(isVinChecksumApplicable('1HGCM82633A004352')).toBe(true);
  // GCC/JDM/EU market VIN — checksum can't verify it
  expect(isVinChecksumApplicable('LGWFF7A51SJ614961')).toBe(false);
  expect(isVinChecksumApplicable('SALYJ2EX4NA123456')).toBe(false);
});

test('a non-NA garbage VIN must not be treated as checksum-verified', () => {
  // Regression: OCR fabricated "BASALAUGPALLCULYL" (17 valid chars, starts
  // with B) was shown as verified/Valid because the checksum was skipped for
  // non-NA VINs. isVinValid stays optimistic (structural) for manual entry,
  // but the checksum is NOT applicable, so "verified" claims must gate on
  // isVinChecksumApplicable.
  expect(isVinChecksumApplicable('BASALAUGPALLCULYL')).toBe(false);
});
