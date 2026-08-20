import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ExternalLink,
  Phone,
  Globe,
  MapPin,
  Building2,
  FileText,
  Shield,
  ClipboardList,
} from 'lucide-react';
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

// ── sub-components ────────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  const cls =
    status === 'active'
      ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
      : status === 'suspended'
      ? 'text-rose-300 bg-rose-500/10 border-rose-500/20'
      : 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  return (
    <span className={`text-[10px] font-medium rounded-full border px-2.5 py-1 capitalize ${cls}`}>
      {status || '—'}
    </span>
  );
};

const RoleBadge = ({ role }) => {
  const cls =
    role === 'owner'
      ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
      : 'text-white/50 bg-white/[0.06] border-white/10';
  return (
    <span className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${cls}`}>
      {role || '—'}
    </span>
  );
};

const InfoRow = ({ icon: Icon, label, value }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={12} className="text-white/30" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-white/30 font-medium">{label}</p>
        <p className="text-sm text-white/70 mt-0.5 break-all">{value}</p>
      </div>
    </div>
  );
};

const SkeletonBlock = ({ h = 'h-6' }) => (
  <div className={`animate-pulse bg-white/[0.04] rounded-lg ${h} w-full`} />
);

const Skeleton = () => (
  <div className="space-y-5">
    <div className="space-y-2">
      <SkeletonBlock h="h-8" />
      <SkeletonBlock h="h-4" />
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 space-y-3"
        >
          <SkeletonBlock h="h-4" />
          <SkeletonBlock h="h-4" />
          <SkeletonBlock h="h-4" />
          <SkeletonBlock h="h-4" />
        </div>
      ))}
    </div>
  </div>
);

// ── main component ────────────────────────────────────────────────────────────

const AdminDealershipDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(undefined); // undefined = loading, null = not found
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const refresh = useCallback(() => {
    apiClient
      .get(`/api/admin/dealerships/${id}`)
      .then((r) => setData(r.dealership || null))
      .catch(() => setData(null));
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleAction = async (action) => {
    setActionBusy(true);
    setActionError(null);
    try {
      await apiClient.post(`/api/admin/dealerships/${id}/${action}`, {});
      refresh();
    } catch (e) {
      setActionError(e.message || `Failed to ${action}`);
    } finally {
      setActionBusy(false);
    }
  };

  // Loading state
  if (data === undefined) {
    return (
      <div className="text-white space-y-5">
        <Skeleton />
      </div>
    );
  }

  // Not found
  if (data === null) {
    return (
      <div className="text-white flex flex-col items-center justify-center py-24 gap-4">
        <Shield size={48} className="text-white/20" />
        <p className="text-lg font-semibold text-white/70">Dealership not found</p>
        <Link
          to="/admin/dealerships"
          className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-emerald-400 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Dealerships
        </Link>
      </div>
    );
  }

  const d = data;
  const ownerMember = (d.members || []).find((m) => m.role === 'owner');
  const ownerEmail = ownerMember?.user?.email || '—';

  const initial = (d.name || '?').slice(0, 2).toUpperCase();

  return (
    <div className="text-white space-y-5">
      {/* Breadcrumb */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Link
          to="/admin/dealerships"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-emerald-400 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Dealerships
        </Link>
      </motion.div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div className="flex items-center gap-4">
          {/* Avatar / initial */}
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold text-emerald-400">{initial}</span>
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-semibold text-white">{d.name}</h1>
              <StatusBadge status={d.status} />
            </div>
            <p className="font-mono text-xs text-white/30 mt-1">{d.slug || '—'}</p>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex flex-col gap-2 items-end">
          <button
            onClick={() => navigate(`/dealer/dashboard?as=${id}`)}
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm transition"
          >
            <ExternalLink size={14} />
            Open panel
          </button>

          {actionError && (
            <p className="text-xs text-rose-300">{actionError}</p>
          )}

          {d.status === 'active' ? (
            <button
              disabled={actionBusy}
              onClick={() => handleAction('suspend')}
              className="inline-flex items-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-4 py-2 text-sm transition disabled:opacity-50"
            >
              {actionBusy ? 'Working…' : 'Suspend dealership'}
            </button>
          ) : (
            <button
              disabled={actionBusy}
              onClick={() => handleAction('restore')}
              className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10 transition disabled:opacity-50"
            >
              {actionBusy ? 'Working…' : 'Restore dealership'}
            </button>
          )}
        </div>
      </motion.div>

      {/* 3-column grid */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.08 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        {/* Card 1: Profile */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-4">
            Profile
          </p>
          <div>
            <InfoRow icon={Phone} label="Phone" value={d.phone} />
            <InfoRow icon={Phone} label="WhatsApp" value={d.whatsapp} />
            <InfoRow icon={Globe} label="Website" value={d.website} />
            <InfoRow icon={MapPin} label="Emirate" value={d.emirate} />
            <InfoRow icon={MapPin} label="Address" value={d.address} />
            <InfoRow icon={FileText} label="Trade License" value={d.trade_license_no} />
            <InfoRow icon={Building2} label="Owner Email" value={ownerEmail} />
          </div>
        </div>

        {/* Card 2: Members */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">
              Members
            </p>
            {d.members && d.members.length > 0 && (
              <span className="text-[10px] font-semibold text-white/40 bg-white/[0.06] border border-white/10 rounded-full px-2 py-0.5">
                {d.members.length}
              </span>
            )}
          </div>

          {(!d.members || d.members.length === 0) ? (
            <p className="text-sm text-white/30 italic">No members found.</p>
          ) : (
            <div className="space-y-3">
              {d.members.map((m, idx) => {
                const firstName = m.user?.first_name || '';
                const lastName = m.user?.last_name || '';
                const fullName = [firstName, lastName].filter(Boolean).join(' ') || m.user?.email || '—';
                const avatarInitial = (firstName || m.user?.email || '?').slice(0, 1).toUpperCase();

                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: idx * 0.04 }}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] transition"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-white/60">{avatarInitial}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white/70 font-medium truncate">{fullName}</span>
                        <RoleBadge role={m.role} />
                      </div>
                      <p className="text-[11px] text-white/30 truncate">{m.user?.email || '—'}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] text-white/25 tabular-nums">{formatRelativeTime(m.joined_at)}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* Card 3: Quick actions */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5 flex flex-col gap-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-1">
            Quick Actions
          </p>

          <Link
            to={`/admin/dealerships/audit-log?dealership_id=${id}`}
            className="inline-flex items-center gap-2.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-xl px-4 py-3 text-sm border border-white/10 transition"
          >
            <ClipboardList size={15} className="text-white/30 flex-shrink-0" />
            <span>View audit log for this dealership</span>
          </Link>

          {ownerMember?.user?.id && (
            <Link
              to={`/admin/dealers/${ownerMember.user.id}`}
              className="inline-flex items-center gap-2.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-emerald-300 rounded-xl px-4 py-3 text-sm border border-white/10 transition"
            >
              <FileText size={15} className="text-white/30 flex-shrink-0" />
              <span>Review owner documents and request more info</span>
            </Link>
          )}

          <button
            onClick={() => navigate(`/dealer/dashboard?as=${id}`)}
            className="inline-flex items-center gap-2.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-xl px-4 py-3 text-sm border border-white/10 transition text-left"
          >
            <ExternalLink size={15} className="text-white/30 flex-shrink-0" />
            <span>Open panel as this dealership</span>
          </button>

          <div className="flex-1" />

          {d.status === 'suspended' ? (
            <button
              disabled={actionBusy}
              onClick={() => handleAction('restore')}
              className="w-full inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2.5 text-sm border border-white/10 transition font-semibold disabled:opacity-50"
            >
              {actionBusy ? 'Working…' : 'Restore dealership'}
            </button>
          ) : (
            <button
              disabled={actionBusy}
              onClick={() => handleAction('suspend')}
              className="w-full inline-flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-4 py-2.5 text-sm transition font-semibold disabled:opacity-50"
            >
              {actionBusy ? 'Working…' : 'Suspend dealership'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default AdminDealershipDetail;
