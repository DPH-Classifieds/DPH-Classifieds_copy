// flask-react-supabase-app/frontend/src/components/dealer/DealerListings.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const DealerListings = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get('/api/dealer/listings').then(setData).catch(() => setData({ listings: [] }));
  }, []);
  if (!data) return <div>Loading…</div>;
  return (
    <div>
      <h1>Listings</h1>
      <table className="admin-table">
        <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Views</th><th></th></tr></thead>
        <tbody>
          {data.listings.map(l => (
            <tr key={`${l.listing_type}-${l.id}`}>
              <td>{String(l.id).slice(0, 8)}</td>
              <td>{l.listing_type}</td>
              <td>{l.status}{l.sold_status ? ` · ${l.sold_status}` : ''}</td>
              <td>{l.view_count || 0}</td>
              <td>
                <Link to={`/dealer/listings/${l.listing_type}/${l.id}/analytics`}>Analytics</Link>
                {' · '}
                <Link to={`/dealer/listings/${l.listing_type}/${l.id}/diagnostic`}>Diagnostic</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DealerListings;
