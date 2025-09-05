import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/Auth.css';

const Login = () => {
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { signIn, syncWithSupabase } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    // Basic validation
    if (!emailOrUsername.trim()) {
      setError('Email or username is required');
      setLoading(false);
      return;
    }
    
    if (!password) {
      setError('Password is required');
      setLoading(false);
      return;
    }
    
    try {
      console.log('Attempting to sign in with:', emailOrUsername);
      const result = await signIn(emailOrUsername, password);
      console.log('Login successful, syncing with Supabase');
      
      // Force sync to ensure we have the token
      await syncWithSupabase();
      
      // Store the user info and token in localStorage as an additional backup
      if (result && result.data && result.data.session) {
        console.log('Storing session and token in localStorage');
        localStorage.setItem('supabase_access_token', result.data.session.access_token);
        localStorage.setItem('user_identifier', emailOrUsername);
      }
      
      console.log('Login and sync successful, navigating to profile');
      navigate('/profile');
    } catch (err) {
      console.error('Login error:', err);
      // More descriptive error message for the user
      if (err.message && err.message.includes('Invalid login')) {
        setError('Invalid email or password. Please try again.');
      } else if (err.message && err.message.includes('network')) {
        setError('Network error. Please check your connection and try again.');
      } else {
        setError(err.message || 'Failed to sign in. Please check your credentials and try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">Log In</h1>
        
        {error && <div className="auth-error">{error}</div>}
        
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="emailOrUsername">Email or Username</label>
            <input
              type="text"
              id="emailOrUsername"
              value={emailOrUsername}
              onChange={(e) => setEmailOrUsername(e.target.value)}
              placeholder="Enter your email or username"
              required
              autoComplete="username"
            />
          </div>
          
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          
          <button 
            type="submit" 
            className="auth-button primary-button"
            disabled={loading}
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>
        
        <div className="auth-links">
          <Link to="/forgot-password" className="auth-link">
            Forgot Password?
          </Link>
          <span className="auth-divider">•</span>
          <Link to="/signup" className="auth-link">
            Create Account
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login; 