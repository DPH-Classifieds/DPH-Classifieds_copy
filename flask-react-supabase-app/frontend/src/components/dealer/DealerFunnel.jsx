// flask-react-supabase-app/frontend/src/components/dealer/DealerFunnel.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';

const DealerFunnel = ({ window }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    apiClient.get(`/api/dealer/analytics/funnel?window=${window}`)
      .then(r => active && setData(r)).catch(() => active && setData(null));
    return () => { active = false; };
  }, [window]);
  if (!data) return null;
  const max = Math.max(1, ...data.steps.map(s => s.value));
  return (
    <div className="admin-surface">
      <div className="admin-label">Funnel</div>
      {data.steps.map((s, i) => {
        const prev = i > 0 ? data.steps[i - 1].value : null;
        const conv = prev ? Math.round((s.value / prev) * 1000) / 10 : null;
        return (
          <div key={s.label} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{s.label}</strong>
              <span>{s.value.toLocaleString()}{conv != null ? ` · ${conv}%` : ''}</span>
            </div>
            <div style={{ background: '#eef2ff', height: 10, borderRadius: 4 }}>
              <div style={{ width: `${(s.value / max) * 100}%`, height: '100%',
                background: '#6366f1', borderRadius: 4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DealerFunnel;
