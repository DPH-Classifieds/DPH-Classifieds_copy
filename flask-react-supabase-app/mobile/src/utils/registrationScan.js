const AUTO_FILL_THRESHOLD = 0.9;

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
  const shouldAutoFill =
    !needsReview
    && vinValidation.valid
    && confidence.overall >= AUTO_FILL_THRESHOLD;

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
