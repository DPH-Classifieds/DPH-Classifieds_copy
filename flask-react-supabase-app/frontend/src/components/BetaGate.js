import React, { useState } from 'react';
import '../styles/BetaGate.css';

const API_BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:8000').replace(/\/$/, '');

const BetaGate = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/beta-verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          password: password.trim()
        })
      });

      const data = await response.json();

      if (response.ok && data && data.success) {
        onUnlock();
      } else {
        setError('Incorrect password. Please try again.');
      }
    } catch (err) {
      setError('Incorrect password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="beta-gate">
      <div className="beta-gate__card">
        <h1 className="beta-gate__title"><span style={{ color: '#ffffff' }}>DPH</span> <span style={{ color: '#8bd6b4' }}>Classifieds</span> Beta</h1>
        <p className="beta-gate__subtitle">
          Limited access during deployment and testing.
        </p>
        <form className="beta-gate__form" onSubmit={handleSubmit}>
          <label className="beta-gate__label" htmlFor="beta-password">
            Beta password
          </label>
          <input
            id="beta-password"
            type="password"
            className="beta-gate__input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            autoFocus
            disabled={loading}
          />
          {error ? <p className="beta-gate__error">{error}</p> : null}
          <button className="beta-gate__button" type="submit" disabled={loading}>
            {loading ? 'Verifying...' : 'Enter site'}
          </button>
        </form>
        <p className="beta-gate__footnote">
          This gate is temporary and only for beta access.
        </p>
      </div>
    </div>
  );
};

export default BetaGate;
