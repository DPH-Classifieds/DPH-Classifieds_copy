import React, { useEffect, useState } from 'react';
import useSwipe from '../hooks/useSwipe';

const closeBtn = {
  position: 'absolute', top: -6, right: -6, width: 38, height: 38, borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(10,10,10,0.7)',
  color: '#fff', fontSize: 24, lineHeight: '34px', cursor: 'pointer', zIndex: 2,
};
const navBtn = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)', width: 44, height: 44,
  borderRadius: 999, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(10,10,10,0.7)',
  color: '#fff', fontSize: 24, lineHeight: '40px', cursor: 'pointer', zIndex: 2,
};
const counter = {
  position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
  background: 'rgba(10,10,10,0.7)', color: '#fff', fontSize: 13, padding: '4px 12px', borderRadius: 999,
};

// Fullscreen image viewer: click a listing photo to expand. Esc / arrows / swipe
// / click-outside all supported. Render only while open.
export default function ImageLightbox({ images = [], startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  useEffect(() => setIndex(startIndex), [startIndex]);

  const many = images.length > 1;
  const step = (dir) => setIndex((c) => (c + dir + images.length) % images.length);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  const swipeRef = useSwipe({ onSwipeLeft: () => step(1), onSwipeRight: () => step(-1), enabled: many });

  if (!images.length) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.9)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
      }}
    >
      <div
        ref={swipeRef}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: 'min(1100px, 96vw)', maxHeight: '90vh', touchAction: 'pan-y' }}
      >
        <button type="button" onClick={onClose} aria-label="Close image viewer" style={closeBtn}>×</button>
        {many && <button type="button" onClick={() => step(-1)} aria-label="Previous image" style={{ ...navBtn, left: 8 }}>‹</button>}
        <img
          src={images[index]}
          alt={`View ${index + 1}`}
          style={{ width: '100%', maxHeight: '90vh', objectFit: 'contain', borderRadius: 12, display: 'block' }}
        />
        {many && <button type="button" onClick={() => step(1)} aria-label="Next image" style={{ ...navBtn, right: 8 }}>›</button>}
        {many && <div style={counter}>{index + 1} / {images.length}</div>}
      </div>
    </div>
  );
}
