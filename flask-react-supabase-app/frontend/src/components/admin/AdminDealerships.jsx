// flask-react-supabase-app/frontend/src/components/admin/AdminDealerships.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const AdminDealerships = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get('/api/admin/dealerships').then(setData).catch(() => setData({ dealerships: [] }));
  }, []);
  if (!data) return <div>Loading…</div>;
  return (
    <div>
      <h1>Dealerships</h1>
      <p className="admin-muted">Operational overview of approved dealerships. Click "Open panel" to act as one.</p>
      <table className="admin-table">
        <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {data.dealerships.map(d => (
            <tr key={d.id}>
              <td><Link to={`/admin/dealerships/${d.id}`}>{d.name}</Link></td>
              <td>{d.slug}</td>
              <td>{d.status}</td>
              <td>{d.created_at?.slice(0, 10)}</td>
              <td>
                <Link to={`/dealer/dashboard?as=${d.id}`}>Open panel</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 12 }}>
        <Link to="/admin/dealerships/audit-log">Audit log →</Link>
      </p>
    </div>
  );
};

export default AdminDealerships;
