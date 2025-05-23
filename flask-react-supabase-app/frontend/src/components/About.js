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
        <p className="welcome-description">We provide a platform for Buying and Selling used vehicles.</p>
      </div>

      {/* Info Sections */}
      <div className="info-sections">
        <div className="info-section">
          <div className="info-image">
            <img src={whoWeAreImg} alt="Car buying experience" />
          </div>
          <div className="info-content">
            <h2>Who <span>Are We</span></h2>
            <p>A platform that connects the buyer to the seller. A platform that helps people to get used vehicles hassle-free.</p>
          </div>
        </div>

        <div className="info-section reverse">
          <div className="info-image">
            <img src={ourMissionImg} alt="Car driving experience" />
          </div>
          <div className="info-content">
            <h2>Our <span>Mission</span></h2>
            <p>Our mission is to provide Used vehicles nearby in one place. So that the potential buyer does not need to hassle between dealers.</p>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="stats-section">
        <div className="stat-card">
          <div className="stat-icon">
            <i className="fas fa-calendar-alt"></i>
          </div>
          <div className="stat-number">14+</div>
          <div className="stat-label">Years In Business</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">
            <i className="fas fa-car"></i>
          </div>
          <div className="stat-number">1000+</div>
          <div className="stat-label">Cars Deal Completed</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">
            <i className="fas fa-car-alt"></i>
          </div>
          <div className="stat-number">1000+</div>
          <div className="stat-label">Used Cars For Sale</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">
            <i className="fas fa-users"></i>
          </div>
          <div className="stat-number">600+</div>
          <div className="stat-label">Satisfied Customers</div>
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
