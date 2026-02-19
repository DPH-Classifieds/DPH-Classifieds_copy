import React from 'react';
import { Link } from 'react-router-dom';
import CarList from './CarList';
import '../styles/HomePage.css';

const HomePage = () => {
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
          <p className="why-choose-subtitle">A car community in the middle-east with over 60,000 members.</p>
          <p className="why-choose-subtitle">For petrolheads by petrolheads.</p>
            
            <h3>Why Choose Us:</h3>
            
            <ul className="benefits-list">
              <li>
                <span className="checkmark">✓</span>
                <span>Petrolhead created, with a focus on details that matter</span>
              </li>
              <li>
                <span className="checkmark">✓</span>
                <span>Transparent ads</span>
              </li>
              <li>
                <span className="checkmark">✓</span>
                <span>No fees</span>
              </li>
              <li>
                <span className="checkmark">✓</span>
                <span>A community of over 25 million petrolhead viewers</span>
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
            <h2 className="white-text">Ready to sell your car?</h2>
            <p className="white-text">List your car with us and reach thousands of potential buyers.</p>
            <Link to="/post-car" className="btn btn-cta">Sell Your Car</Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HomePage; 
