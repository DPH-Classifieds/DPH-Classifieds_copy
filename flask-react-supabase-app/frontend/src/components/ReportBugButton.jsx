import React, { useState } from 'react';
import SearchableSelect from './ui/searchable-select';
import axios from 'axios';
import { getAccessToken } from '../utils/authService';
import '../styles/ReportButton.css';
import '../styles/shell-tokens.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const ReportBugButton = ({ className = '', buttonText = 'Report a Bug' }) => {
  const [showModal, setShowModal] = useState(false);
  const [issueType, setIssueType] = useState('ui');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);

  const issueTypes = [
    { value: 'ui', label: 'UI / Layout' },
    { value: 'data', label: 'Incorrect Data' },
    { value: 'performance', label: 'Performance' },
    { value: 'crash', label: 'Crash / Error' },
    { value: 'other', label: 'Other' }
  ];

  const handleSubmitReport = async (e) => {
    e.preventDefault();

    if (!description.trim()) {
      setError('Please describe the issue.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getAccessToken();

      if (!token) {
        setError('You must be logged in to report a bug.');
        setSubmitting(false);
        return;
      }

      const pagePath = window.location?.pathname || 'site';
      const userAgent = navigator?.userAgent || 'unknown';
      const details = [
        `Issue type: ${issueType}`,
        `Page: ${pagePath}`,
        `Description: ${description.trim()}`,
        steps.trim() ? `Steps to reproduce: ${steps.trim()}` : null,
        `User agent: ${userAgent}`
      ].filter(Boolean).join('\n');

      const reportData = {
        listing_id: pagePath || 'site',
        listing_type: 'bug',
        reason: 'bug',
        details
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
        setIssueType('ui');
        setDescription('');
        setSteps('');
      }, 2000);
    } catch (err) {
      console.error('Error submitting bug report:', err);
      setError(err.response?.data?.error || 'Failed to submit bug report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        className={className}
        onClick={() => setShowModal(true)}
        type="button"
      >
        {buttonText}
      </button>

      {showModal && (
        <div className="report-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="report-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="report-modal-header">
              <h3>Report a Bug</h3>
              <button
                className="report-modal-close"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>

            {success ? (
              <div className="report-success-message">
                <p>Report submitted successfully. Thank you for helping us improve the site.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmitReport} className="report-form">
                <div className="report-form-group">
                  <label htmlFor="issue-type">Issue Type</label>
                  <SearchableSelect
                    id="issue-type"
                    value={issueType}
                    onChange={(e) => setIssueType(e.target.value)}
                    required
                  >
                    {issueTypes.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </SearchableSelect>
                </div>

                <div className="report-form-group">
                  <label htmlFor="bug-description">Description *</label>
                  <textarea
                    id="bug-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What went wrong?"
                    rows="4"
                    maxLength="1000"
                    required
                  />
                  <small className="char-count">{description.length}/1000</small>
                </div>

                <div className="report-form-group">
                  <label htmlFor="bug-steps">Steps to Reproduce (Optional)</label>
                  <textarea
                    id="bug-steps"
                    value={steps}
                    onChange={(e) => setSteps(e.target.value)}
                    placeholder="How can we reproduce this issue?"
                    rows="3"
                    maxLength="1000"
                  />
                  <small className="char-count">{steps.length}/1000</small>
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
                    disabled={submitting}
                  >
                    {submitting ? 'Submitting...' : 'Submit Bug Report'}
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

export default ReportBugButton;
