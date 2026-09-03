import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Search,
  Target,
  Phone,
  MessageSquare,
  Eye,
  Car,
  Bike,
  Hash,
  Wrench,
  Bug,
  Loader2,
  ArrowRight,
  ImageOff,
  User,
} from 'lucide-react';
import apiClient from '../utils/apiClient';
import { getEventActorLabel, adminListingRouteType } from './admin/adminUtils';
import {
  GlassCard,
  EmptyState,
  KpiTile,
  SegmentedControl,
} from './ui/dashboard';

// ─── constants ────────────────────────────────────────────────────────────────

const WINDOW_OPTIONS = [
  { label: '24h',  value: 1   },
  { label: '7d',   value: 7   },
  { label: '30d',  value: 30  },
  { label: '90d',  value: 90  },
  { label: '365d', value: 365 },
];

const STATUS_CHIPS = [
  { key: 'all',       label: 'All'       },
  { key: 'pending',   label: 'Pending'   },
  { key: 'reviewed',  label: 'Reviewed'  },
  { key: 'resolved',  label: 'Resolved'  },
  { key: 'dismissed', label: 'Dismissed' },
];

const TYPE_CHIPS = [
  { key: 'all',     label: 'All'             },
  { key: 'listing', label: 'Listing reports' },
  { key: 'bug',     label: 'Bug reports'     },
];

// ─── helpers ─────────────────────────────────────────────────────────────────

const relTime = (ts) => {
  if (!ts) return '';
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 2) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.round(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.round(diffHrs / 24);
  return `${diffDays}d ago`;
};

// ─── sub-components ───────────────────────────────────────────────────────────

const TypeBadge = ({ type }) => {
  const t = String(type || '').toLowerCase();
  const map = {
    car:   'bg-blue-500/10 text-blue-300 border-blue-500/20',
    cars:  'bg-blue-500/10 text-blue-300 border-blue-500/20',
    bike:  'bg-orange-500/10 text-orange-300 border-orange-500/20',
    bikes: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
    plate: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    plates:'bg-purple-500/10 text-purple-300 border-purple-500/20',
    part:  'bg-amber-500/10 text-amber-300 border-amber-500/20',
    parts: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    bug:   'bg-rose-500/10 text-rose-300 border-rose-500/20',
  };
  const labelMap = {
    car: 'Car', cars: 'Car', bike: 'Bike', bikes: 'Bike',
    plate: 'Plate', plates: 'Plate', part: 'Part', parts: 'Part', bug: 'Bug',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.10em] border ${map[t] || 'bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)] border-[color:var(--ex-shell-line)]'}`}>
      {labelMap[t] || type}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const s = String(status || 'pending').toLowerCase();
  const map = {
    pending:   'bg-amber-500/10 text-amber-300 border-amber-500/20',
    reviewed:  'bg-blue-500/10 text-blue-300 border-blue-500/20',
    resolved:  'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    dismissed: 'bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)] border-[color:var(--ex-shell-line)]',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize border ${map[s] || map.pending}`}>
      {s}
    </span>
  );
};

const ReasonLabel = ({ reason }) => {
  const r = String(reason || '').toLowerCase();
  const map = {
    fraud:         'text-rose-300',
    inappropriate: 'text-rose-300',
    spam:          'text-amber-300',
    duplicate:     'text-[color:var(--ex-shell-text-muted)]',
    sold:          'text-[color:var(--ex-shell-text-muted)]',
    bug:           'text-blue-300',
  };
  const cls = Object.entries(map).find(([k]) => r.includes(k))?.[1] || 'text-[color:var(--ex-shell-text-muted)]';
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-[0.10em] ${cls}`}>
      {reason || '—'}
    </span>
  );
};

const SkeletonRow = () => (
  <tr className="border-b border-[color:var(--ex-shell-line)] animate-pulse">
    {[...Array(7)].map((_, i) => (
      <td key={i} className="px-4 py-3">
        <div className="h-3 bg-[color:var(--ex-shell-surface)] rounded-full w-full" />
      </td>
    ))}
  </tr>
);

const ChipFilter = ({ options, active, onSelect }) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map((opt) => (
      <button
        key={opt.key}
        type="button"
        onClick={() => onSelect(opt.key)}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
          active === opt.key
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-[color:var(--ex-shell-surface)] hover:bg-[color:var(--ex-shell-surface-strong)] border-[color:var(--ex-shell-line)] text-[color:var(--ex-shell-text-muted)]'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

// ─── component ────────────────────────────────────────────────────────────────

const AdminReports = () => {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reports, setReports] = useState([]);
  const [leadMetrics, setLeadMetrics] = useState(null);
  const [history, setHistory] = useState([]);
  const [busyReportId, setBusyReportId] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [adminNotes, setAdminNotes] = useState({});
  const [savingNote, setSavingNote] = useState(null);

  // Initial load: reports + history (not windowed)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [reportsRes, historyRes] = await Promise.all([
          apiClient.get('/api/admin/reports').catch(() => []),
          apiClient.get('/api/admin/listing-history?limit=100').catch(() => []),
        ]);
        setReports(Array.isArray(reportsRes) ? reportsRes : []);
        setHistory(Array.isArray(historyRes) ? historyRes : []);
      } catch (fetchError) {
        console.error('Failed to fetch admin reports data:', fetchError);
        setError('Failed to load reports dashboard');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Re-fetch lead metrics whenever `days` changes
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setMetricsLoading(true);
        const leadRes = await apiClient.get(`/api/admin/lead-metrics?days=${days}`).catch(() => null);
        setLeadMetrics(leadRes || null);
      } catch (metricsError) {
        console.error('Failed to fetch lead metrics:', metricsError);
      } finally {
        setMetricsLoading(false);
      }
    };
    fetchMetrics();
  }, [days]);

  const updateReportStatus = async (reportId, nextStatus) => {
    setBusyReportId(reportId);
    try {
      const updated = await apiClient.request(`/api/admin/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: { status: nextStatus },
      });
      setReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, ...updated } : r))
      );
    } catch (statusError) {
      console.error('Failed to update report status:', statusError);
      setError(statusError?.response?.data?.error || 'Failed to update report status');
    } finally {
      setBusyReportId(null);
    }
  };

  const saveAdminNote = async (reportId) => {
    const note = adminNotes[reportId] ?? '';
    setSavingNote(reportId);
    try {
      const updated = await apiClient.request(`/api/admin/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: { admin_note: note },
      });
      setReports((prev) =>
        prev.map((r) => (r.id === reportId ? { ...r, ...updated } : r))
      );
    } catch (err) {
      console.error('Failed to save admin note:', err);
    } finally {
      setSavingNote(null);
    }
  };

  const totals = leadMetrics?.totals || {
    call_click: 0,
    whatsapp_click: 0,
    vin_open: 0,
    vin_reveal: 0,
    qualified_leads: 0,
  };

  const pendingCount = useMemo(
    () => reports.filter((r) => (r.status || 'pending') === 'pending').length,
    [reports]
  );

  const filtered = useMemo(() => {
    return reports.filter((r) => {
      const q = searchText.toLowerCase();
      const matchSearch = !q || (
        (r.reason || '').toLowerCase().includes(q) ||
        (r.details || '').toLowerCase().includes(q) ||
        (r.listing_id || '').toLowerCase().includes(q)
      );
      const matchStatus =
        statusFilter === 'all' || (r.status || 'pending') === statusFilter;
      const isBug = String(r.listing_type || '').toLowerCase() === 'bug';
      const matchType =
        typeFilter === 'all' ||
        (typeFilter === 'bug' && isBug) ||
        (typeFilter === 'listing' && !isBug);
      return matchSearch && matchStatus && matchType;
    });
  }, [reports, searchText, statusFilter, typeFilter]);

  const kpiTiles = [
    {
      label: 'Qualified leads',
      value: totals.qualified_leads || 0,
      icon: Target,
      accent: 'emerald',
    },
    {
      label: 'Call clicks',
      value: totals.call_click || 0,
      icon: Phone,
    },
    {
      label: 'WhatsApp clicks',
      value: totals.whatsapp_click || 0,
      icon: MessageSquare,
    },
    {
      label: 'VIN opens',
      value: (totals.vin_open || 0) + (totals.vin_reveal || 0),
      icon: Eye,
    },
  ];

  return (
    <div className="min-h-screen px-6 py-8 space-y-6">

      {/* ── Hero row ─────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-start justify-between flex-wrap gap-4"
      >
        <div>
          <h1 className="text-3xl font-semibold text-[color:var(--ex-shell-text)]">Reports</h1>
          <p className="text-sm text-[color:var(--ex-shell-text-muted)] mt-1">
            Track lead conversions, report volume, and listing deletion history.
          </p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {pendingCount} pending
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text-muted)] border border-[color:var(--ex-shell-line)]">
              {reports.length} total
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {metricsLoading && !loading && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border border-[color:var(--ex-shell-line)] bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)]">
              <Loader2 size={11} className="animate-spin" />
              Updating…
            </span>
          )}
          <SegmentedControl
            options={WINDOW_OPTIONS}
            value={days}
            onChange={setDays}
          />
        </div>
      </motion.div>

      {/* ── KPI tiles ────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {kpiTiles.map((tile, i) => (
          <motion.div
            key={tile.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.08 + i * 0.05 }}
          >
            <KpiTile
              label={tile.label}
              value={tile.value}
              icon={tile.icon}
              accent={tile.accent}
              loading={metricsLoading}
            />
          </motion.div>
        ))}
      </motion.div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-sm bg-rose-500/10 text-rose-300 border border-rose-500/20">
          {error}
        </div>
      )}

      {/* ── Filter row ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <GlassCard className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--ex-shell-text-muted)] pointer-events-none" />
            <input
              type="text"
              placeholder="Search by reason, details, or listing ID…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-lg pl-9 pr-3 py-2 text-sm text-[color:var(--ex-shell-text)] placeholder:text-[color:var(--ex-shell-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>
          {/* Chips */}
          <div className="flex flex-wrap gap-6">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium">Status</p>
              <ChipFilter options={STATUS_CHIPS} active={statusFilter} onSelect={setStatusFilter} />
            </div>
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium">Type</p>
              <ChipFilter options={TYPE_CHIPS} active={typeFilter} onSelect={setTypeFilter} />
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Reports table ────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <GlassCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--ex-shell-line)]">
                  {['Severity', 'Listing', 'Reason', 'Reporter', 'Status', 'Filed', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
                  : filtered.length === 0
                    ? (
                      <tr>
                        <td colSpan={7} className="py-0">
                          <EmptyState
                            icon={Shield}
                            title="No reports match your filters"
                            description="Try changing the status or type filter."
                          />
                        </td>
                      </tr>
                    )
                    : filtered.map((report, i) => {
                      const status = report.status || 'pending';
                      const isBusy = busyReportId === report.id;
                      const isExpanded = expandedId === report.id;
                      const reporterId = report.reporter_id || '';
                      const shortReporter = reporterId ? `user-${reporterId.slice(0, 8)}` : '—';

                      const severityColor = (() => {
                        const r = (report.reason || '').toLowerCase();
                        if (r.includes('fraud') || r.includes('inappropriate')) return 'bg-rose-400';
                        if (r.includes('spam') || r.includes('bug')) return 'bg-amber-400';
                        return 'bg-yellow-400/60';
                      })();

                      const expandedAccent = (() => {
                        if (status === 'resolved') return 'border-l-emerald-500/40';
                        if (status === 'dismissed') return 'border-l-white/10';
                        if (status === 'reviewed') return 'border-l-blue-500/40';
                        return 'border-l-amber-500/40';
                      })();

                      return (
                        <React.Fragment key={report.id}>
                          <motion.tr
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }}
                            onClick={() => setExpandedId(isExpanded ? null : report.id)}
                            className="border-b border-[color:var(--ex-shell-line)] hover:bg-[color:var(--ex-shell-surface)] transition-colors cursor-pointer group"
                          >
                            {/* Severity */}
                            <td className="px-4 py-3">
                              <span className={`w-2.5 h-2.5 rounded-full inline-block ${severityColor}`} />
                            </td>

                            {/* Listing */}
                            <td className="px-4 py-3">
                              {(() => {
                                const listing = report.listing;
                                const isBugReport = String(report.listing_type || '').toLowerCase() === 'bug';
                                if (isBugReport || !listing) {
                                  return (
                                    <div className="flex items-center gap-2 text-[color:var(--ex-shell-text-muted)]">
                                      <Bug size={14} />
                                      <span className="text-sm">Bug report</span>
                                    </div>
                                  );
                                }
                                const lt = String(report.listing_type || '').toLowerCase();
                                const FallbackIcon = lt === 'car' ? Car : lt === 'bike' ? Bike : lt === 'plate' ? Hash : Wrench;
                                const priceNum = listing.price != null ? Number(listing.price) : null;
                                const priceStr = priceNum != null && !isNaN(priceNum)
                                  ? `AED ${priceNum.toLocaleString()}`
                                  : null;
                                const title = listing.title || '';
                                const shortTitle = title.length > 36 ? title.slice(0, 36) + '…' : title;
                                return (
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {/* Thumbnail */}
                                    {listing.image_url ? (
                                      <img
                                        src={listing.image_url}
                                        alt=""
                                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-[color:var(--ex-shell-surface)]"
                                      />
                                    ) : (
                                      <div className="w-10 h-10 rounded-lg bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] flex items-center justify-center flex-shrink-0">
                                        <FallbackIcon size={16} className="text-[color:var(--ex-shell-text-muted)]" />
                                      </div>
                                    )}
                                    {/* Text */}
                                    <div className="min-w-0">
                                      <p className="text-sm text-[color:var(--ex-shell-text)] font-medium truncate" title={title}>
                                        {shortTitle || '—'}
                                      </p>
                                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                        <TypeBadge type={report.listing_type} />
                                        {priceStr && (
                                          <span className="text-[11px] text-[color:var(--ex-shell-text-muted)]">{priceStr}</span>
                                        )}
                                        {listing.public_url && (
                                          <a
                                            href={listing.public_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            title="Open listing in new tab"
                                            className="text-[color:var(--ex-shell-text-muted)] hover:text-emerald-300 transition-colors"
                                          >
                                            <ExternalLink size={12} />
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>

                            {/* Reason */}
                            <td className="px-4 py-3">
                              <ReasonLabel reason={report.reason} />
                            </td>

                            {/* Reporter */}
                            <td className="px-4 py-3">
                              {(() => {
                                const reporterEmail = report.reporter?.email;
                                if (reporterEmail) {
                                  const short = reporterEmail.length > 24
                                    ? reporterEmail.slice(0, 24) + '…'
                                    : reporterEmail;
                                  return (
                                    <span
                                      title={reporterEmail}
                                      className="text-xs text-[color:var(--ex-shell-text-muted)] cursor-default"
                                    >
                                      {short}
                                    </span>
                                  );
                                }
                                return (
                                  <span
                                    title={reporterId || undefined}
                                    className="font-mono text-xs text-[color:var(--ex-shell-text-muted)] cursor-default"
                                  >
                                    {shortReporter}
                                  </span>
                                );
                              })()}
                            </td>

                            {/* Status */}
                            <td className="px-4 py-3">
                              <StatusBadge status={status} />
                            </td>

                            {/* Filed */}
                            <td className="px-4 py-3">
                              <p className="text-[color:var(--ex-shell-text-muted)] text-xs whitespace-nowrap">{relTime(report.created_at)}</p>
                            </td>

                            {/* Actions */}
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                <button
                                  title="Mark resolved"
                                  disabled={isBusy || status === 'resolved'}
                                  onClick={() => updateReportStatus(report.id, 'resolved')}
                                  className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-[color:var(--ex-shell-text-muted)] hover:text-emerald-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <CheckCircle2 size={15} />
                                </button>
                                <button
                                  title="Dismiss"
                                  disabled={isBusy || status === 'dismissed'}
                                  onClick={() => updateReportStatus(report.id, 'dismissed')}
                                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-[color:var(--ex-shell-text-muted)] hover:text-rose-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <XCircle size={15} />
                                </button>
                              </div>
                            </td>
                          </motion.tr>

                          {/* Expandable detail drawer */}
                          <AnimatePresence>
                            {isExpanded && (
                              <tr key={`${report.id}-detail`} className="border-b border-[color:var(--ex-shell-line)]">
                                <td colSpan={7} className="p-0">
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className={`px-6 py-4 bg-[color:var(--ex-shell-surface)] border-l-4 ${expandedAccent} space-y-4`}>
                                      {/* Reported listing preview */}
                                      {(() => {
                                        const listing = report.listing;
                                        const isBugReport = String(report.listing_type || '').toLowerCase() === 'bug';
                                        if (isBugReport) return null;
                                        const adminType = adminListingRouteType(report.listing_type);
                                        const detailHref = adminType && report.listing_id
                                          ? `/admin/listings/${adminType}/${report.listing_id}`
                                          : null;

                                        if (!listing) {
                                          return (
                                            <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3 text-sm text-rose-200/80">
                                              The reported listing is no longer available (may have been deleted).
                                              {detailHref && (
                                                <>
                                                  {' '}
                                                  <Link
                                                    to={detailHref}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="underline hover:text-rose-100"
                                                  >
                                                    Open admin record
                                                  </Link>
                                                </>
                                              )}
                                            </div>
                                          );
                                        }

                                        const priceNum = listing.price != null ? Number(listing.price) : null;
                                        const priceStr = priceNum != null && !isNaN(priceNum)
                                          ? `AED ${priceNum.toLocaleString('en-AE')}`
                                          : null;

                                        return (
                                          <div>
                                            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-2">
                                              Reported listing
                                            </p>
                                            <div className="rounded-xl border border-[color:var(--ex-shell-line)] bg-[color:var(--ex-shell-surface)] p-3 flex gap-4 items-start">
                                              {listing.image_url ? (
                                                <img
                                                  src={listing.image_url}
                                                  alt=""
                                                  className="w-28 h-28 rounded-lg object-cover flex-shrink-0 bg-[color:var(--ex-shell-surface)]"
                                                />
                                              ) : (
                                                <div className="w-28 h-28 rounded-lg bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] flex items-center justify-center flex-shrink-0">
                                                  <ImageOff size={20} className="text-[color:var(--ex-shell-text-muted)]" />
                                                </div>
                                              )}
                                              <div className="flex-1 min-w-0 space-y-1.5">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                  <TypeBadge type={report.listing_type} />
                                                  {priceStr && (
                                                    <span className="text-sm font-semibold text-[color:var(--ex-shell-text)]">{priceStr}</span>
                                                  )}
                                                </div>
                                                <p className="text-sm text-[color:var(--ex-shell-text)] font-medium leading-snug">
                                                  {listing.title || '—'}
                                                </p>
                                                {listing.seller_email && (
                                                  <p className="flex items-center gap-1.5 text-xs text-[color:var(--ex-shell-text-muted)] break-all">
                                                    <User size={11} />
                                                    Seller: <span className="text-[color:var(--ex-shell-text-muted)] font-mono">{listing.seller_email}</span>
                                                  </p>
                                                )}
                                                <p className="font-mono text-[10px] text-[color:var(--ex-shell-text-muted)] break-all">
                                                  {report.listing_id}
                                                </p>
                                                <div className="flex flex-wrap gap-2 pt-1">
                                                  {detailHref && (
                                                    <Link
                                                      to={detailHref}
                                                      onClick={(e) => e.stopPropagation()}
                                                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/25 transition-colors"
                                                    >
                                                      Open in Admin Detail <ArrowRight size={12} />
                                                    </Link>
                                                  )}
                                                  {listing.public_url && (
                                                    <a
                                                      href={listing.public_url}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      onClick={(e) => e.stopPropagation()}
                                                      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-[color:var(--ex-shell-surface-strong)] border border-[color:var(--ex-shell-line)] text-[color:var(--ex-shell-text-muted)] hover:bg-[color:var(--ex-shell-surface-strong)] transition-colors"
                                                    >
                                                      View public page <ExternalLink size={11} />
                                                    </a>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })()}

                                      {/* Details */}
                                      {report.details && (
                                        <div>
                                          <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-1.5">Details</p>
                                          <p className="text-sm text-[color:var(--ex-shell-text-muted)] leading-relaxed">{report.details}</p>
                                        </div>
                                      )}

                                      {/* Reporter full ID */}
                                      <div>
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-1.5">Reporter ID</p>
                                        <p className="font-mono text-xs text-[color:var(--ex-shell-text-muted)] select-all">{reporterId || '—'}</p>
                                      </div>

                                      {/* Admin note */}
                                      <div>
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-1.5">Admin note</p>
                                        {status === 'pending' ? (
                                          <div className="flex gap-2 items-start">
                                            <textarea
                                              rows={2}
                                              placeholder="Add an internal note…"
                                              value={adminNotes[report.id] ?? (report.admin_note || '')}
                                              onChange={(e) =>
                                                setAdminNotes((prev) => ({ ...prev, [report.id]: e.target.value }))
                                              }
                                              className="flex-1 bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-lg px-3 py-2 text-sm text-[color:var(--ex-shell-text)] placeholder:text-[color:var(--ex-shell-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                                            />
                                            <button
                                              onClick={() => saveAdminNote(report.id)}
                                              disabled={savingNote === report.id}
                                              className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-3 py-2 text-xs whitespace-nowrap disabled:opacity-50"
                                            >
                                              {savingNote === report.id ? 'Saving…' : 'Save'}
                                            </button>
                                          </div>
                                        ) : (
                                          <p className="text-sm text-[color:var(--ex-shell-text-muted)] italic">{report.admin_note || 'No note.'}</p>
                                        )}
                                      </div>
                                    </div>
                                  </motion.div>
                                </td>
                              </tr>
                            )}
                          </AnimatePresence>
                        </React.Fragment>
                      );
                    })
                }
              </tbody>
            </table>
          </div>
          {!loading && (
            <div className="px-4 py-3 border-t border-[color:var(--ex-shell-line)]">
              <p className="text-xs text-[color:var(--ex-shell-text-muted)]">{filtered.length} reports shown</p>
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* ── Recent lead activity ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.25 }}
      >
        <GlassCard>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-3">Recent lead activity</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--ex-shell-line)]">
                  {['Actor', 'Listing', 'Action', 'When'].map((h) => (
                    <th key={h} className="pb-3 text-left text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium pr-6 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(leadMetrics?.recent_events || []).length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-[color:var(--ex-shell-text-muted)] text-sm">No lead events found.</td>
                  </tr>
                ) : (leadMetrics?.recent_events || []).slice(0, 15).map((event) => (
                  <tr key={event.id} className="border-b border-[color:var(--ex-shell-line)] hover:bg-[color:var(--ex-shell-surface)] transition-colors">
                    <td className="py-2.5 pr-6 text-[color:var(--ex-shell-text-muted)] text-xs">{getEventActorLabel(event)}</td>
                    <td className="py-2.5 pr-6 text-[color:var(--ex-shell-text-muted)] text-xs font-mono">
                      {event.listing_type} · {event.listing_id ? event.listing_id.slice(0, 8) : '—'}
                    </td>
                    <td className="py-2.5 pr-6 text-[color:var(--ex-shell-text-muted)] text-xs">{event.action}</td>
                    <td className="py-2.5 text-[color:var(--ex-shell-text-muted)] text-xs whitespace-nowrap">{relTime(event.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </motion.div>

      {/* ── Removal history ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
      >
        <GlassCard>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-3">Removal history</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--ex-shell-line)]">
                  {['Type', 'Listing', 'Reason', 'Deleted by', 'When'].map((h) => (
                    <th key={h} className="pb-3 text-left text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium pr-6 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-[color:var(--ex-shell-text-muted)] text-sm">No deletion history found.</td>
                  </tr>
                ) : history.slice(0, 20).map((entry) => (
                  <tr key={entry.id} className="border-b border-[color:var(--ex-shell-line)] hover:bg-[color:var(--ex-shell-surface)] transition-colors">
                    <td className="py-2.5 pr-6"><TypeBadge type={entry.listing_type} /></td>
                    <td className="py-2.5 pr-6 font-mono text-xs text-[color:var(--ex-shell-text-muted)]">
                      {entry.listing_id ? entry.listing_id.slice(0, 8) : '—'}
                    </td>
                    <td className="py-2.5 pr-6 text-[color:var(--ex-shell-text-muted)] text-xs">{entry.reason || '—'}</td>
                    <td className="py-2.5 pr-6 text-[color:var(--ex-shell-text-muted)] text-xs">{entry.deleted_by_role || '—'}</td>
                    <td className="py-2.5 text-[color:var(--ex-shell-text-muted)] text-xs whitespace-nowrap">{relTime(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </motion.div>

    </div>
  );
};

export default AdminReports;
