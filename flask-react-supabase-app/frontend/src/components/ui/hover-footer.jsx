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
    <footer className="py-16 md:py-32" style={{ background: 'linear-gradient(180deg, rgba(6, 19, 11, 0.92) 0%, rgba(4, 9, 7, 1) 100%)', borderTop: '1px solid rgba(180, 227, 185, 0.08)' }}>
      <div className="mx-auto max-w-5xl px-6">
        <Link
          to="/"
          aria-label="DPHClassifieds home"
          className="mx-auto block size-fit">
          <span style={{ fontSize: '1.4rem', fontWeight: 700, color: '#98d99c' }}>DPHClassifieds</span>
        </Link>

        <div className="my-8 flex flex-wrap justify-center gap-6 text-sm">
          {navLinks.map((link, index) => (
            <Link
              key={index}
              to={link.href}
              style={{ color: 'rgba(226, 239, 229, 0.72)' }}
              className="hover:!text-[#a3e5a7] block duration-150">
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
        <span style={{ color: 'rgba(226, 239, 229, 0.45)' }} className="block text-center text-sm">
          © {currentYear} DPHClassifieds, All rights reserved
        </span>
      </div>
    </footer>
  );
};

export default Footer;
