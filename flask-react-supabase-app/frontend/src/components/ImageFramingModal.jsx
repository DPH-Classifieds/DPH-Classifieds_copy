import React, { useRef } from 'react';
import '../styles/ImageFramingModal.css';

const DEFAULT_CROP = { focalX: 50, focalY: 50, zoom: 1 };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const ImageFramingModal = ({
  isOpen,
  images,
  cropSettings,
  activeIndex,
  onActiveIndexChange,
  onUpdateCrop,
  onApplyCurrentToAll,
  onClose,
  title = 'Adjust Listing Frame'
}) => {
  const stageRef = useRef(null);

  if (!isOpen || !Array.isArray(images) || images.length === 0) {
    return null;
  }

  const safeIndex = clamp(activeIndex ?? 0, 0, images.length - 1);
  const currentImage = images[safeIndex];
  const currentCrop = cropSettings?.[safeIndex] || DEFAULT_CROP;

  const setFocalPoint = (event) => {
    if (!stageRef.current || !currentImage) return;
    const bounds = stageRef.current.getBoundingClientRect();
    const relativeX = ((event.clientX - bounds.left) / bounds.width) * 100;
    const relativeY = ((event.clientY - bounds.top) / bounds.height) * 100;

    onUpdateCrop(safeIndex, {
      focalX: clamp(relativeX, 0, 100),
      focalY: clamp(relativeY, 0, 100)
    });
  };

  const handleZoomChange = (event) => {
    const zoom = Number.parseFloat(event.target.value);
    onUpdateCrop(safeIndex, { zoom: Number.isFinite(zoom) ? zoom : 1 });
  };

  return (
    <div className="ifm-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ifm-modal">
        <div className="ifm-header">
          <div>
            <h3>{title}</h3>
            <p>
              Photo {safeIndex + 1} of {images.length}. Click inside the frame to set focus.
            </p>
          </div>
          <button type="button" className="ifm-close" onClick={onClose} aria-label="Close framing modal">
            ×
          </button>
        </div>

        <div className="ifm-body">
          <div className="ifm-stage-wrap">
            <div className="ifm-stage" ref={stageRef} onClick={setFocalPoint}>
              {currentImage?.previewUrl ? (
                <img
                  src={currentImage.previewUrl}
                  alt={currentImage.name || `Photo ${safeIndex + 1}`}
                  style={{
                    objectPosition: `${currentCrop.focalX ?? 50}% ${currentCrop.focalY ?? 50}%`,
                    transform: `scale(${currentCrop.zoom ?? 1})`
                  }}
                />
              ) : null}
              <div className="ifm-focal-dot" style={{ left: `${currentCrop.focalX ?? 50}%`, top: `${currentCrop.focalY ?? 50}%` }} />
            </div>
            <div className="ifm-stage-caption">Hero frame ratio: 16:10</div>
          </div>

          <div className="ifm-controls">
            <label htmlFor="ifm-zoom">Zoom</label>
            <input
              id="ifm-zoom"
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={currentCrop.zoom ?? 1}
              onChange={handleZoomChange}
            />
            <div className="ifm-zoom-value">{(currentCrop.zoom ?? 1).toFixed(2)}x</div>

            <div className="ifm-mini-preview">
              <img
                src={currentImage?.previewUrl}
                alt="Mini preview"
                style={{
                  objectPosition: `${currentCrop.focalX ?? 50}% ${currentCrop.focalY ?? 50}%`,
                  transform: `scale(${currentCrop.zoom ?? 1})`
                }}
              />
            </div>

            <button type="button" className="ifm-action" onClick={() => onApplyCurrentToAll(safeIndex)}>
              Apply This Framing To All Photos
            </button>
          </div>
        </div>

        <div className="ifm-footer">
          <button
            type="button"
            className="ifm-nav"
            disabled={safeIndex <= 0}
            onClick={() => onActiveIndexChange(safeIndex - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="ifm-nav"
            disabled={safeIndex >= images.length - 1}
            onClick={() => onActiveIndexChange(safeIndex + 1)}
          >
            Next
          </button>
          <button type="button" className="ifm-done" onClick={onClose}>
            Save Framing
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageFramingModal;
