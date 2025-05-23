import React from 'react';
import '../styles/Footer.css';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-section">
          <h3>About Us</h3>
          <p>We're dedicated to connecting car buyers and sellers with the most reliable and user-friendly platform.</p>
        </div>
        
        <div className="footer-section">
          <h3>Quick Links</h3>
          <ul>
            <li><a href="/">Home</a></li>
            <li><a href="/cars">Browse Cars</a></li>
            <li><a href="/create-listing">Sell Your Car</a></li>
            <li><a href="/about">About</a></li>
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
        <p>&copy; {currentYear} Car Classifieds. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer; 