// A field PaddleOCR read at/above this recognition confidence is shown as
// "verified" (still editable).
const HIGH_CONFIDENCE = 0.85;

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeString = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

export const normalizeRegistrationScanResponse = (payload) => {
  const fields = {
    make: normalizeString(payload?.fields?.make || payload?.make),
    model: normalizeString(payload?.fields?.model || payload?.model),
    year: normalizeString(payload?.fields?.year || payload?.year),
    vin: normalizeString(payload?.fields?.vin || payload?.vin).toUpperCase(),
    plate_number: normalizeString(payload?.fields?.plate_number),
    plate_code: normalizeString(payload?.fields?.plate_code),
  };

  const confidence = {
    make: normalizeNumber(payload?.confidence?.make),
    model: normalizeNumber(payload?.confidence?.model),
    year: normalizeNumber(payload?.confidence?.year),
    vin: normalizeNumber(payload?.confidence?.vin),
    overall: normalizeNumber(payload?.confidence?.overall),
  };

  const vinValidation = {
    ...payload?.vin_validation,
    valid: Boolean(payload?.vin_validation?.valid ?? payload?.vin_validation?.is_valid),
    decoded: {
      ...(payload?.vin_validation?.decoded || {}),
      model_year:
        payload?.vin_validation?.decoded?.model_year
        || payload?.vin_validation?.decoded?.year
        || '',
    },
  };

  const needsReview = Boolean(payload?.needs_review);
  // Autofill whatever was read (kept editable). GCC/UAE VINs can't be
  // checksum-validated, so we don't gate autofill on validation — needsReview
  // just drives a "please double-check" note.
  const shouldAutoFill = Boolean(
    fields.vin || fields.make || fields.model || fields.year || fields.plate_number
  );

  return {
    fields,
    confidence,
    vinValidation,
    needsReview,
    shouldAutoFill,
    rawText: normalizeString(payload?.raw_text),
    documentType: normalizeString(payload?.document_type) || 'registration',
    reviewReasons: Array.isArray(payload?.review_reasons) ? payload.review_reasons : [],
    make: fields.make,
    model: fields.model,
    year: fields.year,
    vin: fields.vin,
    verifiedMake: Boolean(fields.make) && confidence.make >= HIGH_CONFIDENCE,
    verifiedModel: Boolean(fields.model) && confidence.model >= HIGH_CONFIDENCE,
    verifiedYear: Boolean(fields.year) && confidence.year >= HIGH_CONFIDENCE,
    verifiedVin: Boolean(fields.vin) && (vinValidation.valid || confidence.vin >= HIGH_CONFIDENCE),
    vinLocked: Boolean(fields.vin) && vinValidation.valid,
  };
};
