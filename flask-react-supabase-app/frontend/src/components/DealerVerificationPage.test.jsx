import React from 'react';
import { formatConfidence, guessDocumentType } from './DealerVerificationPage';

test('dealer verification formats OCR confidence and thresholds for display', () => {
  expect(formatConfidence(0.8645)).toBe('86.5%');
  expect(formatConfidence(0.9)).toBe('90.0%');
  expect(formatConfidence(null)).toBe('0.0%');
});

test('dealer verification identifies both documents in a multi-file selection', () => {
  expect(guessDocumentType('trade-license-1575308.pdf')).toBe('trade_license');
  expect(guessDocumentType('TRN certificate.pdf')).toBe('tax_registration');
  expect(guessDocumentType('document-1.pdf', ['tax_registration'])).toBe('tax_registration');
});
