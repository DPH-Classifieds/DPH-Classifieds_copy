import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  ShieldCheck,
  Building2,
  BarChart2,
  Activity,
  Flag,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import apiClient from '../utils/apiClient';
import { GlassCard, KpiTile, EmptyState } from './ui/dashboard';
import {
  formatCurrencyAED,
  formatDate,
  formatDateTime,
  formatNumber,
  getDisplayName,
  getEventActorLabel,
  getListingTitle,
  getStatusTone,
} from './admin/adminUtils';

/* ── constants ────────────────────────────────────────────────────────────── */
const PRIMARY_SUPER_ADMIN_EMAIL = 'admin@dphclassifieds.com';
const PRIMARY_SUPER_ADMIN_USERNAME = 'dphclassifieds';
const defaultActionState = { status: 'active', reason: '' };

const normalizeIdentity = (value) =>
  String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const isProtectedSuperAdmin = (userRecord) =>
  Boolean(
    userRecord?.is_super_admin ||
    normalizeIdentity(userRecord?.email) === normalizeIdentity(PRIMARY_SUPER_ADMIN_EMAIL) ||
    normalizeIdentity(userRecord?.username) === normalizeIdentity(PRIMARY_SUPER_ADMIN_USERNAME)
  );

/* ── small helpers ────────────────────────────────────────────────────────── */
const statusBadgeClass = (status) => {
  const t = getStatusTone(status);
  if (t === 'success') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (t === 'danger') return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
};

const Badge = ({ children, className = '' }) => (
  <span className={`text-[10px] font-semibold rounded-full border px-2.5 py-1 ${className}`}>
    {children}
  </span>
);

const SectionLabel = ({ children }) => (
  <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-3">{children}</p>
);

const InfoRow = ({ icon: Icon, label, value }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={12} className="text-white/30" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-white/30 font-medium">{label}</p>
        <p className="text-sm text-white/70 mt-0.5">{value}</p>
      </div>
    </div>
  );
};

/* ── loading skeleton ─────────────────────────────────────────────────────── */
const Skeleton = () => (
  <div className="text-white space-y-5 animate-pulse">
    <div className="h-4 w-32 bg-white/[0.06] rounded-lg" />
    <div className="h-9 w-64 bg-white/[0.06] rounded-xl" />
    <div className="grid grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => <div key={i} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 h-28" />)}
    </div>
    <div className="grid grid-cols-3 gap-5">
      <div className="col-span-2 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 h-64" />
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 h-64" />
    </div>
  </div>
);

const USER_TABS = ['Listings', 'Activity', 'Reports'];

/* ═══════════════════════════════════════════════════════════════════════════ */

const AdminUserDetail = () => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [actionState, setActionState] = useState(defaultActionState);
  const [profileState, setProfileState] = useState({
    account_status: 'active',
    is_admin: false,
    is_dealer: false,
    dealer_verified: false,
    email_verified: false,
    phone_verified: false,
    rejection_note: '',
  });
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('Listings');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await apiClient.get(`/api/admin/users/${userId}/overview`);
        setData(response || null);
        setActionState((cur) => ({
          ...cur,
          status: response?.user?.account_status || 'active',
          reason: response?.user?.rejection_note || '',
        }));
        setProfileState({
          account_status: response?.user?.account_status || 'active',
          is_admin: Boolean(response?.user?.is_admin),
          is_dealer: Boolean(response?.user?.is_dealer),
          dealer_verified: Boolean(response?.user?.dealer_verified),
          email_verified: Boolean(response?.user?.email_verified),
          phone_verified: Boolean(response?.user?.phone_verified),
          rejection_note: response?.user?.rejection_note || '',
        });
      } catch (fetchError) {
        console.error('Failed to load user overview:', fetchError);
        setError(fetchError.message || 'Failed to load user overview');
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [userId]);

  const summary = data?.summary || {};
  const user = data?.user || {};
  const recentListings = data?.recent_listings || [];
  const recentEvents = data?.recent_events || [];
  const recentReports = data?.recent_reports || [];
  const isSuperAdmin = isProtectedSuperAdmin(user);

  const handleProfileSave = async () => {
    if (isSuperAdmin) {
      setMessage('This protected super admin account cannot be modified here.');
      return;
    }
    try {
      setActionLoading(true);
      setMessage('');
      await apiClient.patch(`/api/admin/users/${userId}/profile`, {
        account_status: profileState.account_status,
        is_admin: profileState.is_admin,
        is_dealer: profileState.is_dealer,
        dealer_verified: profileState.dealer_verified,
        email_verified: profileState.email_verified,
        phone_verified: profileState.phone_verified,
        rejection_note: actionState.reason,
      });
      setMessage('User profile updated successfully.');
      const refreshed = await apiClient.get(`/api/admin/users/${userId}/overview`);
      setData(refreshed || null);
      setActionState((cur) => ({
        ...cur,
        status: refreshed?.user?.account_status || profileState.account_status,
        reason: refreshed?.user?.rejection_note || actionState.reason,
      }));
      setProfileState({
        account_status: refreshed?.user?.account_status || profileState.account_status,
        is_admin: Boolean(refreshed?.user?.is_admin),
        is_dealer: Boolean(refreshed?.user?.is_dealer),
        dealer_verified: Boolean(refreshed?.user?.dealer_verified),
        email_verified: Boolean(refreshed?.user?.email_verified),
        phone_verified: Boolean(refreshed?.user?.phone_verified),
        rejection_note: refreshed?.user?.rejection_note || actionState.reason || '',
      });
    } catch (saveError) {
      setError(saveError.message || 'Failed to update user profile');
    } finally {
      setActionLoading(false);
    }
  };

  const listingTypeCounts = useMemo(() =>
    Object.entries(data?.listing_summary || {}).map(([type, bucket]) => ({
      type,
      count: bucket.count || 0,
      views: bucket.views || 0,
      approved: bucket.approved || 0,
      pending: bucket.pending || 0,
      rejected: bucket.rejected || 0,
    }))
  , [data]);

  /* ── avatar initials ──────────────────────────────────────────────────── */
  const displayName = getDisplayName(user);
  const initial = displayName ? displayName.slice(0, 2).toUpperCase() : '??';

  if (loading) return <Skeleton />;

  if (error && !data) {
    return (
      <div className="text-white flex flex-col items-center justify-center py-24 gap-4">
        <User size={48} className="text-white/20" />
        <p className="text-lg font-semibold text-white/70">User not available</p>
        <p className="text-sm text-white/40">{error}</p>
        <button
          onClick={() => navigate('/admin/users')}
          className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-emerald-400 transition-colors mt-2"
        >
          <ArrowLeft size={14} /> Back to users
        </button>
      </div>
    );
  }

  const memberSince = user.created_at
    ? new Date(user.created_at).getFullYear()
    : '—';

  return (
    <div className="text-white space-y-5">

      {/* Breadcrumb */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-emerald-400 transition-colors"
        >
          <ArrowLeft size={14} /> Back to users
        </Link>
      </motion.div>

      {/* Hero card */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <GlassCard>
          <div className="flex items-start gap-5 flex-wrap">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-2xl font-bold text-emerald-400">{initial}</span>
            </div>

            {/* Identity */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h1 className="text-3xl font-semibold text-white">{displayName}</h1>
                <Badge className={statusBadgeClass(user.account_status)}>
                  {user.account_status || 'active'}
                </Badge>
                {user.is_admin && (
                  <Badge className="text-amber-300 bg-amber-500/10 border-amber-500/20">Admin</Badge>
                )}
                {isSuperAdmin && (
                  <Badge className="text-purple-300 bg-purple-500/10 border-purple-500/20">Super Admin</Badge>
                )}
                {user.is_dealer && (
                  <Badge className="text-sky-300 bg-sky-500/10 border-sky-500/20">Dealer</Badge>
                )}
              </div>
              <p className="text-sm text-white/50">{user.email || 'No email'}</p>
              <p className="text-xs text-white/30 mt-1">
                Member since {memberSince}
                {user.last_login_at && ` · Last login ${formatDateTime(user.last_login_at)}`}
              </p>
            </div>

            {/* Email / Phone verification badges */}
            <div className="flex gap-2 flex-wrap">
              {user.email_verified
                ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1"><CheckCircle size={10} /> Email verified</span>
                : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-2.5 py-1"><AlertTriangle size={10} /> Email unverified</span>
              }
              {user.phone_verified
                ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1"><CheckCircle size={10} /> Phone verified</span>
                : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-2.5 py-1"><AlertTriangle size={10} /> Phone unverified</span>
              }
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* KPI row */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <KpiTile label="Total Listings" value={summary.total_listings ?? 0} icon={BarChart2} />
        <KpiTile label="Total Views" value={summary.total_views ?? 0} icon={Activity} />
        <KpiTile label="Qualified Leads" value={summary.qualified_leads ?? 0} icon={Phone} />
        <KpiTile label="Reports" value={summary.report_count ?? 0} icon={Flag} />
      </motion.div>

      {message && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300"
        >
          {message}
        </motion.div>
      )}

      {/* Main: tabs (2/3) + admin actions (1/3) */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-5"
      >
        {/* Left: tabbed content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tab switcher */}
          <div className="flex gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1 w-fit">
            {USER_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Listings tab */}
          {activeTab === 'Listings' && (
            <div className="space-y-4">
              {/* Per-type breakdown */}
              {listingTypeCounts.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {listingTypeCounts.map((bucket) => (
                    <GlassCard key={bucket.type}>
                      <SectionLabel>{bucket.type}</SectionLabel>
                      <p className="text-3xl font-semibold text-white tabular-nums">{formatNumber(bucket.count)}</p>
                      <p className="text-xs text-white/40 mt-2">
                        {formatNumber(bucket.views)} views · {formatNumber(bucket.approved)} approved · {formatNumber(bucket.pending)} pending
                      </p>
                    </GlassCard>
                  ))}
                </div>
              )}

              {/* Listings table */}
              <GlassCard>
                <SectionLabel>Recent listings</SectionLabel>
                {recentListings.length === 0 ? (
                  <EmptyState
                    icon={BarChart2}
                    title="No listings"
                    description="This user hasn't posted any listings yet."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.06]">
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Listing</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Type</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Status</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Views</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Price</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Created</th>
                          <th className="pb-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {recentListings.map((lst) => (
                          <tr key={`${lst.type}-${lst.id}`} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition">
                            <td className="py-2.5">
                              <span className="text-white/70 font-medium truncate max-w-[180px] block">{getListingTitle(lst)}</span>
                            </td>
                            <td className="py-2.5 text-white/50 capitalize">{lst.type}</td>
                            <td className="py-2.5">
                              <Badge className={statusBadgeClass(lst.status)}>{lst.status}</Badge>
                            </td>
                            <td className="py-2.5 text-white/50 tabular-nums">{formatNumber(lst.view_count)}</td>
                            <td className="py-2.5 text-white/50 tabular-nums">{formatCurrencyAED(lst.price)}</td>
                            <td className="py-2.5 text-white/40 text-xs">{formatDate(lst.created_at)}</td>
                            <td className="py-2.5">
                              <Link
                                to={`/admin/listings/${lst.type}/${lst.id}`}
                                className="text-emerald-400 hover:text-emerald-300 text-xs font-medium transition"
                              >
                                →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassCard>
            </div>
          )}

          {/* Activity tab */}
          {activeTab === 'Activity' && (
            <GlassCard>
              <SectionLabel>Recent platform events</SectionLabel>
              {recentEvents.length === 0 ? (
                <EmptyState
                  icon={Activity}
                  title="No recent activity"
                  description="No platform events recorded for this user yet."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Actor</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Context</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Action</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentEvents.slice(0, 12).map((event) => (
                        <tr key={event.id} className="border-b border-white/[0.04] last:border-0">
                          <td className="py-2.5 text-white/70">{getEventActorLabel(event)}</td>
                          <td className="py-2.5 text-white/50">{event.listing_type} · {event.listing_id}</td>
                          <td className="py-2.5">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300">
                              {event.action}
                            </span>
                          </td>
                          <td className="py-2.5 text-white/40 text-xs">{formatDateTime(event.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          )}

          {/* Reports tab */}
          {activeTab === 'Reports' && (
            <GlassCard>
              <SectionLabel>Reports</SectionLabel>
              {recentReports.length === 0 ? (
                <EmptyState
                  icon={Flag}
                  title="No reports"
                  description="No reports filed by or against this user."
                  action={
                    <Link to="/admin/reports" className="text-sm text-emerald-400 hover:text-emerald-300 transition">
                      View all reports →
                    </Link>
                  }
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Listing</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Reason</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentReports.slice(0, 12).map((report) => (
                        <tr key={report.id} className="border-b border-white/[0.04] last:border-0">
                          <td className="py-2.5 text-white/70">{report.listing_type} · {report.listing_id}</td>
                          <td className="py-2.5 text-white/60">{report.reason || 'N/A'}</td>
                          <td className="py-2.5">
                            <Badge className={statusBadgeClass(report.status)}>{report.status || 'pending'}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          )}
        </div>

        {/* Right: admin actions + profile info */}
        <div className="space-y-4">
          {/* Contact info */}
          <GlassCard>
            <SectionLabel>Profile info</SectionLabel>
            <InfoRow icon={Mail} label="Email" value={user.email} />
            <InfoRow icon={Phone} label="Phone" value={user.phone} />
            <InfoRow icon={Phone} label="WhatsApp" value={user.whatsapp_number} />
            <InfoRow icon={MapPin} label="Location" value={[user.city, user.emirate].filter(Boolean).join(', ') || null} />
            <InfoRow icon={Building2} label="Company" value={user.company_name} />
            <InfoRow icon={ShieldCheck} label="Trade license" value={user.trade_license_number} />
            {user.rejection_note && (
              <div className="mt-3 p-3 rounded-xl bg-amber-500/[0.07] border border-amber-500/20">
                <p className="text-[10px] uppercase tracking-wide text-amber-300 font-medium mb-1">Internal note</p>
                <p className="text-sm text-white/70">{user.rejection_note}</p>
              </div>
            )}
          </GlassCard>

          {/* Moderation actions */}
          <GlassCard>
            <SectionLabel>Admin actions</SectionLabel>

            {isSuperAdmin && (
              <div className="mb-4 p-3 rounded-xl bg-amber-500/[0.07] border border-amber-500/20 text-xs text-amber-300">
                Protected super admin. Role and status controls are locked.
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-white/40 mb-1.5">Account status</label>
                <select
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-emerald-500/40 transition"
                  value={profileState.account_status}
                  disabled={isSuperAdmin}
                  onChange={(e) => setProfileState((c) => ({ ...c, account_status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="banned">Banned</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-1.5">Admin access</label>
                <select
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-emerald-500/40 transition"
                  value={profileState.is_admin ? 'admin' : 'user'}
                  disabled={isSuperAdmin}
                  onChange={(e) => setProfileState((c) => ({ ...c, is_admin: e.target.value === 'admin' }))}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-1.5">Account type</label>
                <select
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-emerald-500/40 transition"
                  value={profileState.is_dealer ? 'dealer' : 'private'}
                  disabled={isSuperAdmin}
                  onChange={(e) =>
                    setProfileState((c) => ({
                      ...c,
                      is_dealer: e.target.value === 'dealer',
                      dealer_verified: e.target.value === 'dealer' ? c.dealer_verified : false,
                    }))
                  }
                >
                  <option value="private">Private owner</option>
                  <option value="dealer">Dealer</option>
                </select>
              </div>

              {profileState.is_dealer && (
                <div>
                  <label className="block text-xs text-white/40 mb-1.5">Dealer verification</label>
                  <select
                    className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-emerald-500/40 transition"
                    value={profileState.dealer_verified ? 'verified' : 'pending'}
                    disabled={isSuperAdmin}
                    onChange={(e) => setProfileState((c) => ({ ...c, dealer_verified: e.target.value === 'verified' }))}
                  >
                    <option value="pending">Pending</option>
                    <option value="verified">Verified</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-white/40 mb-1.5">Email verification</label>
                <select
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-emerald-500/40 transition"
                  value={profileState.email_verified ? 'verified' : 'unverified'}
                  disabled={isSuperAdmin}
                  onChange={(e) => setProfileState((c) => ({ ...c, email_verified: e.target.value === 'verified' }))}
                >
                  <option value="unverified">Unverified</option>
                  <option value="verified">Verified</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-1.5">Phone verification</label>
                <select
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm text-white/70 focus:outline-none focus:border-emerald-500/40 transition"
                  value={profileState.phone_verified ? 'verified' : 'unverified'}
                  disabled={isSuperAdmin}
                  onChange={(e) => setProfileState((c) => ({ ...c, phone_verified: e.target.value === 'verified' }))}
                >
                  <option value="unverified">Unverified</option>
                  <option value="verified">Verified</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-white/40 mb-1.5">Reason / note</label>
                <textarea
                  rows={3}
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-xl px-3 py-2.5 text-sm text-white/70 placeholder-white/25 resize-none focus:outline-none focus:border-emerald-500/40 transition"
                  value={actionState.reason}
                  disabled={isSuperAdmin}
                  onChange={(e) => setActionState((c) => ({ ...c, reason: e.target.value }))}
                  placeholder="Add reason for this action…"
                />
              </div>

              {error && <p className="text-xs text-rose-300">{error}</p>}

              <button
                type="button"
                disabled={actionLoading || isSuperAdmin}
                onClick={handleProfileSave}
                className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-xl px-4 py-3 text-sm transition disabled:opacity-40"
              >
                {actionLoading ? 'Saving…' : 'Save changes'}
              </button>

              <button
                type="button"
                onClick={() => navigate('/admin/listings')}
                className="w-full inline-flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 rounded-xl px-4 py-3 text-sm transition"
              >
                Review listings
              </button>
            </div>
          </GlassCard>
        </div>
      </motion.div>
    </div>
  );
};

export default AdminUserDetail;
