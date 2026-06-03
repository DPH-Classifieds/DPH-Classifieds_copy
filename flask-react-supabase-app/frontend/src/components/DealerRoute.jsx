import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDealer } from '../context/DealerContext';
import LoadingSpinner from './LoadingSpinner';

const DealerRoute = ({ children }) => {
  const { user, isLoading: authLoading } = useAuth();
  const { dealership, loading, error, actorKind } = useDealer();
  const navigate = useNavigate();

  if (authLoading || loading) return <LoadingSpinner />;
  if (!user) {
    navigate('/login', { state: { from: window.location.pathname } });
    return null;
  }
  if (error || !dealership) {
    return (
      <div className="admin-surface" style={{ maxWidth: 640, margin: '40px auto' }}>
        <h2>Dealer panel unavailable</h2>
        <p>You're not a member of any dealership.{actorKind === 'admin' ? ' Append ?as=<dealership-id> to the URL.' : ''}</p>
        <p>{error}</p>
      </div>
    );
  }
  if (dealership.status === 'suspended' && actorKind !== 'admin') {
    return (
      <div className="admin-surface" style={{ maxWidth: 640, margin: '40px auto' }}>
        <h2>Dealership suspended</h2>
        <p>Please contact support to restore your access.</p>
      </div>
    );
  }
  return children;
};

export default DealerRoute;
