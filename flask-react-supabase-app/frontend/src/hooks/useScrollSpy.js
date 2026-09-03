import { useEffect, useState } from 'react';

// Tracks which [data-legal-section] element is currently most visible in the
// viewport. Returns the active section's id (string) or null if none.
// Requires IntersectionObserver (universal browser support; degrades gracefully).
//
// `selector` defaults to '[data-legal-section]'. The observer is set up once on
// mount; on unmount it disconnects. Resize is intentionally not observed — the
// observer re-fires when sections enter/leave the viewport, which already
// covers layout changes that affect visibility.
export function useScrollSpy(selector = '[data-legal-section]', options = {}) {
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return undefined;
    }
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length === 0) {
      return undefined;
    }

    // Track each element's intersection ratio. When the observer fires we
    // recompute the "most visible" element by ratio, falling back to the one
    // whose top is closest to a 100px-from-top reading band.
    const visibility = new Map();
    elements.forEach((el) => visibility.set(el, 0));

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibility.set(entry.target, entry.intersectionRatio);
        });
        let bestEl = null;
        let bestRatio = 0;
        elements.forEach((el) => {
          const ratio = visibility.get(el) || 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestEl = el;
          }
        });
        if (bestEl) {
          const next = bestEl.getAttribute('data-legal-section') || bestEl.id || null;
          setActiveId((prev) => (prev === next ? prev : next));
        }
      },
      {
        // Reading band: top of viewport down to 70% — favors whichever
        // section currently occupies the upper reading area.
        rootMargin: '-80px 0px -55% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
        ...options,
      }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [selector, options]);

  return activeId;
}

export default useScrollSpy;
