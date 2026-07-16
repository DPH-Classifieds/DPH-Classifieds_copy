const TRANSLITERATION = {
  A: 1, J: 1, S: 1,
  B: 2, K: 2, T: 2,
  C: 3, L: 3, U: 3,
  D: 4, M: 4, V: 4,
  E: 5, N: 5, W: 5,
  F: 6, O: 6, X: 6,
  G: 7, P: 7, Y: 7,
  H: 8, Q: 8, Z: 8,
  R: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(vin) {
  return String(vin || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ponytail: checksum is NHTSA/North-American only (WMI 1-5); skip for JDM/EU/GCC-market VINs
function isNorthAmericanVin(vin) {
  return '12345'.includes(vin[0]);
}

// Whether the mod-11 check digit can actually verify this VIN. It's an
// NHTSA/North-America requirement, not global — so isVinChecksumValid returns
// true (UNVERIFIABLE, not "confirmed correct") for non-NA VINs to avoid
// false-rejecting genuine GCC/JDM/EU VINs a user typed. Any code that wants to
// CLAIM a VIN is verified (e.g. auto-filling an OCR read as "Valid") must check
// this first — otherwise 17 garbage chars starting with a non-1-5 char sail
// through as "valid".
export function isVinChecksumApplicable(vin) {
  return Boolean(vin) && isNorthAmericanVin(vin);
}

export function isVinChecksumValid(vin) {
  if (!VIN_RE.test(vin)) return false;
  if (!isNorthAmericanVin(vin)) return true;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const val = ch >= '0' && ch <= '9' ? parseInt(ch, 10) : TRANSLITERATION[ch];
    sum += val * WEIGHTS[i];
  }
  const rem = sum % 11;
  const expected = rem === 10 ? 'X' : String(rem);
  return vin[8] === expected;
}

export function isVinValid(vin) {
  const v = normalizeVin(vin);
  return VIN_RE.test(v) && isVinChecksumValid(v);
}
