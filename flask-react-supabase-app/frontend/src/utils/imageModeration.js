let nsfwModel = null;
let faceModel = null;
let loadPromise = null;

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
  if ((prob.Porn || 0) > 0.60) reasons.push('nudity');
  if ((prob.Hentai || 0) > 0.60) reasons.push('nudity');
  if ((prob.Sexy || 0) > 0.70) reasons.push('nudity');

  const faceDetected = faces.some(f => {
    const p = Array.isArray(f.probability) ? f.probability[0] : (f.probability ?? 1);
    return p > 0.75;
  });
  if (faceDetected) reasons.push('face');

  return { blocked: reasons.length > 0, reasons: [...new Set(reasons)] };
}
