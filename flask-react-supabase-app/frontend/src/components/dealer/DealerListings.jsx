import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Car,
  BarChart3,
  Activity,
  TrendingUp,
  Plus,
  Search,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';
import DealerListingsLimitCard from './DealerListingsLimitCard';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

const TYPE_BADGE = {
  car:  'bg-blue-500/10 text-blue-300 border-blue-500/20',
  bike: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
  plate:'bg-purple-500/10 text-purple-300 border-purple-500/20',
  part: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
};

const TYPE_CHIPS = ['All', 'Cars', 'Bikes', 'Plates', 'Parts'];
const STATUS_CHIPS = ['All', 'Active', 'Sold', 'Removed'];

const typeKey = (chip) => {
  if (chip === 'Cars')   return 'car';
  if (chip === 'Bikes')  return 'bike';
  if (chip === 'Plates') return 'plate';
  if (chip === 'Parts')  return 'part';
  return null;
};

// ── sub-components ────────────────────────────────────────────────────────────

const FilterChips = ({ options, value, onChange }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((opt) => (
      <button
        key={opt}
        onClick={() => onChange(opt)}
        className={`rounded-full px-3 py-1 text-xs transition-colors border ${
          value === opt
            ? 'bg-white/10 text-white border-white/20'
            : 'text-white/40 border-white/[0.06] hover:text-white/70 hover:bg-white/[0.05]'
        }`}
      >
        {opt}
      </button>
    ))}
  </div>
);

const Skeleton = () => (
  <div className="space-y-2 p-1">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-12" />
    ))}
  </div>
);

const StatusBadge = ({ status }) => {
  const cls =
    status === 'active'
      ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
      : 'text-white/50 bg-white/[0.06] border-white/10';
  return (
    <span className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${cls}`}>
      {status || '—'}
    </span>
  );
};

const TypeBadge = ({ type }) => (
  <span
    className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${
      TYPE_BADGE[type] || 'bg-white/[0.06] text-white/40 border-white/10'
    }`}
  >
    {type || '—'}
  </span>
);

// ── main component ────────────────────────────────────────────────────────────

const DealerListings = () => {
  const navigate = useNavigate();
  const [listings, setListings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .get('/api/dealer/listings')
      .then((r) => { if (active) { setListings(r.listings || []); setLoading(false); } })
      .catch((e) => { if (active) { setError(e.message || 'Failed to load'); setLoading(false); } });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    if (!listings) return [];
    return listings.filter((l) => {
      const matchSearch = !search || String(l.id).toLowerCase().includes(search.toLowerCase());
      const matchType =
        typeFilter === 'All' || l.listing_type === typeKey(typeFilter);
      const matchStatus =
        statusFilter === 'All' || l.status?.toLowerCase() === statusFilter.toLowerCase();
      return matchSearch && matchType && matchStatus;
    });
  }, [listings, search, typeFilter, statusFilter]);

  return (
    <div className="space-y-5">
      <DealerListingsLimitCard />
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between gap-4 flex-wrap"
      >
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold text-white">Inventory</h1>
          {listings && (
            <span className="text-[11px] font-semibold text-white/50 bg-white/[0.06] border border-white/10 rounded-full px-2.5 py-1">
              {listings.length}
            </span>
          )}
        </div>
        <Link
          to="/sell"
          className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm transition border border-white/10"
        >
          <Plus size={14} />
          Post new listing
        </Link>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="flex flex-col sm:flex-row gap-3 flex-wrap"
      >
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition w-56"
          />
        </div>
        <FilterChips options={TYPE_CHIPS} value={typeFilter} onChange={setTypeFilter} />
        <FilterChips options={STATUS_CHIPS} value={statusFilter} onChange={setStatusFilter} />
      </motion.div>

      {/* Table card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 overflow-hidden"
      >
        {loading && (
          <div className="p-5">
            <Skeleton />
          </div>
        )}

        {error && (
          <div className="px-5 py-4 text-rose-300 text-sm">
            Failed to load inventory — {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Car size={48} className="text-white/20" />
            <p className="text-sm text-white/40">
              {listings && listings.length === 0
                ? 'No inventory yet.'
                : 'No listings match your filters.'}
            </p>
            {listings && listings.length === 0 && (
              <Link
                to="/sell"
                className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm transition inline-flex items-center gap-2"
              >
                <Plus size={14} />
                Post your first listing
              </Link>
            )}
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Listing', 'Type', 'Status', 'Stored views', 'Sold status', 'Listed', 'Actions'].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left text-[10px] uppercase tracking-[0.14em] text-white/30 font-medium px-5 py-3 first:pl-5"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.map((l, idx) => (
                  <motion.tr
                    key={`${l.listing_type}-${l.id}`}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.02 }}
                    className="hover:bg-white/[0.03] transition-colors group"
                  >
                    {/* Listing */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                          <Car size={12} className="text-white/30" />
                        </div>
                        <span className="font-mono text-[11px] text-white/60 group-hover:text-white/80 transition-colors">
                          #{String(l.id).slice(0, 8)}
                        </span>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-5 py-3">
                      <TypeBadge type={l.listing_type} />
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3">
                      <StatusBadge status={l.status} />
                    </td>

                    {/* Views */}
                    <td
                      className="px-5 py-3 tabular-nums text-white/60 text-xs"
                      title="Stored listing counter. Open Analytics for canonical deduplicated detail views."
                    >
                      {l.view_count == null ? 'N/A' : Number(l.view_count).toLocaleString('en-AE')}
                    </td>

                    {/* Sold status */}
                    <td className="px-5 py-3 text-white/40 text-xs capitalize">
                      {l.sold_status || '—'}
                    </td>

                    {/* Listed */}
                    <td className="px-5 py-3 text-white/40 text-xs tabular-nums">
                      {formatRelativeTime(l.created_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() =>
                            navigate(
                              `/dealer/listings/${l.listing_type}/${l.id}/analytics`
                            )
                          }
                          title="Analytics"
                          className="p-1.5 rounded-lg text-white/30 hover:text-emerald-400 hover:bg-emerald-500/10 transition"
                        >
                          <BarChart3 size={14} />
                        </button>
                        <button
                          onClick={() =>
                            navigate(
                              `/dealer/listings/${l.listing_type}/${l.id}/diagnostic`
                            )
                          }
                          title="Diagnostic"
                          className="p-1.5 rounded-lg text-white/30 hover:text-orange-400 hover:bg-orange-500/10 transition"
                        >
                          <Activity size={14} />
                        </button>
                        <button
                          onClick={() =>
                            navigate(
                              `/dealer/listings/${l.listing_type}/${l.id}/market`
                            )
                          }
                          title="Market position"
                          className="p-1.5 rounded-lg text-white/30 hover:text-blue-400 hover:bg-blue-500/10 transition"
                        >
                          <TrendingUp size={14} />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default DealerListings;
