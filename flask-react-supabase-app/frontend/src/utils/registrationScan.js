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
  // Auto-fill when VIN was extracted and the backend reports no errors.
  // Overall confidence is low-by-design for VIN-only docs (mulkiya), so we
  // drop the threshold gate and the valid-checksum gate — an invalid-checksum
  // VIN is still useful (user can correct one char); the field won't be locked
  // unless verifiedVin is true (see PostCar registrationOcrTruth handling).
  const shouldAutoFill = !needsReview && Boolean(fields.vin);

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
    verifiedMake: shouldAutoFill && Boolean(fields.make),
    verifiedModel: shouldAutoFill && Boolean(fields.model),
    verifiedYear: shouldAutoFill && Boolean(fields.year),
    verifiedVin: vinValidation.valid && Boolean(fields.vin),
  };
};
