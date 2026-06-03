// flask-react-supabase-app/frontend/src/components/dealer/DealerListingDiagnostic.jsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const VERDICT_LABELS = {
  not_enough_data: { label: 'Not enough data yet', tone: '#64748b' },
  underperforming_visibility: { label: 'Underperforming on visibility', tone: '#dc2626' },
  visibility_ok_not_converting: { label: 'Visibility OK, not converting', tone: '#ea580c' },
  performing_par: { label: 'On par with the market', tone: '#0891b2' },
  top_performer: { label: 'Top performer', tone: '#16a34a' },
};

const DealerListingDiagnostic = () => {
  const { listing_type, listing_id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    apiClient.get(`/api/dealer/listings/${listing_type}/${listing_id}/diagnostic`)
      .then(setData).catch(() => setData(null));
  }, [listing_type, listing_id]);

  if (!data) return <div>Loading…</div>;
  const v = VERDICT_LABELS[data.verdict] || { label: data.verdict, tone: '#64748b' };

  return (
    <div>
      <h1>Why isn't this listing selling?</h1>
      <Link to={`/dealer/listings/${listing_type}/${listing_id}/analytics`}>Back to analytics</Link>
      <div style={{ background: v.tone, color: 'white', padding: '12px 16px', borderRadius: 6,
                    marginTop: 12, fontWeight: 600 }}>{v.label}</div>
      <ol>
        {data.findings.map(f => (
          <li key={f.code} style={{ margin: '12px 0' }}>
            <strong>{f.problem}</strong>
            <div className="admin-muted">{f.evidence}</div>
            <div>→ {f.action}</div>
          </li>
        ))}
        {data.findings.length === 0 && <li>No issues detected — keep going.</li>}
      </ol>
    </div>
  );
};

export default DealerListingDiagnostic;
