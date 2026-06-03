// flask-react-supabase-app/frontend/src/components/admin/AdminDealershipDetail.jsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const AdminDealershipDetail = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const refresh = React.useCallback(
    () => apiClient.get(`/api/admin/dealerships/${id}`).then(setData).catch(() => setData(null)),
    [id]
  );
  useEffect(() => { refresh(); }, [refresh]);
  if (!data) return <div>Loading…</div>;
  const d = data.dealership;

  const suspend = () => apiClient.post(`/api/admin/dealerships/${id}/suspend`, {}).then(refresh);
  const restore = () => apiClient.post(`/api/admin/dealerships/${id}/restore`, {}).then(refresh);

  return (
    <div>
      <h1>{d.name}</h1>
      <p>Status: <strong>{d.status}</strong></p>
      <Link to={`/dealer/dashboard?as=${id}`}>Open panel →</Link>
      <div style={{ marginTop: 12 }}>
        {d.status === 'active'
          ? <button onClick={suspend}>Suspend</button>
          : <button onClick={restore}>Restore</button>}
      </div>
      <h2>Members</h2>
      <table className="admin-table">
        <thead><tr><th>Email</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          {(d.members || []).map(m => (
            <tr key={m.id}>
              <td>{m.user?.email}</td>
              <td>{m.role}</td>
              <td>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><Link to={`/admin/dealerships/audit-log?dealership_id=${id}`}>Audit log for this dealership →</Link></p>
    </div>
  );
};

export default AdminDealershipDetail;
