// flask-react-supabase-app/frontend/src/components/dealer/DealerTrends.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';

const SimpleLine = ({ data, accessor, color, label }) => {
  if (!data?.length) return <div className="admin-muted">No data</div>;
  const vals = data.map(d => Number(accessor(d) || 0));
  const max = Math.max(1, ...vals);
  const w = 600, h = 120, pad = 20;
  const stepX = (w - pad * 2) / Math.max(1, data.length - 1);
  const pts = vals.map((v, i) => `${pad + i * stepX},${h - pad - (v / max) * (h - pad * 2)}`).join(' ');
  return (
    <div>
      <div className="admin-label">{label}</div>
      <svg width={w} height={h} style={{ display: 'block', width: '100%' }}>
        <polyline fill="none" stroke={color} strokeWidth={2} points={pts} />
      </svg>
    </div>
  );
};

const DealerTrends = ({ window }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    apiClient.get(`/api/dealer/analytics/trends?window=${window}`)
      .then(r => active && setData(r)).catch(() => active && setData(null));
    return () => { active = false; };
  }, [window]);

  if (!data) return <div className="admin-muted">Loading…</div>;
  return (
    <div className="admin-surface">
      <SimpleLine data={data.daily} accessor={d => d.impressions} color="#2563eb" label="Impressions per day" />
      <SimpleLine data={data.daily} accessor={d => d.leads} color="#16a34a" label="Leads per day" />
      <div className="admin-label" style={{ marginTop: 16 }}>Leads by source</div>
      <ul>
        {Object.entries(data.leads_by_source || {}).map(([k, v]) => (
          <li key={k}><strong>{k}:</strong> {v}</li>
        ))}
      </ul>
    </div>
  );
};

export default DealerTrends;
