// flask-react-supabase-app/frontend/src/components/cropper/cropUtils.js
//
// Pure helpers for UnifiedCropper. No React, no DOM mutation. Tested in isolation.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Convert a legacy focal-point pair (0-100 each, in CSS object-position units)
 * into the {x, y, zoom} state that react-easy-crop expects.
 *
 * react-easy-crop's crop state is the offset of the image FROM the centre, in
 * px. A focal point of (50,50) means "centre the crop on the centre of the
 * image", which maps to {x:0, y:0}. A focal point of (0,0) means "top-left
 * of the image is the visual focus", so the crop window needs to be offset
 * up and left — we represent that as small negative x/y. The component
 * normalises these to pixel offsets at runtime via the source dimensions.
 */
export function mapLegacyFocalPointToCrop(legacy = {}) {
  const focalX = clamp(Number(legacy.focal_x ?? 50), 0, 100);
  const focalY = clamp(Number(legacy.focal_y ?? 50), 0, 100);
  const zoom = Number.isFinite(Number(legacy.zoom)) ? Number(legacy.zoom) : 1;
  // Symmetric around (50,50); offset range ±50 (arbitrary units that
  // react-easy-crop scales by the image size).
  const x = focalX - 50;
  const y = focalY - 50;
  return { x, y, zoom };
}

/**
 * Load a File or URL into an HTMLImageElement, resolved when decode is done.
 * Used by getCroppedBlob and EXIF normalisation.
 */
export function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}

/**
 * Decode an image and bake its EXIF orientation into the pixels. Returns a
 * Blob in the same format as the input. Most modern browsers handle this
 * via the `image-orientation: from-image` CSS property at render time, but
 * canvas drawImage ignores EXIF — so we have to do it ourselves before
 * cropping. Returns the input unchanged if there is no orientation to apply
 * or we can't read EXIF (best-effort).
 */
export async function normaliseImageOrientation(file) {
  // Modern Image() with createImageBitmap honours EXIF when imageOrientation
  // is 'from-image'. Use that where available — it's the cheap path.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), file.type || 'image/jpeg', 0.95);
      });
    } catch (_) {
      // fall through to raw file
    }
  }
  return file;
}

/**
 * Generate a cropped JPEG blob from a source image and the crop region in
 * pixel coordinates. The output is sized to the kind's target dimensions.
 *
 * @param {HTMLImageElement} image      decoded source image
 * @param {{x:number,y:number,width:number,height:number}} pixelCrop
 * @param {{outputWidth:number,outputHeight:number,quality:number}} kindConfig
 * @param {number} rotation             0 | 90 | 180 | 270
 * @returns {Promise<Blob>}
 */
export function getCroppedBlob(image, pixelCrop, kindConfig, rotation = 0) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = kindConfig.outputWidth;
    canvas.height = kindConfig.outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas 2D context unavailable'));

    const radians = ((rotation || 0) % 360) * (Math.PI / 180);
    if (radians === 0) {
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        kindConfig.outputWidth,
        kindConfig.outputHeight
      );
    } else {
      // Rotate around the centre of the output canvas
      ctx.save();
      ctx.translate(kindConfig.outputWidth / 2, kindConfig.outputHeight / 2);
      ctx.rotate(radians);
      ctx.translate(-kindConfig.outputWidth / 2, -kindConfig.outputHeight / 2);
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        kindConfig.outputWidth,
        kindConfig.outputHeight
      );
      ctx.restore();
    }

    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Crop blob generation failed'))),
      'image/jpeg',
      kindConfig.quality ?? 0.88
    );
  });
}

/**
 * Convenience: get a {file, previewUrl} pair from a Blob using the same
 * filename pattern the rest of the app expects. Kind is for the filename
 * prefix.
 */
export function blobToFile(blob, kind = 'image') {
  const file = new File([blob], `${kind}-${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
  return { file, previewUrl: URL.createObjectURL(blob) };
}
