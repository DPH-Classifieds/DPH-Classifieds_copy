import React from 'react';
import { formatConfidence } from './DealerVerificationPage';

test('dealer verification formats OCR confidence and thresholds for display', () => {
  expect(formatConfidence(0.8645)).toBe('86.5%');
  expect(formatConfidence(0.9)).toBe('90.0%');
  expect(formatConfidence(null)).toBe('0.0%');
});
