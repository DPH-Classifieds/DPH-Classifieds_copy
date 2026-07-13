import { isVinValid, normalizeVin } from './vinValidation';

test('normalizes separators without changing a valid non-North-American VIN', () => {
  expect(normalizeVin('SALYJ-2EX4NA-123456')).toBe('SALYJ2EX4NA123456');
  expect(isVinValid('SALYJ-2EX4NA-123456')).toBe(true);
});
