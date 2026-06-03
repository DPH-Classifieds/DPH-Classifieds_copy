import React, { useEffect, useState, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Search, Shield, X } from 'lucide-react';
import apiClient from '../../utils/apiClient';

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

// ── constants ─────────────────────────────────────────────────────────────────

const METHOD_CHIPS = ['All', 'GET', 'POST', 'PATCH', 'DELETE'];

const METHOD_BADGE = {
  GET:    'bg-blue-500/10 text-blue-300 border-blue-500/20',
  POST:   'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  PATCH:  'bg-amber-500/10 text-amber-300 border-amber-500/20',
  DELETE: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
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
  <div className="space-y-2 p-5">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-10" />
    ))}
  </div>
);

const MethodBadge = ({ method }) => (
  <span
    className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 uppercase tracking-wide ${
      METHOD_BADGE[method] || 'bg-white/[0.06] text-white/40 border-white/10'
    }`}
  >
    {method || '—'}
  </span>
);

const StatusCodeBadge = ({ code }) => {
  if (!code) return <span className="text-white/30 text-xs">—</span>;
  const n = Number(code);
  const cls =
    n >= 500
      ? 'text-rose-300'
      : n >= 400
      ? 'text-amber-300'
      : n >= 200
      ? 'text-emerald-300'
      : 'text-white/50';
  return <span className={`font-mono text-xs tabular-nums ${cls}`}>{code}</span>;
};

const TABLE_HEADERS = ['Time', 'Admin', 'Dealership', 'Method', 'Endpoint', 'Status', 'IP'];

// ── main component ────────────────────────────────────────────────────────────

const AdminDealerAuditLog = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dealershipId = searchParams.get('dealership_id');

  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('All');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const q = dealershipId ? `?dealership_id=${dealershipId}` : '';
    apiClient
      .get(`/api/admin/dealer-audit-log${q}`)
      .then((r) => {
        if (active) {
          setRows(r.audit || []);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message || 'Failed to load');
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [dealershipId]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const matchSearch =
        !q ||
        (r.endpoint || '').toLowerCase().includes(q) ||
        (r.admin?.email || '').toLowerCase().includes(q) ||
        (r.admin?.first_name || '').toLowerCase().includes(q);
      const matchMethod =
        methodFilter === 'All' ||
        (r.http_method || '').toUpperCase() === methodFilter;
      return matchSearch && matchMethod;
    });
  }, [rows, search, methodFilter]);

  // Find dealership name for the filter chip
  const dealershipName = useMemo(() => {
    if (!dealershipId || !rows) return null;
    const hit = rows.find((r) => String(r.dealership?.id) === String(dealershipId));
    return hit?.dealership?.name || `#${dealershipId}`;
  }, [rows, dealershipId]);

  return (
    <div className="text-white space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <h1 className="text-3xl font-semibold text-white">Dealer admin audit log</h1>
        <p className="text-sm text-white/40 mt-1">
          Every write performed by an admin while acting as a dealership.
        </p>
      </motion.div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="flex flex-col sm:flex-row gap-3 flex-wrap items-start"
      >
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            type="text"
            placeholder="Search endpoint, admin email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition w-64"
          />
        </div>

        <FilterChips options={METHOD_CHIPS} value={methodFilter} onChange={setMethodFilter} />

        {/* Dealership filter chip */}
        {dealershipId && (
          <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 text-xs text-emerald-300">
            <span>Filtered: {dealershipName || `#${dealershipId}`}</span>
            <button
              onClick={() => navigate('/admin/dealerships/audit-log')}
              className="text-emerald-400 hover:text-white transition ml-1"
              aria-label="Clear dealership filter"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {rows && (
          <span className="text-[11px] font-semibold text-white/40 bg-white/[0.06] border border-white/10 rounded-full px-2.5 py-1 self-center">
            {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
          </span>
        )}
      </motion.div>

      {/* Table card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 overflow-hidden"
      >
        {loading && <Skeleton />}

        {error && (
          <div className="px-5 py-4 text-rose-300 text-sm">
            Failed to load audit log — {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Shield size={48} className="text-white/20" />
            <p className="text-sm text-white/40">No audit events yet.</p>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {TABLE_HEADERS.map((h) => (
                    <th
                      key={h}
                      className="text-left text-[10px] uppercase tracking-[0.14em] text-white/30 font-medium px-5 py-3 first:pl-5"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.map((r, idx) => (
                  <motion.tr
                    key={r.id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.015 }}
                    className="hover:bg-white/[0.03] transition-colors group"
                  >
                    {/* Time */}
                    <td className="px-5 py-3 text-white/40 text-xs tabular-nums whitespace-nowrap">
                      {formatRelativeTime(r.created_at)}
                    </td>

                    {/* Admin */}
                    <td className="px-5 py-3">
                      <p className="text-sm text-white/70">
                        {r.admin?.first_name || '—'}
                      </p>
                      <p className="text-[11px] text-white/30 truncate max-w-[140px]">
                        {r.admin?.email || ''}
                      </p>
                    </td>

                    {/* Dealership */}
                    <td className="px-5 py-3">
                      {r.dealership?.id ? (
                        <Link
                          to={`/admin/dealerships/${r.dealership.id}`}
                          className="text-sm text-white/60 hover:text-emerald-400 transition-colors"
                        >
                          {r.dealership.name || `#${r.dealership.id}`}
                        </Link>
                      ) : (
                        <span className="text-sm text-white/30">—</span>
                      )}
                    </td>

                    {/* Method */}
                    <td className="px-5 py-3">
                      <MethodBadge method={r.http_method} />
                    </td>

                    {/* Endpoint */}
                    <td className="px-5 py-3">
                      <span
                        className="font-mono text-[11px] text-white/50 group-hover:text-white/70 transition-colors"
                        title={r.endpoint}
                      >
                        {(r.endpoint || '—').length > 60
                          ? `${(r.endpoint || '').slice(0, 60)}…`
                          : r.endpoint || '—'}
                      </span>
                    </td>

                    {/* Status code */}
                    <td className="px-5 py-3">
                      <StatusCodeBadge code={r.result_status} />
                    </td>

                    {/* IP */}
                    <td className="px-5 py-3">
                      <span className="font-mono text-[11px] text-white/30 tabular-nums">
                        {r.ip_address || '—'}
                      </span>
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

export default AdminDealerAuditLog;
