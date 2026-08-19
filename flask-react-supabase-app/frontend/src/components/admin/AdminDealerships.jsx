import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Search, Store, ExternalLink, ChevronRight, ChevronDown } from 'lucide-react';
import apiClient from '../../utils/apiClient';

const ROLE_LABELS = { owner: 'Owner', manager: 'Manager', sales_rep: 'Sales rep' };
const MEMBER_STATUS_CLS = {
  active: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  invited: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  revoked: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
};

function MemberRow({ member }) {
  const user = member.user || {};
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.company_name || user.email || 'Unknown';
  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
      <div className="min-w-0">
        <p className="text-sm text-white/80 truncate">{name}</p>
        <p className="text-xs text-white/40 truncate">{user.email}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-white/40 bg-white/[0.06] border border-white/10 rounded-full px-2 py-0.5">
          {ROLE_LABELS[member.role] || member.role}
        </span>
        <span className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${MEMBER_STATUS_CLS[member.status] || 'text-white/40 bg-white/5 border-white/10'}`}>
          {member.status}
        </span>
        <span className={`text-[10px] font-medium rounded-full border px-2 py-0.5 ${
          user.dealer_verified
            ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
            : 'text-amber-300 bg-amber-500/10 border-amber-500/20'
        }`}>
          {user.dealer_verified ? 'KYC verified' : 'KYC pending'}
        </span>
      </div>
    </div>
  );
}

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
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-12" />
    ))}
  </div>
);

const StatusBadge = ({ status }) => {
  const cls =
    status === 'active'
      ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
      : status === 'suspended'
      ? 'text-rose-300 bg-rose-500/10 border-rose-500/20'
      : 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  return (
    <span className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${cls}`}>
      {status || '—'}
    </span>
  );
};

const STATUS_CHIPS = ['All', 'Active', 'Suspended'];

// ── main component ────────────────────────────────────────────────────────────

const AdminDealerships = () => {
  const navigate = useNavigate();
  const [dealerships, setDealerships] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [memberCache, setMemberCache] = useState({});

  const toggleExpand = (dealershipId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(dealershipId)) {
        next.delete(dealershipId);
      } else {
        next.add(dealershipId);
        if (!memberCache[dealershipId]) {
          setMemberCache((cache) => ({ ...cache, [dealershipId]: { loading: true } }));
          apiClient
            .get(`/api/admin/dealerships/${dealershipId}`)
            .then((r) => {
              setMemberCache((cache) => ({
                ...cache,
                [dealershipId]: { loading: false, members: r.dealership?.members || [] },
              }));
            })
            .catch((e) => {
              setMemberCache((cache) => ({
                ...cache,
                [dealershipId]: { loading: false, error: e.message || 'Failed to load members' },
              }));
            });
        }
      }
      return next;
    });
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiClient
      .get('/api/admin/dealerships')
      .then((r) => {
        if (active) {
          setDealerships(r.dealerships || []);
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
  }, []);

  const filtered = useMemo(() => {
    if (!dealerships) return [];
    const q = search.toLowerCase();
    return dealerships.filter((d) => {
      const matchSearch =
        !q ||
        (d.name || '').toLowerCase().includes(q) ||
        (d.slug || '').toLowerCase().includes(q);
      const matchStatus =
        statusFilter === 'All' ||
        (d.status || '').toLowerCase() === statusFilter.toLowerCase();
      return matchSearch && matchStatus;
    });
  }, [dealerships, search, statusFilter]);

  const TABLE_HEADERS = ['Name', 'Slug', 'Status', 'Emirate', 'Phone', 'Created', 'Actions'];

  return (
    <div className="text-white space-y-5">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between gap-4 flex-wrap"
      >
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Dealerships</h1>
            {dealerships && (
              <span className="text-[11px] font-semibold text-white/50 bg-white/[0.06] border border-white/10 rounded-full px-2.5 py-1">
                {dealerships.length}
              </span>
            )}
          </div>
          <p className="text-sm text-white/40 mt-1">
            Operational oversight of approved dealerships across the platform.
          </p>
        </div>
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
            placeholder="Search by name or slug..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white/[0.04] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition w-64"
          />
        </div>
        <FilterChips options={STATUS_CHIPS} value={statusFilter} onChange={setStatusFilter} />
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
            Failed to load dealerships — {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Store size={48} className="text-white/20" />
            <p className="text-sm text-white/40">
              {dealerships && dealerships.length === 0
                ? 'No dealerships yet.'
                : 'No dealerships match your filters.'}
            </p>
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
                {filtered.map((d, idx) => (
                  <React.Fragment key={d.id}>
                  <motion.tr
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.02 }}
                    className="hover:bg-white/[0.03] transition-colors group"
                  >
                    {/* Name */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => toggleExpand(d.id)}
                          aria-label={expandedIds.has(d.id) ? 'Collapse members' : 'Expand members'}
                          className="text-white/30 hover:text-white/70 transition-colors shrink-0"
                        >
                          {expandedIds.has(d.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <Link
                          to={`/admin/dealerships/${d.id}`}
                          className="font-medium text-white/80 hover:text-emerald-400 transition-colors"
                        >
                          {d.name || '—'}
                        </Link>
                      </div>
                    </td>

                    {/* Slug */}
                    <td className="px-5 py-3">
                      <span className="font-mono text-[11px] text-white/40">
                        {d.slug || '—'}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3">
                      <StatusBadge status={d.status} />
                    </td>

                    {/* Emirate */}
                    <td className="px-5 py-3 text-white/50 text-xs">
                      {d.emirate || '—'}
                    </td>

                    {/* Phone */}
                    <td className="px-5 py-3 text-white/50 text-xs tabular-nums">
                      {d.phone || '—'}
                    </td>

                    {/* Created */}
                    <td className="px-5 py-3 text-white/40 text-xs tabular-nums">
                      {formatRelativeTime(d.created_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/dealer/dashboard?as=${d.id}`)}
                          className="inline-flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-full px-3 py-1 text-xs border border-white/10 transition"
                        >
                          <ExternalLink size={11} />
                          Open panel
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                  {expandedIds.has(d.id) && (
                    <tr>
                      <td colSpan={TABLE_HEADERS.length} className="px-5 py-3 bg-black/20">
                        {memberCache[d.id]?.loading && (
                          <p className="text-xs text-white/40">Loading members…</p>
                        )}
                        {memberCache[d.id]?.error && (
                          <p className="text-xs text-rose-300">{memberCache[d.id].error}</p>
                        )}
                        {memberCache[d.id]?.members && (
                          memberCache[d.id].members.length === 0 ? (
                            <p className="text-xs text-white/40">No members yet.</p>
                          ) : (
                            <div className="space-y-1.5">
                              {memberCache[d.id].members.map((m) => (
                                <MemberRow key={m.id} member={m} />
                              ))}
                            </div>
                          )
                        )}
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Audit log link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <Link
          to="/admin/dealerships/audit-log"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-emerald-400 transition-colors"
        >
          View global audit log
          <ChevronRight size={14} />
        </Link>
      </motion.div>
    </div>
  );
};

export default AdminDealerships;
