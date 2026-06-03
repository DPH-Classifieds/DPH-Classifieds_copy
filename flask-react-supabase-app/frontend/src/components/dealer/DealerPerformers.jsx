// flask-react-supabase-app/frontend/src/components/dealer/DealerPerformers.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const Section = ({ title, rows, valueKey, link }) => (
  <div className="admin-surface">
    <div className="admin-label">{title}</div>
    {(!rows || rows.length === 0) ? <p className="admin-muted">No data yet</p> : (
      <ul>
        {rows.map(r => (
          <li key={`${r.listing_type}-${r.listing_id}`}>
            <Link to={link(r)}>{r.listing_type} · {r.listing_id.slice(0, 8)}</Link>
            <span style={{ float: 'right' }}>{r[valueKey]}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const DealerPerformers = ({ window }) => {
  const [top, setTop] = useState(null);
  const [under, setUnder] = useState(null);

  useEffect(() => {
    let active = true;
    apiClient.get(`/api/dealer/analytics/top-performers?window=${window}`)
      .then(r => active && setTop(r)).catch(() => {});
    apiClient.get(`/api/dealer/analytics/underperformers?window=${window}`)
      .then(r => active && setUnder(r)).catch(() => {});
    return () => { active = false; };
  }, [window]);

  const linkAnalytics = (r) => `/dealer/listings/${r.listing_type}/${r.listing_id}/analytics`;
  const linkDiag = (r) => `/dealer/listings/${r.listing_type}/${r.listing_id}/diagnostic`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
      <Section title="Top by impressions" rows={top?.top_by_impressions} valueKey="impressions" link={linkAnalytics} />
      <Section title="Top by conversion" rows={top?.top_by_conversion} valueKey="conv_pct" link={linkAnalytics} />
      <Section title="Worst by impressions" rows={under?.worst_by_impressions} valueKey="impressions" link={linkDiag} />
      <Section title="Views, no leads" rows={under?.views_no_leads} valueKey="impressions" link={linkDiag} />
    </div>
  );
};

export default DealerPerformers;
