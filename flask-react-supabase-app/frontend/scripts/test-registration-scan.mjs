import assert from 'node:assert/strict';
import { normalizeRegistrationScanResponse } from '../src/utils/registrationScan.js';

const payload = normalizeRegistrationScanResponse({
  fields: { make: 'Toyota', model: 'Camry', year: '2021', vin: 'JTNB11HK0M1234567' },
  confidence: { overall: 0.98 },
  vin_validation: { valid: true },
  needs_review: false,
});

assert.equal(payload.shouldAutoFill, true);
assert.equal(payload.fields.make, 'Toyota');
assert.equal(payload.fields.vin, 'JTNB11HK0M1234567');
