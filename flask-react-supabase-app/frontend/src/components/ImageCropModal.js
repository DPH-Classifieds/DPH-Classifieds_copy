import React, { useCallback, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';

const CROP_OUTPUT_SIZE = 512;

const createCroppedImage = (imageSrc, pixelCrop) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = CROP_OUTPUT_SIZE;
      canvas.height = CROP_OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');

      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        CROP_OUTPUT_SIZE,
        CROP_OUTPUT_SIZE,
      );

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create cropped image'));
            return;
          }
          resolve(blob);
        },
        'image/jpeg',
        0.92,
      );
    };
    image.onerror = () => reject(new Error('Failed to load image for cropping'));
    image.src = imageSrc;
  });

const ImageCropModal = ({ imageSrc, onCropComplete, onCancel }) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropping, setCropping] = useState(false);
  const croppedAreaPixelsRef = useRef(null);

  const onCropComplete = useCallback((_croppedArea, croppedAreaPixels) => {
    croppedAreaPixelsRef.current = croppedAreaPixels;
  }, []);

  const handleApply = async () => {
    const pixels = croppedAreaPixelsRef.current;
    if (!pixels || !imageSrc) return;

    setCropping(true);
    try {
      const blob = await createCroppedImage(imageSrc, pixels);
      const file = new File([blob], 'profile-photo.jpg', { type: 'image/jpeg', lastModified: Date.now() });
      const previewUrl = URL.createObjectURL(blob);
      onCropComplete(file, previewUrl);
    } catch (err) {
      console.error('Crop failed:', err);
    } finally {
      setCropping(false);
    }
  };

  if (!imageSrc) return null;

  return (
    <div className="crop-modal-overlay" role="dialog" aria-modal="true" aria-label="Crop profile photo">
      <div className="crop-modal">
        <div className="crop-modal-header">
          <h3>Edit Profile Photo</h3>
          <p>Drag to reposition. Use the slider to zoom.</p>
        </div>

        <div className="crop-modal-body">
          <div className="crop-container">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>

          <div className="crop-zoom-controls">
            <span className="crop-zoom-label">Zoom out</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="crop-zoom-slider"
            />
            <span className="crop-zoom-label">Zoom in</span>
          </div>
        </div>

        <div className="crop-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={cropping}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={cropping}
            onClick={handleApply}
          >
            {cropping ? 'Processing...' : 'Apply Crop'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageCropModal;
