import React from 'react';
import { Link } from 'react-router-dom';
import ReportBugButton from './ReportBugButton';
import '../styles/Footer.css';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-section footer-brand">
          <span className="footer-kicker">DPH Classifieds</span>
          <p>
            A cleaner green-first marketplace for the UAE car community, built to make browsing and
            listing feel more considered.
          </p>
        </div>

        <div className="footer-section">
          <h3>About</h3>
          <ul>
            <li><Link to="/about">About</Link></li>
            <li><Link to="/privacy-policy">Privacy Policy</Link></li>
            <li><Link to="/terms-of-use">Terms of Use</Link></li>
          </ul>
        </div>
        
        <div className="footer-section">
          <h3>Quick Links</h3>
          <ul>
            <li><Link to="/">Home</Link></li>
            <li><Link to="/explore">Explore</Link></li>
            <li><Link to="/cars">Browse Cars</Link></li>
            <li><Link to="/post-car">Sell Your Car</Link></li>
            <li>
              <ReportBugButton className="footer-button" buttonText="Report a Bug" />
            </li>
          </ul>
        </div>
        
        <div className="footer-section">
          <h3>Contact Us</h3>
          <ul>
            <li>Email: support@dphclassifieds.com</li>
            <li>Address: Dubai,UAE</li>
          </ul>
        </div>
        
        <div className="footer-section">
          <h3>Follow Us</h3>
          <div className="social-links">
            <a href="https://www.reddit.com/r/DubaiPetrolHeads/" target="_blank" rel="noopener noreferrer"><i className="fab fa-reddit"></i> Reddit</a>
            <a href="https://www.dubaipetrolheads.ae/" target="_blank" rel="noopener noreferrer"><i className="fab fa-website"></i> Website</a>
            <a href="https://www.instagram.com/dubaipetrolheads?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw=="><i className="fab fa-instagram"></i> Instagram</a>
          </div>
        </div>
      </div>
      
      <div className="footer-bottom">
        <p>&copy; {currentYear} DPH Classifieds. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
