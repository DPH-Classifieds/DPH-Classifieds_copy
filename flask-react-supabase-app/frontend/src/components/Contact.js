import React, { useState } from 'react';
import SeoMeta from './SeoMeta';
import { buildStaticSeo } from '../utils/seo';
import '../styles/Contact.css';
import '../styles/shell-tokens.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const contactChannels = [
  {
    title: 'Support',
    lines: ['support@dphclassifieds.com', 'Fastest route for account and listing help.'],
    iconClass: 'email-icon',
  },
  {
    title: 'Based In',
    lines: ['Dubai, UAE', 'Serving the wider UAE petrolhead marketplace.'],
    iconClass: 'location-icon',
  },
  {
    title: 'Community',
    lines: ['Reddit, Instagram, and DubaiPetrolHeads.ae', 'Use the channels below for broader community touchpoints.'],
    iconClass: 'hours-icon',
  },
  {
    title: 'Company',
    lines: ['DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES', 'Marketplace operator and support team.'],
    iconClass: 'phone-icon',
  },
];

const Contact = () => {
  const seoData = buildStaticSeo({
    title: 'Contact DPH Classifieds',
    description:
      'Contact the DPH Classifieds team for support, partnerships, and marketplace help across the UAE.',
    path: '/contact',
    keywords: ['contact DPH Classifieds', 'support UAE marketplace', 'Dubai classifieds support'],
  });

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevData => ({
      ...prevData,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitStatus(null);

    try {
      const response = await fetch(`${API_URL}/api/contact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to send message');
      }

      setSubmitStatus({
        success: true,
        message: 'Your message has been sent successfully! We\'ll get back to you soon.'
      });

      setFormData({
        name: '',
        email: '',
        subject: '',
        message: ''
      });
    } catch (error) {
      setSubmitStatus({
        success: false,
        message: error.message || 'Failed to send message. Please try again.'
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SeoMeta {...seoData} />
      <div className="contact-container">
      <div className="contact-header">
        <h1 className="contact-title">Contact Us</h1>
        <p className="contact-subtitle">
          Reach the DPH Classifieds team for support, marketplace issues, partnerships, or general feedback.
        </p>
      </div>

      <div className="contact-content">
        <div className="contact-info">
          {contactChannels.map((channel) => (
            <div className="contact-info-section" key={channel.title}>
              <div className={`contact-icon ${channel.iconClass}`}></div>
              <div className="contact-info-details">
                <h3>{channel.title}</h3>
                {channel.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          ))}

          <div className="contact-info-section contact-link-section">
            <div className="contact-info-details">
              <h3>Community Links</h3>
              <div className="contact-link-list">
                <a href="https://www.reddit.com/r/DubaiPetrolHeads/" target="_blank" rel="noopener noreferrer">Reddit</a>
                <a href="https://www.instagram.com/dubaipetrolheads?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==" target="_blank" rel="noopener noreferrer">Instagram</a>
                <a href="https://www.dubaipetrolheads.ae/" target="_blank" rel="noopener noreferrer">DubaiPetrolHeads.ae</a>
              </div>
            </div>
          </div>
        </div>

        <div className="contact-form-container">
          <h2>Send Us a Message</h2>
          
          {submitStatus && (
            <div className={`submit-status ${submitStatus.success ? 'success' : 'error'}`}>
              {submitStatus.message}
            </div>
          )}
          
          <form className="contact-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="name">Your Name</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="email">Your Email</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="subject">Subject</label>
              <input
                type="text"
                id="subject"
                name="subject"
                value={formData.subject}
                onChange={handleChange}
                required
                disabled={submitting}
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="message">Message</label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                rows="5"
                required
                disabled={submitting}
              ></textarea>
            </div>
            
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        </div>
      </div>
      </div>
    </>
  );
};

export default Contact; 
