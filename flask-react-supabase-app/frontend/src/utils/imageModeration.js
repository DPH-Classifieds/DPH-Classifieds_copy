let nsfwModel = null;
let loadPromise = null;
const DEFAULT_MODEL_URL =
  'https://raw.githubusercontent.com/infinitered/nsfwjs/master/models/mobilenet_v2/model.json';

// Block thresholds — tune here. nsfw* are nsfwjs class probabilities,
// This runs only as a fast, user-side guard. Do not use it to infer faces or
// suggestive content: those lightweight browser models routinely mistake car
// grilles, reflections and paint for people. The backend performs the auditable
// moderation decision with a confidence-scored provider.
export const THRESHOLDS = {
  Porn: 0.98,
  Hentai: 0.98,
};

// Exported for test resets only — not for production use
export function _resetModels() {
  nsfwModel = null;
  loadPromise = null;
}

async function loadModels() {
  if (!loadPromise) {
    // Dynamic imports avoid the TensorFlow.js circular-dependency TDZ crash
    // that occurs when nsfwjs / blazeface are imported at module top level.
    loadPromise = Promise.all([
      import('@tensorflow/tfjs'),
      import('@tensorflow/tfjs-backend-webgl'),
      import('nsfwjs/core'),
    ]).then(([, , nsfwjsCore]) =>
      nsfwjsCore.load(
        process.env.REACT_APP_NSFW_MODEL_URL || DEFAULT_MODEL_URL,
      )
    ).then((nsfw) => {
      nsfwModel = nsfw;
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
 *   reasons: subset of ['nudity']
 */
export async function moderateImage(file) {
  await loadModels();
  const img = await fileToImageElement(file);

  const predictions = await nsfwModel.classify(img);

  const reasons = [];

  const prob = Object.fromEntries(predictions.map(p => [p.className, p.probability]));
  if ((prob.Porn || 0) > THRESHOLDS.Porn) reasons.push('nudity');
  if ((prob.Hentai || 0) > THRESHOLDS.Hentai) reasons.push('nudity');

  if (reasons.length) {
    // Log the actual scores so a false positive is diagnosable next time.
    console.warn('imageModeration blocked', {
      reasons: [...new Set(reasons)],
      scores: prob,
    });
  }
  return { blocked: reasons.length > 0, reasons: [...new Set(reasons)] };
}
