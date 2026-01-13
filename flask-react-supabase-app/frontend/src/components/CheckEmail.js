import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../styles/Auth.css';

const CheckEmail = () => {
  const location = useLocation();
  const email = location.state?.email;

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Almost ready!</h1>
        <p className="auth-subtitle">Please check your inbox to confirm your email.</p>
        {email && (
          <p className="auth-note">We sent the confirmation link to <strong>{email}</strong>.</p>
        )}
        <p className="auth-note">
          If you do not see the message, check your spam folder or try resending the confirmation from the login page.
        </p>
        <Link to="/login" className="auth-button primary-button">
          Go back to login
        </Link>
      </div>
    </div>
  );
};

export default CheckEmail;
