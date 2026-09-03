import React from 'react';
import { Link } from 'react-router-dom';

const navLinks = [
  { title: 'About', href: '/about' },
  { title: 'Privacy Policy', href: '/privacy-policy' },
  { title: 'Terms of Use', href: '/terms-of-use' },
  { title: 'Contact', href: '/contact' },
  { title: 'Explore', href: '/explore' },
  { title: 'Help', href: '/post-car' },
];

const SocialIcon = ({ src, alt, href, label }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={label}
    className="block duration-150 hover:opacity-80">
    <img
      src={`${process.env.PUBLIC_URL}${src}`}
      alt={alt}
      style={{ width: 28, height: 28 }}
      onError={(e) => { e.target.style.display = 'none'; }}
    />
  </a>
);

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer
      className="py-16 md:py-32"
      // Every page ends with this footer; it's never interactive until
      // scrolled into view, so defer its rendering cost until then. Not
      // sticky, no off-screen a11y focus targets — a safe candidate.
      style={{
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--ex-surface) 92%, transparent) 0%, var(--ex-surface) 100%)',
        borderTop: '1px solid color-mix(in srgb, var(--ex-brand-accent) 14%, transparent)',
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 500px',
      }}
    >
      <div className="mx-auto max-w-5xl px-6">
        <Link
          to="/"
          aria-label="DPHClassifieds home"
          className="mx-auto block size-fit">
          <span style={{ fontSize: '1.4rem', fontWeight: 700 }}><span style={{ color: 'var(--ex-text)' }}>DPH</span><span style={{ color: 'var(--ex-brand-accent)' }}>Classifieds</span></span>
        </Link>

        <div className="my-8 flex flex-wrap justify-center gap-6 text-sm">
          {navLinks.map((link, index) => (
            <Link
              key={index}
              to={link.href}
              style={{ color: 'color-mix(in srgb, var(--ex-text) 72%, transparent)' }}
              className="hover:!text-[color:var(--ex-brand-accent)] block duration-150">
              <span>{link.title}</span>
            </Link>
          ))}
        </div>
        <div className="my-8 flex flex-wrap justify-center gap-8 text-sm">
          <SocialIcon
            src="/reddit-logo.png"
            alt="Reddit"
            href="https://www.reddit.com/r/DubaiPetrolHeads/"
            label="Reddit"
          />
          <SocialIcon
            src="/instagram-logo.png"
            alt="Instagram"
            href="https://www.instagram.com/dubaipetrolheads"
            label="Instagram"
          />
        </div>
        <span style={{ color: 'color-mix(in srgb, var(--ex-text) 50%, transparent)' }} className="block text-center text-sm">
          © {currentYear} <span style={{ color: 'var(--ex-text)' }}>DPH</span><span style={{ color: 'var(--ex-brand-accent)' }}>Classifieds</span>, All rights reserved
        </span>
      </div>
    </footer>
  );
};

export default Footer;
