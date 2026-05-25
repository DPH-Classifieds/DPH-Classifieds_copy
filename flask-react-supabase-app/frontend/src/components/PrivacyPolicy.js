import React from 'react';
import SeoMeta from './SeoMeta';
import { buildStaticSeo } from '../utils/seo';
import '../styles/About.css';

const PrivacyPolicy = () => {
  const seoData = buildStaticSeo({
    title: 'Privacy Policy',
    description:
      'Read how DPH Classifieds collects, uses, stores, and protects user data across the platform.',
    path: '/privacy-policy',
    keywords: ['privacy policy', 'DPH Classifieds privacy', 'UAE marketplace privacy'],
  });

  return (
    <>
      <SeoMeta {...seoData} />
      <div className="about-v2 legal-v2">
      <section className="about-v2-hero">
        <div className="about-v2-shell">
          <span className="about-v2-kicker">Legal</span>
          <h1>Privacy Policy – DPH Classifieds</h1>
          <p>Effective Date: 25 May 2026</p>
        </div>
      </section>

      <section className="legal-v2-section">
        <div className="about-v2-shell legal-v2-body">
        <p>At DPH Classifieds, operated by DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES ("DPH," "we," "our," or "us"), your privacy is a top priority. This Privacy Policy explains how we collect, use, store, and share your personal information when you use our website, mobile app, and related services (collectively, the "Platform"). It also outlines your privacy rights and how the law protects you.</p>
        
        <p>By using DPH Classifieds, you agree to the terms described in this Privacy Policy. If you do not agree, please discontinue use of our services immediately.</p>
        
        <h2>1. Scope of This Privacy Policy</h2>
        <p>This Privacy Policy applies to all information collected through:</p>
        <ul>
          <li>Our website and mobile application</li>
          <li>Communications via our chat, email, or call features</li>
          <li>Third-party integrations connected to our Platform</li>
        </ul>
        <p>It does not cover third-party websites or services linked to from DPH Classifieds. We encourage you to review the privacy practices of those external services separately.</p>
        
        <h2>2. Who We Are & How to Contact Us</h2>
        <ul>
          <li>Company Name: DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES</li>
          <li>Registered Address: Dubai, United Arab Emirates</li>
          <li>Email: privacy@dphclassifieds.com</li>
        </ul>
        <p>We are the data controller responsible for handling your personal data when you use our Platform.</p>
        
        <h2>3. Information We Collect</h2>
        <p>We collect personal and non-personal data to provide you with a secure, seamless, and customized experience.</p>
        
        <table>
          <thead>
            <tr>
              <th>Type of Data</th>
              <th>Examples</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Identity Data</td>
              <td>Name, username, profile photo, and any identity verification documents you provide.</td>
            </tr>
            <tr>
              <td>Contact Data</td>
              <td>Email address, phone number.</td>
            </tr>
            <tr>
              <td>Location Data</td>
              <td>Approximate location if you enable location services.</td>
            </tr>
            <tr>
              <td>Listing Data</td>
              <td>Ads you create, vehicles or services you view, offers you make, and purchase history.</td>
            </tr>
            <tr>
              <td>Chat & Call Data</td>
              <td>Messages exchanged with other users and customer support; calls may be recorded for quality and training purposes.</td>
            </tr>
            <tr>
              <td>Technical Data</td>
              <td>IP address, device type, browser type, operating system, and login data.</td>
            </tr>
            <tr>
              <td>Behavioral Data</td>
              <td>Information inferred about your preferences and browsing habits on the Platform.</td>
            </tr>
            <tr>
              <td>Marketing Preferences</td>
              <td>Data about how you engage with promotions, newsletters, and notifications.</td>
            </tr>
          </tbody>
        </table>
        
        <p>We do not intentionally collect sensitive personal data (e.g., racial or ethnic origin, political beliefs, health data). If you choose to share such data voluntarily, you consent to its processing under this policy.</p>
        
        <h2>4. How We Collect Information</h2>
        <p>We gather data through:</p>
        <ul>
          <li><strong>Directly from you</strong> – when you create an account, post a listing, or communicate with others on the Platform.</li>
          <li><strong>Automatically</strong> – through cookies, analytics tools, and tracking technologies when you interact with our services.</li>
          <li><strong>Third-party sources</strong> – including:
            <ul>
              <li>Social media accounts (if you link them to DPH Classifieds)</li>
              <li>Analytics providers</li>
              <li>Advertising partners</li>
            </ul>
          </li>
        </ul>
        
        <h2>5. Why We Use Your Data</h2>
        <p>We process your data for the following purposes:</p>
        
        <table>
          <thead>
            <tr>
              <th>Purpose</th>
              <th>Legal Basis</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Account registration and management</td>
              <td>Contractual necessity</td>
            </tr>
            <tr>
              <td>Verify user identity and prevent fraud</td>
              <td>Compliance with law</td>
            </tr>
            <tr>
              <td>Enable buying, selling, and messaging features</td>
              <td>Contractual necessity</td>
            </tr>
            <tr>
              <td>Provide customer support and resolve disputes</td>
              <td>Contractual necessity</td>
            </tr>
            <tr>
              <td>Improve our services via analytics</td>
              <td>Legitimate interest</td>
            </tr>
            <tr>
              <td>Send marketing communications (if opted-in)</td>
              <td>Consent</td>
            </tr>
            <tr>
              <td>Ensure Platform security and prevent scams</td>
              <td>Compliance with law</td>
            </tr>
            <tr>
              <td>Display and moderate user listings</td>
              <td>Contractual necessity and legitimate interest</td>
            </tr>
          </tbody>
        </table>

        <h2>6. User Listings and Uploaded Images</h2>
        <p>When you upload listing content, including car photos, videos, descriptions, and related media, we process that content so we can host it, display it on the Platform, moderate it, improve our services, advertise the Platform, train and test our systems, and prevent abuse or fraud. Listing media and other listing content may be visible to other users and may be stored in our systems, caches, logs, backups, or archives for operational, legal, security, evidentiary, product, analytics, or commercial purposes.</p>
        <p>Your rights and responsibilities for uploaded content are also described in our Terms of Use. If you submit a listing, you acknowledge that the listing content you provide may be used, repurposed, and retained as part of operating, promoting, commercialising, and improving the Platform, subject to those Terms and applicable law.</p>
        
        <h2>7. Sharing Your Data</h2>
        <p>We only share your personal data with trusted parties when necessary:</p>
        
        <table>
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Reason for Sharing</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Other Users</td>
              <td>To facilitate transactions, your username, profile photo, and listing details will be visible to other users.</td>
            </tr>
            <tr>
              <td>Service Providers</td>
              <td>For services such as payment processing, cloud hosting, and marketing.</td>
            </tr>
            <tr>
              <td>Legal Authorities</td>
              <td>If required by law, such as for fraud investigations or government requests.</td>
            </tr>
            <tr>
              <td>Business Transfers</td>
              <td>In the event of a merger, acquisition, or asset sale.</td>
            </tr>
          </tbody>
        </table>
        
        <p>We never sell your personal data to third parties.</p>
        
        <h2>8. International Data Transfers</h2>
        <p>Your data may be transferred and stored outside your country of residence, including in countries that may have different data protection laws. We take steps to ensure appropriate safeguards are in place to protect your information.</p>
        
        <h2>9. Data Security</h2>
        <p>We use strict technical and organizational measures to protect your data, including:</p>
        <ul>
          <li>Encrypted data storage and transmission</li>
          <li>Restricted access to sensitive data</li>
          <li>Continuous monitoring for suspicious activity</li>
        </ul>
        <p>Despite our efforts, no system is completely secure. You are responsible for safeguarding your account credentials.</p>
        
        <h2>10. Data Retention</h2>
        <p>We only keep your personal data for as long as necessary to:</p>
        <ul>
          <li>Fulfill the purposes outlined in this Privacy Policy</li>
          <li>Comply with legal obligations</li>
          <li>Resolve disputes and enforce agreements</li>
        </ul>
        <p>Marketplace listings are normally displayed for 30 days from publication. If a seller extends a listing, the live period is refreshed. Once a listing expires, we may retain it in the seller dashboard for up to 30 additional days so the seller can review, extend, or delete it before permanent removal.</p>
        <p>If data is anonymized, we may retain it indefinitely for analytical purposes.</p>
        
        <h2>11. Your Privacy Rights</h2>
        <p>Depending on your location, you may have the following rights:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of the data we hold about you.</li>
          <li><strong>Correction:</strong> Update or correct inaccurate information.</li>
          <li><strong>Deletion:</strong> Request that we delete your data when no longer necessary.</li>
          <li><strong>Objection:</strong> Opt-out of certain processing activities, like marketing.</li>
          <li><strong>Portability:</strong> Request transfer of your data to another provider.</li>
          <li><strong>Withdraw Consent:</strong> Stop us from using data where consent was previously given.</li>
        </ul>
        <p>To exercise these rights, email privacy@dphclassifieds.com.</p>
        
        <h2>12. Marketing Preferences</h2>
        <p>You can manage marketing communications by:</p>
        <ul>
          <li>Adjusting notification settings in your account.</li>
          <li>Clicking the "unsubscribe" link in our emails.</li>
        </ul>
        
        <h2>13. Use by Minors</h2>
        <p>DPH Classifieds is not intended for users under 18 years old. If we discover that we have inadvertently collected data from a minor, we will delete it immediately.</p>
        
        <h2>14. Third-Party Links</h2>
        <p>Our Platform may link to external websites or apps. We are not responsible for the privacy practices of these third-party services. Always review their privacy policies before sharing personal information.</p>
        
        <h2>15. Changes to This Privacy Policy</h2>
        <p>We may update this Privacy Policy periodically. Changes will be posted on this page, with the updated effective date. In certain cases, we may notify you via email or in-app notifications.</p>
        
        <h2>16. Contact Information</h2>
        <p>For questions or concerns about this Privacy Policy or your data, please contact:</p>
        <ul>
          <li>Email: privacy@dphclassifieds.com</li>
          <li>Address: Dubai, UAE</li>
        </ul>
        
        <h2>Summary</h2>
        <p>DPH Classifieds, operated by DUBAIPETROLHEADS FOR INFORMATION TECHNOLOGY AND NETWORK SERVICES, is committed to protecting your privacy and maintaining transparency about how we handle your data. Your trust is important to us, and we strive to provide a safe and secure environment for buying and selling cars online.</p>
        </div>
      </section>
      </div>
    </>
  );
};

export default PrivacyPolicy;
