// flask-react-supabase-app/frontend/src/components/dealer/DealerKpiTiles.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';

const fmt = (n) => Number(n || 0).toLocaleString();
const fmtPct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n}%`;

const Tile = ({ label, value, delta }) => (
  <div className="admin-kpi-card">
    <div className="admin-kpi-label">{label}</div>
    <div className="admin-kpi-value">{value}</div>
    {delta != null && <div className="admin-kpi-note">{fmtPct(delta)} vs prior</div>}
  </div>
);

const DealerKpiTiles = ({ window }) => {
  const [tiles, setTiles] = useState(null);

  useEffect(() => {
    let active = true;
    apiClient.get(`/api/dealer/analytics/kpis?window=${window}`)
      .then(r => active && setTiles(r.tiles))
      .catch(() => active && setTiles(null));
    return () => { active = false; };
  }, [window]);

  if (!tiles) return <div className="admin-muted">Loading…</div>;

  return (
    <div className="admin-kpi-grid">
      <Tile label="Active listings" value={fmt(tiles.active_listings.value)} delta={tiles.active_listings.delta_pct} />
      <Tile label="Impressions" value={fmt(tiles.impressions.value)} delta={tiles.impressions.delta_pct} />
      <Tile label="Detail views" value={fmt(tiles.detail_views.value)} delta={tiles.detail_views.delta_pct} />
      <Tile label="Leads" value={fmt(tiles.leads.value)} delta={tiles.leads.delta_pct} />
      <Tile label="Lead conv" value={`${tiles.lead_conversion_pct.value}%`} />
      <Tile label="Sold on platform" value={fmt(tiles.sold_on_platform.value)} />
    </div>
  );
};

export default DealerKpiTiles;
