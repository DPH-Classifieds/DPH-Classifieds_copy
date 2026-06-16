import { useEffect, useRef } from 'react';

const DEFAULT_DISTANCE_THRESHOLD = 50;
const DEFAULT_VELOCITY_THRESHOLD = 0.3;

export default function useSwipe({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
  distanceThreshold = DEFAULT_DISTANCE_THRESHOLD,
  velocityThreshold = DEFAULT_VELOCITY_THRESHOLD,
} = {}) {
  const ref = useRef(null);
  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);

  useEffect(() => {
    onSwipeLeftRef.current = onSwipeLeft;
    onSwipeRightRef.current = onSwipeRight;
  }, [onSwipeLeft, onSwipeRight]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return undefined;

    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let active = false;

    const handlePointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target && typeof event.target.closest === 'function') {
        const interactive = event.target.closest('button, a, input, textarea, select, [role="button"]');
        if (interactive && interactive !== node && node.contains(interactive)) {
          return;
        }
      }
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startTime = event.timeStamp;
      active = true;
      try {
        node.setPointerCapture(event.pointerId);
      } catch (e) {
        // ignore — Safari sometimes throws on capture for synthetic pointers
      }
    };

    const finishSwipe = (event) => {
      if (!active || event.pointerId !== pointerId) return;
      active = false;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const dt = Math.max(1, event.timeStamp - startTime);
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      try {
        node.releasePointerCapture(event.pointerId);
      } catch (e) {
        // ignore
      }

      if (absDx < distanceThreshold) return;
      if (absDx <= absDy) return;
      const velocity = absDx / dt;
      if (velocity < velocityThreshold && absDx < distanceThreshold * 2) return;

      if (dx < 0) {
        onSwipeLeftRef.current && onSwipeLeftRef.current();
      } else {
        onSwipeRightRef.current && onSwipeRightRef.current();
      }
    };

    const handlePointerCancel = (event) => {
      if (event.pointerId !== pointerId) return;
      active = false;
      try {
        node.releasePointerCapture(event.pointerId);
      } catch (e) {
        // ignore
      }
    };

    node.addEventListener('pointerdown', handlePointerDown);
    node.addEventListener('pointerup', finishSwipe);
    node.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointerup', finishSwipe);
      node.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [enabled, distanceThreshold, velocityThreshold]);

  return ref;
}
