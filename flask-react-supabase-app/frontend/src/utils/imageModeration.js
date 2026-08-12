let nsfwModel = null;
let faceModel = null;
let loadPromise = null;

// Block thresholds — tune here. nsfw* are nsfwjs class probabilities,
// FACE is the blazeface per-detection probability.
// Raised to cut false positives on legit car photos (nsfwjs "Sexy" fires on car
// curves/skin-tone paint; blazeface on grilles/reflections). The SERVER
// auto-review (NudeNet exposed-parts @0.5 + Haar face) is the authoritative gate
// and correctly clears these; the client only needs to catch egregious cases.
export const THRESHOLDS = {
  Porn: 0.85,
  Hentai: 0.85,
  Sexy: 0.95,
  FACE: 0.85,
};

// Exported for test resets only — not for production use
export function _resetModels() {
  nsfwModel = null;
  faceModel = null;
  loadPromise = null;
}

async function loadModels() {
  if (!loadPromise) {
    // Dynamic imports avoid the TensorFlow.js circular-dependency TDZ crash
    // that occurs when nsfwjs / blazeface are imported at module top level.
    loadPromise = Promise.all([
      import('@tensorflow/tfjs'),
      import('@tensorflow/tfjs-backend-webgl'),
      import('nsfwjs'),
      import('@tensorflow-models/blazeface'),
    ]).then(([, , nsfwjs, blazeface]) =>
      Promise.all([nsfwjs.load(), blazeface.load()])
    ).then(([nsfw, face]) => {
      nsfwModel = nsfw;
      faceModel = face;
    });
    // Don't cache a rejected load — otherwise one transient CDN/model failure
    // leaves moderation silently disabled for the whole session. Reset so the
    // next moderateImage() retries the load.
    loadPromise.catch(() => { loadPromise = null; });
  }
  await loadPromise;
}

function fileToImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{ blocked: boolean, reasons: string[] }>}
 *   reasons: subset of ['nudity', 'face']
 */
export async function moderateImage(file) {
  await loadModels();
  const img = await fileToImageElement(file);

  const [predictions, faces] = await Promise.all([
    nsfwModel.classify(img),
    faceModel.estimateFaces(img, false),
  ]);

  const reasons = [];

  const prob = Object.fromEntries(predictions.map(p => [p.className, p.probability]));
  if ((prob.Porn || 0) > THRESHOLDS.Porn) reasons.push('nudity');
  if ((prob.Hentai || 0) > THRESHOLDS.Hentai) reasons.push('nudity');
  if ((prob.Sexy || 0) > THRESHOLDS.Sexy) reasons.push('nudity');

  const faceDetected = faces.some(f => {
    const p = Array.isArray(f.probability) ? f.probability[0] : (f.probability ?? 1);
    return p > THRESHOLDS.FACE;
  });
  if (faceDetected) reasons.push('face');

  if (reasons.length) {
    // Log the actual scores so a false positive is diagnosable next time.
    console.warn('imageModeration blocked', {
      reasons: [...new Set(reasons)],
      scores: prob,
      faces: faces.length,
    });
  }
  return { blocked: reasons.length > 0, reasons: [...new Set(reasons)] };
}
