// flask-react-supabase-app/frontend/src/components/cropper/kindConfig.js
//
// Single source of truth for per-kind crop output settings. Imported by
// UnifiedCropper, the cropUtils helpers, AND the detail-page renderers (so
// they can use kind-aware fallback CSS for legacy rows).

export const KIND_CONFIG = {
  car: {
    aspect: 16 / 10,
    outputWidth: 1600,
    outputHeight: 1000,
    shape: 'rect',
    title: 'Crop your car photos',
    hint: 'Drag to position. Pinch or scroll to zoom.',
    quality: 0.88,
  },
  bike: {
    aspect: 16 / 10,
    outputWidth: 1600,
    outputHeight: 1000,
    shape: 'rect',
    title: 'Crop your bike photos',
    hint: 'Drag to position. Pinch or scroll to zoom.',
    quality: 0.88,
  },
  plate: {
    aspect: 4 / 1,
    outputWidth: 1600,
    outputHeight: 400,
    shape: 'rect',
    title: 'Crop the plate',
    hint: 'Frame the plate edge-to-edge for the cleanest look.',
    quality: 0.92,
  },
  part: {
    aspect: 1,
    outputWidth: 1200,
    outputHeight: 1200,
    shape: 'rect',
    title: 'Crop the part',
    hint: 'Center the part in the frame.',
    quality: 0.88,
  },
  profile: {
    aspect: 1,
    outputWidth: 512,
    outputHeight: 512,
    shape: 'round',
    title: 'Crop your photo',
    hint: 'Drag to position. Pinch to zoom.',
    quality: 0.92,
  },
};

export function getKindConfig(kind) {
  return KIND_CONFIG[kind] || KIND_CONFIG.car;
}
