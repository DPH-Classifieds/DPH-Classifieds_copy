import React from 'react';
import { formatConfidence, guessDocumentType, statusChipForDoc } from './DealerVerificationPage';

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

test('dealer verification marks accepted documents green and removes re-upload guidance', () => {
  expect(statusChipForDoc({ status: 'approved', ocr_confidence: 0 })).toEqual({
    label: 'Accepted — no re-upload needed',
    kind: 'success',
  });
  expect(statusChipForDoc({ status: 'pending', ocr_status: 'passed' })).toEqual({
    label: 'Automatic check passed',
    kind: 'success',
  });
});

test('dealer verification does not call a provider outage a bad scan', () => {
  expect(statusChipForDoc({ status: 'pending', ocr_status: 'not_scanned' })).toEqual({
    label: 'Scan pending — no re-upload needed yet',
    kind: 'pending',
  });
});
