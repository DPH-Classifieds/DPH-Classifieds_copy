import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { resolveMediaUrl } from '../utils/media';
import BrowseSellCta from './BrowseSellCta';
import ListingSkeleton from './ListingSkeleton';
import SeoMeta from './SeoMeta';
import { buildStaticSeo } from '../utils/seo';
import './ExplorePage.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const ITEM_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'car', label: 'Cars' },
  { value: 'plate', label: 'Plates' },
  { value: 'part', label: 'Parts' },
  { value: 'bike', label: 'Bikes' },
];

const seoData = buildStaticSeo({
  title: 'Buying Requests | DPH Classifieds',
  description: 'Browse anonymous buying requests from UAE members, or post your own to let sellers come to you.',
  path: '/buying-requests',
  keywords: ['want to buy UAE', 'buying request', 'UAE marketplace'],
});

export default function BuyingRequestsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeType, setActiveType] = useState('all');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError('');
        const resp = await axios.get(`${API_URL}/api/buying-requests`);
        setRows(Array.isArray(resp.data) ? resp.data : []);
      } catch (e) {
        setError('Failed to load buying requests.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (activeType === 'all') return rows;
    return rows.filter((row) => String(row?.item_type || '').toLowerCase() === activeType);
  }, [rows, activeType]);

  return (
    <>
      <SeoMeta {...seoData} />
      <div className="explore-v2">
        <div className="explore-v2-shell">
          <div className="explore-v2-pageheader">
            <div>
              <h1>Buying Requests</h1>
              <p>Posters stay anonymous. Verify your phone to reveal WhatsApp contact links.</p>
            </div>
            <Link to="/post-buying-request" className="explore-v2-postad">
              Post a Request
            </Link>
          </div>

          <div className="explore-v2-chips" role="tablist" aria-label="Item type" style={{ marginTop: 16 }}>
            {ITEM_TYPES.map((type) => (
              <button
                key={type.value}
                type="button"
                role="tab"
                aria-selected={activeType === type.value}
                className={`explore-v2-chip ${activeType === type.value ? 'is-active' : ''}`}
                onClick={() => setActiveType(type.value)}
              >
                {type.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="explore-v2-state-card">
              <ListingSkeleton variant="grid" count={6} />
            </div>
          ) : error ? (
            <div className="explore-v2-inline-alert">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="explore-v2-state-card">
              <p>No buying requests yet.</p>
              <Link to="/post-buying-request" className="explore-v2-button explore-v2-button-primary">
                Post a Request
              </Link>
            </div>
          ) : (
            <div className="explore-v2-listing-grid">
              {filtered.map((row) => {
                const title = row?.item_name || 'Buying request';
                const type = String(row?.item_type || '').toUpperCase();
                const imageUrl =
                  resolveMediaUrl(row?.images?.[0]?.display_url) ||
                  resolveMediaUrl(row?.images?.[0]?.image_url) ||
                  resolveMediaUrl(row?.images?.[0]?.url) ||
                  resolveMediaUrl(row?.display_url) ||
                  resolveMediaUrl(row?.image_url) ||
                  PLACEHOLDER_IMAGE;
                return (
                  <Link key={row.id} to={`/buying-requests/${row.id}`} className="explore-v2-wtb-card">
                    <div className="explore-v2-wtb-card-image">
                      <img src={imageUrl} alt={title} loading="lazy" />
                    </div>
                    <div className="explore-v2-wtb-card-body">
                      <span className="explore-v2-wtb-card-kicker">
                        {type}
                        {row?.regional_spec ? ` · ${row.regional_spec}` : ''}
                      </span>
                      <h3>{title}</h3>
                      {row?.mileage_preference ? <p>Mileage: {row.mileage_preference}</p> : null}
                      {row?.budget ? (
                        <span className="explore-v2-wtb-card-budget">
                          {new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(row.budget)}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          <BrowseSellCta category="buying-requests" />
        </div>
      </div>
    </>
  );
}
