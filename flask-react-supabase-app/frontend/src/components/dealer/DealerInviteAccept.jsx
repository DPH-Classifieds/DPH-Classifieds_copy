// flask-react-supabase-app/frontend/src/components/dealer/DealerInviteAccept.jsx
import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const DealerInviteAccept = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [msg, setMsg] = useState('');
  const token = params.get('token');
  const accept = async () => {
    try {
      await apiClient.post('/api/dealer/invitations/accept', { token });
      setMsg('Accepted. Redirecting…');
      setTimeout(() => navigate('/dealer/dashboard'), 1000);
    } catch (e) {
      setMsg('Failed: ' + (e.message || ''));
    }
  };
  return (
    <div style={{ maxWidth: 480, margin: '40px auto' }}>
      <h1>Accept dealership invitation</h1>
      {!token && <p>Missing invitation token in URL.</p>}
      {token && <button onClick={accept}>Accept</button>}
      {msg && <p>{msg}</p>}
    </div>
  );
};

export default DealerInviteAccept;
