// flask-react-supabase-app/frontend/src/components/dealer/DealerTeam.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';

const DealerTeam = () => {
  const { role } = useDealer();
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('sales_rep');
  const [inviteToken, setInviteToken] = useState(null);

  const refresh = () => apiClient.get('/api/dealer/members').then(r => setMembers(r.members || []));
  useEffect(() => { refresh(); }, []);

  const invite = async () => {
    const r = await apiClient.post('/api/dealer/invitations', { email, role: inviteRole });
    setInviteToken(r.invitation?.token);
    setEmail('');
    refresh();
  };

  return (
    <div>
      <h1>Team</h1>
      <table className="admin-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id}>
              <td>{m.user?.first_name} {m.user?.last_name}</td>
              <td>{m.user?.email}</td>
              <td>{m.role}</td>
              <td>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {role === 'owner' && (
        <div style={{ marginTop: 20 }}>
          <h2>Invite a teammate</h2>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="sales_rep">Sales rep</option>
            <option value="manager">Manager</option>
          </select>
          <button onClick={invite}>Send invite</button>
          {inviteToken && (
            <div style={{ marginTop: 12 }}>
              <strong>Invite link:</strong> {window.location.origin}/dealer/invite/accept?token={inviteToken}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DealerTeam;
