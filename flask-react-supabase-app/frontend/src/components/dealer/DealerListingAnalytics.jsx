// flask-react-supabase-app/frontend/src/components/dealer/DealerListingAnalytics.jsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';
import DealerListingMarket from './DealerListingMarket';

const DealerListingAnalytics = () => {
  const { listing_type, listing_id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    apiClient.get(`/api/dealer/listings/${listing_type}/${listing_id}/analytics`)
      .then(setData).catch(() => setData(null));
  }, [listing_type, listing_id]);

  if (!data) return <div>Loading…</div>;
  const t = data.tiles;
  return (
    <div>
      <h1>Listing analytics</h1>
      <Link to={`/dealer/listings/${listing_type}/${listing_id}/diagnostic`}>Open diagnostic →</Link>
      <div className="admin-kpi-grid">
        {Object.entries(t).map(([k, v]) => (
          <div className="admin-kpi-card" key={k}>
            <div className="admin-kpi-label">{k.replaceAll('_', ' ')}</div>
            <div className="admin-kpi-value">{typeof v === 'number' ? v.toLocaleString() : v}</div>
          </div>
        ))}
      </div>
      <h2>Time series</h2>
      <pre style={{ maxHeight: 240, overflow: 'auto' }}>{JSON.stringify(data.series, null, 2)}</pre>
      <DealerListingMarket listing_type={listing_type} listing_id={listing_id} />
    </div>
  );
};

export default DealerListingAnalytics;
