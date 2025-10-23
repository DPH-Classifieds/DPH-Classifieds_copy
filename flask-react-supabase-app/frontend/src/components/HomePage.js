import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import CarList from './CarList';
import '../styles/HomePage.css';

const HomePage = () => {
  useEffect(() => {
    const ctaHeading = document.querySelector('.cta-content h2');
    const ctaParagraph = document.querySelector('.cta-content p');
    
    if (ctaHeading) {
      ctaHeading.style.color = '#ffffff';
      ctaHeading.style.fontWeight = '600';
      ctaHeading.style.textShadow = '1px 1px 3px rgba(0,0,0,0.5)';
    }
    
    if (ctaParagraph) {
      ctaParagraph.style.color = '#ffffff';
      ctaParagraph.style.fontWeight = '500';
      ctaParagraph.style.textShadow = '1px 1px 2px rgba(0,0,0,0.5)';
    }
  }, []);

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-content">
          <h1>Find Your Perfect Car</h1>
          <p>Browse thousands of listings from verified sellers</p>
          <div className="hero-buttons">
            <Link to="/cars" className="btn btn-primary">Browse Cars</Link>
            <Link to="/post-car" className="btn btn-secondary">Sell Your Car</Link>
          </div>
        </div>
      </section>
      
      <section className="featured-section">
        <div className="container">
          <h2 className="section-heading">Featured Listings</h2>
          <CarList />
        </div>
      </section>
      
      <section className="why-choose-us-section">
        <div className="why-choose-us-content">
          <div className="why-choose-us-text">
            <h2>Why choose DPH-Classifieds?</h2>
            <p className="why-choose-subtitle">We are one of the largest Car Clubs in the country.</p>
            <p className="why-choose-subtitle">A Classifieds website for the people by the people.</p>
            
            <h3>Why Choose us?</h3>
            
            <ul className="benefits-list">
              <li>
                <span className="checkmark">✓</span>
                <span>Search desired Vehicle</span>
              </li>
              <li>
                <span className="checkmark">✓</span>
                <span>Select your Vehicle</span>
              </li>
              <li>
                <span className="checkmark">✓</span>
                <span>Get complete detail</span>
              </li>
              <li>
                <span className="checkmark">✓</span>
                <span>Verify Your phone number</span>
              </li>
              <li>
                <span className="checkmark">✓</span>
                <span>Get Contact Detail of Car Owner</span>
              </li>
            </ul>
            
            <Link to="/cars" className="btn-used-cars">
              Go to Used Cars
            </Link>
          </div>
        </div>
      </section>
      
      <section className="cta-section">
        <div className="container">
          <div className="cta-content">
            <h2 className="white-text" style={{ color: '#ffffff', fontWeight: 600, textShadow: '1px 1px 3px rgba(0,0,0,0.5)' }}>Ready to sell your car?</h2>
            <p className="white-text" style={{ color: '#ffffff', fontWeight: 500, textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>List your car with us and reach thousands of potential buyers.</p>
            <Link to="/post-car" className="btn btn-cta" style={{ boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }}>Sell Your Car</Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage; 