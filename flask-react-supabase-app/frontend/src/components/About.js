import React from 'react';
import '../styles/About.css';
import whoWeAreImg from '../assets/images/whoweare.jpg';
import ourMissionImg from '../assets/images/ourmission.jpg';
import redditImg from '../assets/images/Reddit.jpg';
import instagramImg from '../assets/images/Instagram.jpg';
import websiteImg from '../assets/images/Website.jpg';

const About = () => {
  return (
    <div className="about-container">
      {/* Welcome Section */}
      <div className="welcome-section">
        <h1>Welcome to DPH Classifieds</h1>
        <p className="welcome-description">We provide a transparent and hassle-free platform for buying and selling vehicles.</p>
      </div>

      {/* Info Sections */}
      <div className="info-sections">
        <div className="info-section">
          <div className="info-image">
            <img src={whoWeAreImg} alt="Car buying experience" />
          </div>
          <div className="info-content">
            <h2>Who <span>Are We?</span></h2>
            <p>DubaiPetrolHeads is the largest car community in the middle-east with over 60,000 active petrolheads. We have created a classifieds page by Petrol Heads for Petrol Heads in order to create and view hassle-free and transparent listings.</p>
          </div>
        </div>

        <div className="info-section reverse">
          <div className="info-image">
            <img src={ourMissionImg} alt="Car driving experience" />
          </div>
          <div className="info-content">
            <h2>Our <span>Mission</span></h2>
            <p>To ensure every listing in the country is transparent and buyers have full knowledge about the vehicle before purchasing. We want to make sure the service is completely transparent and there are no hidden defects on the vehicles. We want to also make it easy to sell a car online by guiding sellers to the right customer base.</p>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="stats-section">
        <div className="stat-card">
          <div className="stat-icon">
            <i className="fas fa-calendar-alt"></i>
          </div>
          <div className="stat-number">5</div>
          <div className="stat-label">Years Online</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">
            <i className="fas fa-car"></i>
          </div>
          <div className="stat-number">1000+</div>
          <div className="stat-label">Ads Listed</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">
            <i className="fas fa-eye"></i>
          </div>
          <div className="stat-number">25,000,000</div>
          <div className="stat-label">Annual Viewers</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">
            <i className="fas fa-users"></i>
          </div>
          <div className="stat-number">100s</div>
          <div className="stat-label">Happy Buyers and Sellers</div>
        </div>
      </div>

      {/* Community Section */}
      <div className="community-section">
        <h2 className="community-title">Our <span>Community</span></h2>
        
        <div className="community-platforms">
          <div className="platform-card">
            <div className="platform-image">
              <img src={redditImg} alt="Reddit Community" />
            </div>
            <h3>Our Reddit</h3>
          </div>
          
          <div className="platform-card">
            <div className="platform-image">
              <img src={instagramImg} alt="Instagram Community" />
            </div>
            <h3>Our Instagram</h3>
          </div>
          
          <div className="platform-card">
            <div className="platform-image">
              <img src={websiteImg} alt="Community Website" />
            </div>
            <h3>Our Community Website</h3>
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;
