import * as tf from '@tensorflow/tfjs-react-native';
import * as nsfwjs from 'nsfwjs';
import * as blazeface from '@tensorflow-models/blazeface';
// SDK 54 moved readAsStringAsync/EncodingType to the legacy entry point.
import * as FileSystem from 'expo-file-system/legacy';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';

let nsfwModel = null;
let faceModel = null;
let loadPromise = null;

// Block thresholds — tune here. Keep in sync with the web copy in
// frontend/src/utils/imageModeration.js (separate package, can't share).
export const THRESHOLDS = {
  Porn: 0.60,
  Hentai: 0.60,
  Sexy: 0.70,
  FACE: 0.75,
};

// Exported for test resets only
export function _resetModels() {
  nsfwModel = null;
  faceModel = null;
  loadPromise = null;
}

async function loadModels() {
  if (!loadPromise) {
    loadPromise = (async () => {
      await tf.ready();
      [nsfwModel, faceModel] = await Promise.all([
        nsfwjs.load(),
        blazeface.load(),
      ]);
    })();
    // Don't cache a rejected load — one transient failure would otherwise leave
    // moderation silently disabled for the whole session. Reset so the next
    // moderateImage() retries.
    loadPromise.catch(() => { loadPromise = null; });
  }
  await loadPromise;
}

async function uriToTensor(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return decodeJpeg(raw);
}

/**
 * @param {string} uri  - image URI from expo-image-picker
 * @returns {Promise<{ blocked: boolean, reasons: string[] }>}
 *   reasons: subset of ['nudity', 'face']
 */
export async function moderateImage(uri) {
  await loadModels();

  let tensor;
  try {
    tensor = await uriToTensor(uri);
  } catch (err) {
    console.warn('imageModeration: failed to decode image, allowing:', err);
    return { blocked: false, reasons: [] };
  }

  try {
    const [predictions, faces] = await Promise.all([
      nsfwModel.classify(tensor),
      faceModel.estimateFaces(tensor, false),
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

    return { blocked: reasons.length > 0, reasons: [...new Set(reasons)] };
  } finally {
    tf.dispose(tensor);
  }
}
