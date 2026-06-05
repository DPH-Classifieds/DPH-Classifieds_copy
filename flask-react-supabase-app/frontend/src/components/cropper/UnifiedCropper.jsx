// flask-react-supabase-app/frontend/src/components/cropper/UnifiedCropper.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { getKindConfig } from './kindConfig';
import {
  getCroppedBlob,
  loadImageElement,
  mapLegacyFocalPointToCrop,
  normaliseImageOrientation,
  blobToFile,
} from './cropUtils';
// unifiedCropper.css is imported from App.js (top-level) instead of here so
// that webpack's mini-css-extract-plugin doesn't see it in the lazy chunk,
// where it would conflict-order with PostForms.css and fail CI builds.

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const MAX_INPUT_PIXELS = 25_000_000; // 25 MP source cap (memory guard)

/**
 * UnifiedCropper — single component used by every post-listing flow plus
 * AccountSettings. See docs/superpowers/specs/2026-06-05-unified-cropper-design.md.
 *
 * Props:
 *   kind:        "car" | "bike" | "plate" | "part" | "profile"
 *   images:      File[] OR Array<{file, previewUrl?, existingCrop?}>
 *   isOpen:      boolean
 *   onClose:     () => void
 *   onComplete:  (results) => void
 *     where results = Array<{ croppedFile: File, originalFile: File, previewUrl: string }>
 */
export default function UnifiedCropper({ kind, images, isOpen, onClose, onComplete }) {
  const cfg = useMemo(() => getKindConfig(kind), [kind]);
  const isSingleProfile = kind === 'profile' || (images && images.length === 1 && kind === 'profile');

  // Normalise: caller can pass File[] or wrapped objects.
  const normalisedImages = useMemo(() => {
    if (!images) return [];
    return images.map((img) => {
      if (img instanceof File) {
        return { file: img, previewUrl: URL.createObjectURL(img), existingCrop: null };
      }
      const file = img.file ?? img;
      const previewUrl = img.previewUrl ?? (file ? URL.createObjectURL(file) : null);
      return { file, previewUrl, existingCrop: img.existingCrop ?? null };
    });
  }, [images]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [perImageState, setPerImageState] = useState(() =>
    normalisedImages.map((img) => {
      const seeded = img.existingCrop ? mapLegacyFocalPointToCrop(img.existingCrop) : { x: 0, y: 0, zoom: 1 };
      return {
        crop: { x: seeded.x, y: seeded.y },
        zoom: seeded.zoom,
        rotation: 0,
        croppedAreaPixels: null,
      };
    })
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);
  const previewUrlsRef = useRef(normalisedImages.map((i) => i.previewUrl));

  // Cleanup blob URLs on unmount
  useEffect(() => {
    const urlsRef = previewUrlsRef;
    return () => {
      urlsRef.current.forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (ev) => {
      if (ev.key === 'Escape') return onClose();
      if (ev.key === 'Enter' && !ev.repeat) return handleDone();
      if (ev.key === 'ArrowRight') return setActiveIndex((i) => Math.min(i + 1, normalisedImages.length - 1));
      if (ev.key === 'ArrowLeft') return setActiveIndex((i) => Math.max(i - 1, 0));
      if (ev.key === '+' || ev.key === '=') return updateActive({ zoom: clampZoom(perImageState[activeIndex]?.zoom + ZOOM_STEP) });
      if (ev.key === '-' || ev.key === '_') return updateActive({ zoom: clampZoom(perImageState[activeIndex]?.zoom - ZOOM_STEP) });
      if (ev.key === 'r' || ev.key === 'R') return rotateActive();
      return undefined;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeIndex, perImageState, normalisedImages.length]);

  const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

  const updateActive = useCallback((patch) => {
    setPerImageState((prev) => prev.map((p, i) => (i === activeIndex ? { ...p, ...patch } : p)));
  }, [activeIndex]);

  const handleCropChange = useCallback((crop) => updateActive({ crop }), [updateActive]);
  const handleZoomChange = useCallback((zoom) => updateActive({ zoom }), [updateActive]);
  const handleCropComplete = useCallback(
    (_area, croppedAreaPixels) => updateActive({ croppedAreaPixels }),
    [updateActive]
  );

  const rotateActive = useCallback(() => {
    setPerImageState((prev) =>
      prev.map((p, i) =>
        i === activeIndex ? { ...p, rotation: (p.rotation + 90) % 360 } : p
      )
    );
  }, [activeIndex]);

  const applyCurrentToAll = useCallback(() => {
    const active = perImageState[activeIndex];
    if (!active) return;
    setPerImageState((prev) =>
      prev.map(() => ({
        crop: { ...active.crop },
        zoom: active.zoom,
        rotation: active.rotation,
        croppedAreaPixels: null, // re-derive per image; user must dwell on each
      }))
    );
  }, [perImageState, activeIndex]);

  const handleDone = useCallback(async () => {
    if (isProcessing) return;
    setError(null);
    setIsProcessing(true);
    cancelRef.current = false;
    const results = [];
    try {
      for (let i = 0; i < normalisedImages.length; i++) {
        if (cancelRef.current) break;
        const { file } = normalisedImages[i];
        const state = perImageState[i];
        // If user never dwelled on this image, croppedAreaPixels is null.
        // Compute a default centred crop from the source dimensions.
        const normalisedFile = await normaliseImageOrientation(file);
        const imgEl = await loadImageElement(normalisedFile);
        if (imgEl.width * imgEl.height > MAX_INPUT_PIXELS) {
          throw new Error(`Image ${file.name || i + 1} is too large (over 25 megapixels). Please resize before uploading.`);
        }
        const pixelCrop = state.croppedAreaPixels || defaultCenteredCrop(imgEl, cfg.aspect);
        const blob = await getCroppedBlob(imgEl, pixelCrop, cfg, state.rotation);
        const { file: croppedFile, previewUrl } = blobToFile(blob, kind);
        previewUrlsRef.current.push(previewUrl);
        results.push({ croppedFile, originalFile: file, previewUrl });
      }
      if (!cancelRef.current) {
        onComplete(results);
      }
    } catch (e) {
      setError(e.message || 'Cropping failed');
    } finally {
      setIsProcessing(false);
    }
  }, [normalisedImages, perImageState, cfg, kind, isProcessing, onComplete]);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    onClose();
  }, [onClose]);

  if (!isOpen) return null;
  if (!normalisedImages.length) return null;

  const active = normalisedImages[activeIndex];
  const activeState = perImageState[activeIndex] || { crop: { x: 0, y: 0 }, zoom: 1, rotation: 0 };
  const showThumbnails = !isSingleProfile && normalisedImages.length > 1;

  return (
    <div className="ucrop-overlay" role="dialog" aria-modal="true" aria-label={cfg.title}>
      <div className={`ucrop-modal ucrop-modal--${cfg.shape}`}>
        <header className="ucrop-header">
          <div>
            <h3>{cfg.title}</h3>
            <p>
              {normalisedImages.length > 1
                ? `${activeIndex + 1} of ${normalisedImages.length}. ${cfg.hint}`
                : cfg.hint}
            </p>
          </div>
          <button type="button" className="ucrop-close" onClick={handleCancel} aria-label="Close cropper">
            ×
          </button>
        </header>

        {error && <div className="ucrop-error">{error}</div>}

        <div className="ucrop-canvas">
          <Cropper
            image={active.previewUrl}
            crop={activeState.crop}
            zoom={activeState.zoom}
            rotation={activeState.rotation}
            aspect={cfg.aspect}
            cropShape={cfg.shape === 'round' ? 'round' : 'rect'}
            showGrid={cfg.shape === 'rect'}
            onCropChange={handleCropChange}
            onZoomChange={handleZoomChange}
            onCropComplete={handleCropComplete}
          />
        </div>

        <div className="ucrop-controls">
          <label htmlFor="ucrop-zoom">Zoom</label>
          <input
            id="ucrop-zoom"
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={activeState.zoom}
            onChange={(e) => updateActive({ zoom: Number(e.target.value) })}
          />
          <button type="button" className="ucrop-rotate" onClick={rotateActive} aria-label="Rotate 90 degrees">
            ↻ Rotate
          </button>
        </div>

        {showThumbnails && (
          <div className="ucrop-thumbs" data-testid="cropper-thumbnail-strip">
            {normalisedImages.map((img, i) => (
              <button
                type="button"
                key={i}
                className={`ucrop-thumb ${i === activeIndex ? 'ucrop-thumb--active' : ''}`}
                onClick={() => setActiveIndex(i)}
                aria-label={`Photo ${i + 1}`}
              >
                <img src={img.previewUrl} alt="" />
              </button>
            ))}
          </div>
        )}

        <footer className="ucrop-footer">
          {!isSingleProfile && normalisedImages.length > 1 && (
            <button type="button" className="ucrop-apply-all" onClick={applyCurrentToAll}>
              Apply current crop to all
            </button>
          )}
          <button type="button" className="ucrop-cancel" onClick={handleCancel} disabled={isProcessing}>
            Cancel
          </button>
          <button type="button" className="ucrop-done" onClick={handleDone} disabled={isProcessing}>
            {isProcessing ? 'Processing…' : 'Done'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Default centred crop assuming the cropper hasn't dwelled on this image. */
function defaultCenteredCrop(img, aspect) {
  const targetRatio = aspect;
  const sourceRatio = img.width / img.height;
  let width, height;
  if (sourceRatio > targetRatio) {
    height = img.height;
    width = img.height * targetRatio;
  } else {
    width = img.width;
    height = img.width / targetRatio;
  }
  return {
    x: (img.width - width) / 2,
    y: (img.height - height) / 2,
    width,
    height,
  };
}
