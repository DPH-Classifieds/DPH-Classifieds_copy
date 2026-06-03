// flask-react-supabase-app/frontend/src/components/dealer/DealerListingMarket.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';

const DealerListingMarket = ({ listing_type, listing_id }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get(`/api/dealer/listings/${listing_type}/${listing_id}/market`)
      .then(setData).catch(() => setData(null));
  }, [listing_type, listing_id]);
  if (!data) return null;
  if (!data.snapshot) return <div className="admin-surface"><div className="admin-label">Market position</div>
    <p>Not enough comparable listings yet (n={data.comp_count}).</p></div>;
  const s = data.snapshot;
  return (
    <div className="admin-surface">
      <div className="admin-label">Market position</div>
      <p>Priced higher than <strong>{Math.round(s.percentile_rank * 100)}%</strong> of comparable listings.</p>
      <p>Fair price band: AED {Number(s.p25_price).toLocaleString()} – AED {Number(s.p75_price).toLocaleString()} · median AED {Number(s.median_price).toLocaleString()} (n={s.comp_count}).</p>
      {s.median_days_on_market != null && <p>Median days-on-market for sold comps: {s.median_days_on_market}</p>}
    </div>
  );
};

export default DealerListingMarket;
