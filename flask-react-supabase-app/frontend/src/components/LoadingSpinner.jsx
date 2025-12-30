import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ message = 'Loading...', size = 'medium', compact = false, inline = false }) => {
  const containerClasses = ['dph-loading-spinner-container'];
  if (compact) {
    containerClasses.push('compact');
  }
  if (inline) {
    containerClasses.push('inline');
  }

  return (
    <div className={containerClasses.join(' ')}>
      <div className={`dph-loading-spinner ${size}`}>
        <div className="dph-spinner-ring">
          <div></div>
          <div></div>
          <div></div>
          <div></div>
        </div>
      </div>
      {message && <p className="dph-loading-message">{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
