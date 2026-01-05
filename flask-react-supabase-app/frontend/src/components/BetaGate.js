import React, { useState } from 'react';
import '../styles/BetaGate.css';

const BETA_PASSWORD = 'admin';

const BetaGate = ({ onUnlock }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (event) => {
    event.preventDefault();

    if (password.trim() === BETA_PASSWORD) {
      setError('');
      onUnlock();
      return;
    }

    setError('Incorrect password. Please try again.');
  };

  return (
    <div className="beta-gate">
      <div className="beta-gate__card">
        <h1 className="beta-gate__title">DPH Classifieds Beta</h1>
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
          />
          {error ? <p className="beta-gate__error">{error}</p> : null}
          <button className="beta-gate__button" type="submit">
            Enter site
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
