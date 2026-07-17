// A field PaddleOCR read at/above this recognition confidence is shown as
// "verified" in the suggestion panel (still editable).
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
  // Autofill whatever the scan extracted. A UAE/GCC VIN can't be
  // checksum-validated (that math is North-America-only), so gating autofill
  // on validation left real mulkiyas mostly manual. Instead we fill every
  // field that was read (kept editable), and `needsReview` just drives a
  // "please double-check" note — it no longer blocks filling.
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
    // "verified" tags now reflect how cleanly PaddleOCR read each field
    // (high confidence), or a genuinely checksum-valid VIN — honest per-field
    // signal for the suggestion panel. Everything still autofills regardless.
    verifiedMake: Boolean(fields.make) && confidence.make >= HIGH_CONFIDENCE,
    verifiedModel: Boolean(fields.model) && confidence.model >= HIGH_CONFIDENCE,
    verifiedYear: Boolean(fields.year) && confidence.year >= HIGH_CONFIDENCE,
    verifiedVin: Boolean(fields.vin) && (vinValidation.valid || confidence.vin >= HIGH_CONFIDENCE),
    // Only a checksum-valid VIN locks as the source of truth; a GCC/UAE VIN
    // (never checksum-validatable) fills but stays editable.
    vinLocked: Boolean(fields.vin) && vinValidation.valid,
  };
};
