// flask-react-supabase-app/frontend/src/components/admin/AdminDealerAuditLog.jsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const AdminDealerAuditLog = () => {
  const [params] = useSearchParams();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const q = params.get('dealership_id') ? `?dealership_id=${params.get('dealership_id')}` : '';
    apiClient.get(`/api/admin/dealer-audit-log${q}`).then(r => setRows(r.audit || []));
  }, [params]);
  return (
    <div>
      <h1>Dealer admin audit log</h1>
      <table className="admin-table">
        <thead><tr><th>Time</th><th>Admin</th><th>Dealership</th><th>Method</th><th>Endpoint</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.created_at?.replace('T', ' ').slice(0, 19)}</td>
              <td>{r.admin?.email}</td>
              <td>{r.dealership?.name}</td>
              <td>{r.http_method}</td>
              <td>{r.endpoint}</td>
              <td>{r.result_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminDealerAuditLog;
