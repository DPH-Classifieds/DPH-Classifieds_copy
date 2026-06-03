import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDealer } from '../context/DealerContext';

const ActingAsBanner = () => {
  const { dealership, actorKind } = useDealer();
  const navigate = useNavigate();
  if (actorKind !== 'admin' || !dealership) return null;
  return (
    <div style={{
      background: '#f97316', color: 'white', padding: '10px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 50, fontWeight: 600,
    }}>
      <span>Admin view — acting as <strong>{dealership.name}</strong>. Writes are audited.</span>
      <button
        onClick={() => navigate('/admin/dealerships')}
        style={{ background: 'white', color: '#f97316', border: 0, padding: '4px 12px',
                 borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
      >Exit</button>
    </div>
  );
};

export default ActingAsBanner;
