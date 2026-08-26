// Client-side extraction of business fields from uploaded dealer documents.
// Designed for the signup prefill flow:
//
//   - PDFs: try the text layer via pdfjs-dist (cheap, instant for digital PDFs).
//   - Images: fall back to tesseract.js (lazy-loaded; large worker bundle so we
//     only import it when actually needed).
//
// Server-side PaddleOCR remains the authoritative verifier on submit; this is
// purely a convenience that lets the dealer see the form pre-populated with
// their real data instead of having to re-type it.

const FIELD_PATTERNS = {
  // 15 consecutive digits, possibly broken by spaces or dashes (UAE TRN).
  trn: /\b(?:\d[ -]?){14}\d\b/g,
  // Trade-license numbers are 4-8 digits, but never 15 (otherwise it would
  // collide with the TRN) and not a year prefix (don't catch 2024 as a license
  // number when the filename has it).
  tradeLicenseNumber: /\b\d{4,8}\b/g,
  // "Legal Name" / "Legal Business Name" / "Trade Name" / "Trading Name" / "اسم"
  // / "Legal Entity" — capture whatever follows the colon or label.
  legalBusinessName:
    /(?:legal\s+business\s+name|legal\s+entity\s+name|legal\s+name|legal\s+entity\b|اسم\s+الكيان\s+القانوني|الاسم\s+القانوني)[:\s\-–]+([^\n\r|]{2,120})/iu,
  tradingName:
    /(?:trade\s+name|trading\s+name|commercial\s+name|اسم\s+تجاري)[:\s\-–]+([^\n\r|]{2,120})/iu,
};

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractDigits(rawValue) {
  return String(rawValue || '').replace(/[^0-9]/g, '');
}

function pickLongestNonTrn(numbers, trn) {
  const trnDigits = extractDigits(trn || '');
  let best = '';
  for (const candidate of numbers) {
    if (candidate.length === 15) continue;
    if (/^(?:19|20)\d{2}$/.test(candidate)) continue;
    if (trnDigits && trnDigits.includes(candidate)) continue;
    if (candidate.length > best.length) best = candidate;
  }
  return best;
}

function findFieldMatches(text, field) {
  const pattern = FIELD_PATTERNS[field];
  if (field === 'trn') {
    const matches = String(text || '').match(pattern) || [];
    const candidates = matches.map(extractDigits).filter((digits) => digits.length === 15);
    return candidates.length ? [candidates[0]] : [];
  }
if (field === 'tradeLicenseNumber') {
    const matches = String(text || '').match(pattern) || [];
    const candidates = matches.map((m) => m.replace(/\D/g, '')).filter((digits) => digits.length >= 4 && digits.length <= 8);
    const trnCandidates = String(text || '').match(FIELD_PATTERNS.trn) || [];
    const trn = trnCandidates.length ? extractDigits(trnCandidates[0]) : '';
    const best = pickLongestNonTrn(candidates, trn);
    return best ? [best] : [];
  }
  const matches = String(text || '').match(pattern);
  if (!matches) return [];
  return [normalizeWhitespace(matches[1])].filter((m) => m && m.length >= 2);
}

export function extractFieldsFromText(text) {
  const out = {};
  if (!text) return out;
  const trnMatches = findFieldMatches(text, 'trn');
  if (trnMatches.length) out.trn = trnMatches[0];
  const licenseMatches = findFieldMatches(text, 'tradeLicenseNumber');
  if (licenseMatches.length) out.tradeLicenseNumber = licenseMatches[0];
  const legalMatches = findFieldMatches(text, 'legalBusinessName');
  if (legalMatches.length) out.legalBusinessName = legalMatches[0];
  const tradingMatches = findFieldMatches(text, 'tradingName');
  if (tradingMatches.length) out.companyName = tradingMatches[0];
  return out;
}

// --- PDF text layer extraction via pdfjs-dist -----------------------------

let pdfjsModule = null;
async function loadPdfjs() {
  if (pdfjsModule) return pdfjsModule;
  pdfjsModule = await import('pdfjs-dist/build/pdf.mjs');
  // pdfjs-dist requires its worker to be configured; without this the page
  // extraction throws "no GlobalWorkerOptions.workerSrc set". Vite/CRA serve
  // node_modules/* in dev, but Vercel/prod bundlers don't — using the CDN
  // unpkg URL keeps the worker out of our bundle and works in both modes.
  if (!pdfjsModule.GlobalWorkerOptions.workerSrc) {
    pdfjsModule.GlobalWorkerOptions.workerSrc =
      'https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  }
  return pdfjsModule;
}

async function extractPdfText(file) {
  try {
    const pdfjs = await loadPdfjs();
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pageTexts.push(pageText);
    }
    return pageTexts.join('\n');
  } catch (error) {
    console.warn('pdfjs text-layer extraction failed', error);
    return '';
  }
}

// --- Image OCR via tesseract.js (lazy-loaded) ------------------------------

let tesseractModule = null;
async function loadTesseract() {
  if (tesseractModule) return tesseractModule;
  tesseractModule = await import('tesseract.js');
  return tesseractModule;
}

async function extractImageText(file) {
  try {
    const tesseract = await loadTesseract();
    const { data } = await tesseract.recognize(file, 'eng');
    return data && data.text ? data.text : '';
  } catch (error) {
    console.warn('tesseract image OCR failed', error);
    return '';
  }
}

export async function extractFieldsFromFile(file) {
  if (!file) return {};
  const mimeType = String(file.type || '').toLowerCase();
  let text = '';
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    text = await extractPdfText(file);
  } else if (mimeType.startsWith('image/')) {
    text = await extractImageText(file);
  }
  return extractFieldsFromText(text);
}