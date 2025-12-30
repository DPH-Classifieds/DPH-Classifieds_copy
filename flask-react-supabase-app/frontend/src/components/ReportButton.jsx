import React, { useState } from 'react';
import axios from 'axios';
import { getAccessToken } from '../utils/authService';
import '../styles/ReportButton.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const ReportButton = ({ listingId, listingType }) => {
  const [showModal, setShowModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const reportReasons = [
    { value: 'spam', label: 'Spam or Misleading' },
    { value: 'fraud', label: 'Fraudulent Listing' },
    { value: 'inappropriate', label: 'Inappropriate Content' },
    { value: 'wrong_category', label: 'Wrong Category' },
    { value: 'duplicate', label: 'Duplicate Listing' },
    { value: 'sold', label: 'Already Sold' },
    { value: 'incorrect_info', label: 'Incorrect Information' },
    { value: 'other', label: 'Other' }
  ];

  const handleSubmitReport = async (e) => {
    e.preventDefault();
    
    if (!selectedReason) {
      setError('Please select a reason for reporting');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getAccessToken();
      
      if (!token) {
        setError('You must be logged in to report a listing');
        setSubmitting(false);
        return;
      }

      const reportData = {
        listing_id: listingId,
        listing_type: listingType,
        reason: selectedReason,
        details: additionalDetails
      };

      await axios.post(`${API_URL}/api/reports`, reportData, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      setSuccess(true);
      setTimeout(() => {
        setShowModal(false);
        setSuccess(false);
        setSelectedReason('');
        setAdditionalDetails('');
      }, 2000);

    } catch (err) {
      console.error('Error submitting report:', err);
      setError(err.response?.data?.error || 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button 
        className="report-button"
        onClick={() => setShowModal(true)}
        title="Report this listing"
      >
        <span className="report-icon" aria-hidden="true"></span> Report
      </button>

      {showModal && (
        <div className="report-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="report-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="report-modal-header">
              <h3>Report Listing</h3>
              <button 
                className="report-modal-close" 
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>

            {success ? (
              <div className="report-success-message">
                <p>✓ Report submitted successfully. Thank you for helping us maintain quality listings.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitReport} className="report-form">
                <div className="report-form-group">
                  <label>Reason for reporting *</label>
                  <div className="report-reasons">
                    {reportReasons.map((reason) => (
                      <label key={reason.value} className="report-reason-option">
                        <input
                          type="radio"
                          name="reason"
                          value={reason.value}
                          checked={selectedReason === reason.value}
                          onChange={(e) => setSelectedReason(e.target.value)}
                          required
                        />
                        <span>{reason.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="report-form-group">
                  <label htmlFor="report-details">
                    Additional Details (Optional)
                  </label>
                  <textarea
                    id="report-details"
                    value={additionalDetails}
                    onChange={(e) => setAdditionalDetails(e.target.value)}
                    placeholder="Please provide any additional information that might help us review this report..."
                    rows="4"
                    maxLength="500"
                  />
                  <small className="char-count">{additionalDetails.length}/500</small>
                </div>

                {error && (
                  <div className="report-error-message">
                    {error}
                  </div>
                )}

                <div className="report-modal-actions">
                  <button 
                    type="button" 
                    className="report-cancel-btn"
                    onClick={() => setShowModal(false)}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="report-submit-btn"
                    disabled={submitting || !selectedReason}
                  >
                    {submitting ? 'Submitting...' : 'Submit Report'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ReportButton;
