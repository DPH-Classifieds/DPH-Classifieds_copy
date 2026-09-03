import React, { useMemo } from 'react';
import { useScrollSpy } from '../../hooks/useScrollSpy';
import './LegalLayout.css';

// Editorial layout for long-form legal / policy documents.
// - Hero: eyebrow + H1 + optional summary + effective date
// - Sticky TOC on desktop (>=1024px) with scrollspy active highlight
// - <details> collapsible TOC on mobile
// - Reading column max 70ch, line-height 1.75
// - Top progress bar tied to scroll
//
// Children render inside the reading column. Each H2 in the children should
// have `data-legal-section="<id>"` and matching `id="<id>"`. The TOC is
// derived by querying the DOM after mount (no prop drilling of section
// lists required).
//
// Props:
//   eyebrow (string) — small label above the title (e.g. "Legal")
//   title (string) — H1
//   summary (string) — optional one-line subtitle below the title
//   effectiveDate (string) — e.g. "Effective date: 25 May 2026"
//   tocLabel (string) — defaults to "Contents"
const LegalLayout = ({ eyebrow, title, summary, effectiveDate, tocLabel = 'Contents', children }) => {
  // Sections are discovered after render; we use a stable ref to query the DOM.
  const readingRef = React.useRef(null);
  const activeId = useScrollSpy();
  const [sections, setSections] = React.useState([]);
  const [progress, setProgress] = React.useState(0);

  React.useEffect(() => {
    if (!readingRef.current) return undefined;
    const nodes = Array.from(readingRef.current.querySelectorAll('[data-legal-section]'));
    const discovered = nodes.map((node) => ({
      id: node.getAttribute('data-legal-section') || node.id,
      title: (node.textContent || '').trim(),
    }));
    setSections(discovered);

    const onScroll = () => {
      if (!readingRef.current) return;
      const rect = readingRef.current.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) {
        setProgress(0);
        return;
      }
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      setProgress((scrolled / total) * 100);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [children]);

  const tocItems = useMemo(() => sections, [sections]);

  const handleAnchor = (e, id) => {
    e.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <div className="legal-layout">
      <div
        className="legal-layout-progress"
        aria-hidden="true"
        style={{ width: `${progress}%` }}
      />

      <header className="legal-layout-hero">
        {eyebrow && <span className="legal-layout-eyebrow">{eyebrow}</span>}
        <h1 className="legal-layout-title">{title}</h1>
        {summary && <p className="legal-layout-summary">{summary}</p>}
        {effectiveDate && <p className="legal-layout-date">{effectiveDate}</p>}
      </header>

      <div className="legal-layout-grid">
        <aside className="legal-layout-toc" aria-label={tocLabel}>
          <div className="legal-layout-toc-inner">
            <p className="legal-layout-toc-label">{tocLabel}</p>
            <ol className="legal-layout-toc-list">
              {tocItems.map((s, idx) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={`legal-layout-toc-link ${activeId === s.id ? 'is-active' : ''}`}
                    onClick={(e) => handleAnchor(e, s.id)}
                  >
                    <span className="legal-layout-toc-num">{String(idx + 1).padStart(2, '0')}</span>
                    <span className="legal-layout-toc-title">{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        <details className="legal-layout-toc-mobile">
          <summary>{tocLabel}</summary>
          <ol className="legal-layout-toc-list">
            {tocItems.map((s, idx) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={`legal-layout-toc-link ${activeId === s.id ? 'is-active' : ''}`}
                  onClick={(e) => handleAnchor(e, s.id)}
                >
                  <span className="legal-layout-toc-num">{String(idx + 1).padStart(2, '0')}</span>
                  <span className="legal-layout-toc-title">{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </details>

        <article className="legal-layout-article" ref={readingRef}>
          {children}
        </article>
      </div>
    </div>
  );
};

export default LegalLayout;
