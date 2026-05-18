import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

import './RequestCarModel.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const PRIMARY_ADMIN_EMAIL = 'admin@dphclassifieds.com';

const getQueryValue = (search, key) => new URLSearchParams(search).get(key) || '';

const RequestCarModel = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const initialValues = useMemo(
    () => ({
      name: user?.user_metadata?.full_name || user?.user_metadata?.name || '',
      email: user?.email || '',
      make: getQueryValue(location.search, 'make'),
      model: getQueryValue(location.search, 'model'),
      year: '',
      notes: '',
      source: getQueryValue(location.search, 'source') || 'post-car',
    }),
    [location.search, user]
  );

  const [formData, setFormData] = useState(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setSuccess('');
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/car-model-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
        credentials: 'include',
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to send request');
      }

      setSuccess('Request sent. We will review it and email you if we add the model.');
      setFormData((current) => ({
        ...current,
        model: '',
        year: '',
        notes: '',
      }));
      setTimeout(() => {
        navigate('/post-car');
      }, 1800);
    } catch (submissionError) {
      setError(submissionError.message || 'Failed to send request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="request-model-page">
      <div className="request-model-card">
        <div className="request-model-header">
          <span className="request-model-kicker">Model Request</span>
          <h1>Request a missing car model</h1>
          <p>
            If your model is not listed yet, send the details here and the team will review it at{' '}
            <a href={`mailto:${PRIMARY_ADMIN_EMAIL}`}>{PRIMARY_ADMIN_EMAIL}</a>.
          </p>
        </div>

        {success ? <div className="request-model-success">{success}</div> : null}
        {error ? <div className="request-model-error">{error}</div> : null}

        <form className="request-model-form" onSubmit={handleSubmit}>
          <div className="request-model-row">
            <label>
              Your Name
              <input name="name" value={formData.name} onChange={handleChange} placeholder="Full name" />
            </label>
            <label>
              Email
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com"
                required
              />
            </label>
          </div>

          <div className="request-model-row">
            <label>
              Make
              <input name="make" value={formData.make} onChange={handleChange} placeholder="Toyota" required />
            </label>
            <label>
              Model
              <input name="model" value={formData.model} onChange={handleChange} placeholder="Land Cruiser" required />
            </label>
          </div>

          <div className="request-model-row">
            <label>
              Year
              <input name="year" value={formData.year} onChange={handleChange} placeholder="2024" />
            </label>
            <label>
              Source
              <input name="source" value={formData.source} onChange={handleChange} />
            </label>
          </div>

          <label className="request-model-notes">
            Notes
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="5"
              placeholder="Anything else the admin should know"
            />
          </label>

          <div className="request-model-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send request'}
            </button>
            <Link to="/post-car">Back to listing form</Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RequestCarModel;
