import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const PLACEHOLDER_IMAGE = '/images/listing-placeholder.svg';

const ITEM_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'car', label: 'Cars' },
  { value: 'plate', label: 'Plates' },
  { value: 'part', label: 'Parts' },
  { value: 'bike', label: 'Bikes' },
];

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
    <div className="mx-auto max-w-[1480px] px-5 pb-16 pt-10 sm:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Buying Requests</h1>
          <p className="mt-1 text-sm text-white/60">
            Posters stay anonymous. Verify your phone to reveal WhatsApp contact links.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {ITEM_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => setActiveType(type.value)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                activeType === type.value
                  ? 'border-[#8bd6b4]/40 bg-[#8bd6b4]/15 text-[#c7f3df]'
                  : 'border-white/10 bg-white/5 text-white/70 hover:border-[#8bd6b4]/25 hover:text-white'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-white/70">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-red-100">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-white/65">
          No buying requests yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) => {
            const title = row?.item_name || 'Buying request';
            const type = String(row?.item_type || '').toUpperCase();
            const imageUrl = PLACEHOLDER_IMAGE;
            return (
              <Link
                key={row.id}
                to={`/buying-requests/${row.id}`}
                className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition hover:border-[#8bd6b4]/25"
              >
                <div className="aspect-[16/10] w-full bg-black/20">
                  <img
                    src={imageUrl}
                    alt=""
                    className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
                    loading="lazy"
                  />
                </div>
                <div className="p-4">
                  <div className="text-[15px] font-semibold text-white">{title}</div>
                  <div className="mt-1 text-sm text-white/55">
                    {type}
                    {row?.regional_spec ? ` · ${row.regional_spec}` : ''}
                  </div>
                  {row?.mileage_preference ? (
                    <div className="mt-2 text-sm text-white/60">Mileage: {row.mileage_preference}</div>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

