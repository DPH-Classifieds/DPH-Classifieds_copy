import React from 'react';
import { Link } from 'react-router-dom';
import './hover-footer.css';

const footerGroups = [
  {
    title: 'Browse',
    links: [
      { label: 'Explore', href: '/explore' },
      { label: 'Cars', href: '/cars' },
      { label: 'Car Parts', href: '/car-parts' },
      { label: 'Plates', href: '/plates' },
      { label: 'Bikes', href: '/bikes' }
    ]
  },
  {
    title: 'Post',
    links: [
      { label: 'Sell Your Car', href: '/post-car' },
      { label: 'Sell Parts', href: '/post-car-parts' },
      { label: 'Sell a Plate', href: '/post-plate' },
      { label: 'Sell Your Bike', href: '/post-bike' }
    ]
  },
  {
    title: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Privacy Policy', href: '/privacy-policy' },
      { label: 'Terms of Use', href: '/terms-of-use' },
      { label: 'Contact', href: '/contact' }
    ]
  }
];

const socialLinks = [
  { label: 'Reddit', href: 'https://www.reddit.com/r/DubaiPetrolHeads/' },
  { label: 'Website', href: 'https://www.dubaipetrolheads.ae/' },
  { label: 'Instagram', href: 'https://www.instagram.com/dubaipetrolheads' }
];

const Footer = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-footer-shell">
        <div className="site-footer-panel">
          <div className="site-footer-topbar">
            <Link to="/" className="site-footer-logo logo" aria-label="DPHClassifieds home">
              <span className="logo-icon" aria-hidden="true"></span>
              <span className="logo-text">DPHClassifieds</span>
            </Link>
            <div className="site-footer-contact">
              <a href="mailto:support@dphclassifieds.com">support@dphclassifieds.com</a>
              <span>Dubai, UAE</span>
            </div>
          </div>

          <div className="site-footer-grid">
            {footerGroups.map((group) => (
              <section key={group.title} className="site-footer-section">
                <h2>{group.title}</h2>
                <ul>
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link to={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <section className="site-footer-section site-footer-social">
              <h2>Follow</h2>
              <ul>
                {socialLinks.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="site-footer-bottom">
            <span>DPH Classifieds</span>
            <span>© {currentYear} All rights reserved.</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
