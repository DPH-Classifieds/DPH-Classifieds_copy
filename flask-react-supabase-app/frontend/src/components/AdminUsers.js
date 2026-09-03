import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, Users, ShieldCheck, Store, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { GlassCard, EmptyState } from './ui/dashboard';
import ReasonModal from './admin/ReasonModal';

const PRIMARY_SUPER_ADMIN_EMAIL = 'admin@dphclassifieds.com';
const PRIMARY_SUPER_ADMIN_USERNAME = 'dphclassifieds';

const normalizeIdentity = (value) =>
  String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const isProtectedSuperAdmin = (userRecord) =>
  Boolean(
    userRecord?.is_super_admin
    || normalizeIdentity(userRecord?.email) === normalizeIdentity(PRIMARY_SUPER_ADMIN_EMAIL)
    || normalizeIdentity(userRecord?.username) === normalizeIdentity(PRIMARY_SUPER_ADMIN_USERNAME)
  );

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

const RoleBadge = ({ u }) => {
  if (isProtectedSuperAdmin(u) || u.is_super_admin) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.10em] border bg-emerald-500/10 text-emerald-300 border-emerald-500/20">
        Super Admin
      </span>
    );
  }
  if (u.is_admin) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.10em] border bg-emerald-500/10 text-emerald-300 border-emerald-500/20">
        Admin
      </span>
    );
  }
  if (u.is_dealer) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.10em] border bg-blue-500/10 text-blue-300 border-blue-500/20">
        Dealer
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.10em] border bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)] border-[color:var(--ex-shell-line)]">
      User
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const s = String(status || 'active').toLowerCase();
  const map = {
    active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    suspended: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    banned: 'bg-rose-600/15 text-rose-300 border-rose-600/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize border ${map[s] || 'bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)] border-[color:var(--ex-shell-line)]'}`}>
      {s}
    </span>
  );
};

const VerificationBadge = ({ label, verified }) => (
  <span
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
      verified
        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
        : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
    }`}
  >
    {verified ? <ShieldCheck size={10} /> : <AlertTriangle size={10} />}
    {label}
  </span>
);

const SkeletonRow = () => (
  <tr className="border-b border-[color:var(--ex-shell-line)] animate-pulse">
    {[...Array(8)].map((_, i) => (
      <td key={i} className="px-4 py-3">
        <div className="h-3 bg-[color:var(--ex-shell-surface)] rounded-full w-full" />
      </td>
    ))}
  </tr>
);

const ROLE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'admin', label: 'Admin' },
  { key: 'dealer', label: 'Dealer' },
  { key: 'regular', label: 'Regular' },
];

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'banned', label: 'Banned' },
];

const summarizeArchiveCounts = (counts) => {
  if (!counts || typeof counts !== 'object') return '';
  const parts = Object.entries(counts)
    .filter(([, n]) => Number(n) > 0)
    .map(([type, n]) => `${n} ${type}${Number(n) === 1 ? '' : 's'}`);
  return parts.length ? ` (archived ${parts.join(', ')})` : '';
};

const AdminUsers = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalState, setModalState] = useState({ open: false, action: null, user: null });
  const [modalBusy, setModalBusy] = useState(false);

  const flashSuccess = useCallback((msg) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  }, []);

  const fetchUsers = useCallback(async ({ withSpinner = false } = {}) => {
    try {
      if (withSpinner) setLoading(true);
      const pageSize = 200;
      let offset = 0;
      let fetchedTotal = null;
      let aggregatedUsers = [];

      while (fetchedTotal === null || aggregatedUsers.length < fetchedTotal) {
        const response = await apiClient.get(
          `/api/admin/users?limit=${pageSize}&offset=${offset}`
        );
        const pageUsers = Array.isArray(response?.users)
          ? response.users
          : (Array.isArray(response) ? response : []);

        aggregatedUsers = aggregatedUsers.concat(pageUsers);
        fetchedTotal = Number.isFinite(response?.total) ? response.total : pageUsers.length;

        if (!pageUsers.length || pageUsers.length < pageSize) {
          break;
        }
        offset += pageSize;
      }

      setUsers(aggregatedUsers);
      setTotalUsers(fetchedTotal ?? aggregatedUsers.length);
      setError(null);
    } catch (err) {
      setError('Failed to fetch users');
      console.error('Error fetching users:', err);
    } finally {
      if (withSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers({ withSpinner: true });
  }, [fetchUsers]);

  const handleMakeAdmin = async (userId) => {
    try {
      await apiClient.post(`/api/admin/users/${userId}/make-admin`);
      flashSuccess('User has been made an admin successfully');
      await fetchUsers();
    } catch (err) {
      setError('Failed to make user admin');
      console.error('Error making user admin:', err);
    }
  };

  const handleRemoveAdmin = async (userId) => {
    try {
      await apiClient.post(`/api/admin/users/${userId}/remove-admin`);
      flashSuccess('Admin privileges removed successfully');
      await fetchUsers();
    } catch (err) {
      setError('Failed to remove admin privileges');
      console.error('Error removing admin:', err);
    }
  };

  const openActionModal = (action, userRecord) => {
    setError(null);
    setModalState({ open: true, action, user: userRecord });
  };

  const closeActionModal = () => {
    if (modalBusy) return;
    setModalState({ open: false, action: null, user: null });
  };

  const handleModalConfirm = async (reason) => {
    const { action, user: target } = modalState;
    if (!action || !target) return;
    setModalBusy(true);
    try {
      let response;
      if (action === 'suspend') {
        response = await apiClient.patch(`/api/admin/users/${target.id}/status`, {
          status: 'suspended',
          reason,
        });
        flashSuccess(`User suspended${summarizeArchiveCounts(response?.archive_counts)}`);
      } else if (action === 'ban') {
        response = await apiClient.patch(`/api/admin/users/${target.id}/status`, {
          status: 'banned',
          reason,
        });
        flashSuccess(`User banned${summarizeArchiveCounts(response?.archive_counts)}`);
      } else if (action === 'reactivate') {
        response = await apiClient.patch(`/api/admin/users/${target.id}/status`, {
          status: 'active',
        });
        flashSuccess('User reactivated');
      } else if (action === 'delete') {
        // apiClient.delete does not currently support a body — pass reason via querystring.
        response = await apiClient.delete(
          `/api/admin/users/${target.id}?reason=${encodeURIComponent(reason)}`
        );
        flashSuccess(`User deleted${summarizeArchiveCounts(response?.archive_counts)}`);
      }
      setModalState({ open: false, action: null, user: null });
      await fetchUsers();
    } catch (err) {
      const fallback = {
        suspend: 'Failed to suspend user',
        ban: 'Failed to ban user',
        reactivate: 'Failed to reactivate user',
        delete: 'Failed to delete user',
      }[action] || 'Action failed';
      setError(err?.message || fallback);
      console.error('Action failed:', err);
    } finally {
      setModalBusy(false);
    }
  };

  const userSummary = useMemo(() => {
    const total = totalUsers || users.length;
    const admins = users.filter((u) => u.is_admin).length;
    const dealers = users.filter((u) => u.is_dealer).length;
    const suspended = users.filter((u) => (u.account_status || 'active') === 'suspended').length;
    const banned = users.filter((u) => (u.account_status || 'active') === 'banned').length;
    const verified = users.filter((u) => u.email_verified && u.phone_verified).length;
    return { total, admins, dealers, suspended, banned, verified };
  }, [totalUsers, users]);

  const getDisplayName = (u) => {
    if (u.display_name) return u.display_name;
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`;
    if (u.first_name) return u.first_name;
    if (u.username) return u.username;
    return u.email;
  };

  const getInitials = (u) => {
    if (u.first_name && u.last_name) return `${u.first_name[0]}${u.last_name[0]}`.toUpperCase();
    if (u.first_name) return u.first_name[0].toUpperCase();
    if (u.username) return u.username[0].toUpperCase();
    if (u.email) return u.email[0].toUpperCase();
    return 'U';
  };

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = searchQuery.toLowerCase();
      const matchSearch = !q || (
        u.email?.toLowerCase().includes(q) ||
        u.first_name?.toLowerCase().includes(q) ||
        u.last_name?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q) ||
        u.display_name?.toLowerCase().includes(q) ||
        u.phone?.toLowerCase().includes(q)
      );
      const matchRole =
        roleFilter === 'all' ||
        (roleFilter === 'admin' && u.is_admin) ||
        (roleFilter === 'dealer' && u.is_dealer) ||
        (roleFilter === 'regular' && !u.is_admin && !u.is_dealer);
      const status = (u.account_status || 'active');
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && status === 'active') ||
        (statusFilter === 'suspended' && status === 'suspended') ||
        (statusFilter === 'banned' && status === 'banned');
      return matchSearch && matchRole && matchStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  const ChipFilter = ({ options, active, onSelect }) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onSelect(opt.key)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
            active === opt.key
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)] border-[color:var(--ex-shell-line)] hover:text-[color:var(--ex-shell-text)]/70 hover:bg-[color:var(--ex-shell-surface-strong)]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-[color:var(--ex-shell-text)]">Users</h1>
          <p className="text-sm text-[color:var(--ex-shell-text-muted)] mt-1">Search every account, manage roles, and suspend accounts.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text-muted)] border border-[color:var(--ex-shell-line)]">
            {userSummary.total} total
          </span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: userSummary.total, icon: Users },
          { label: 'Admins', value: userSummary.admins, icon: ShieldCheck },
          { label: 'Dealers', value: userSummary.dealers, icon: Store },
          { label: 'Suspended', value: userSummary.suspended, icon: null },
          { label: 'Banned', value: userSummary.banned, icon: null },
        ].map((kpi) => (
          <GlassCard key={kpi.label} className="flex flex-col gap-1">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium">{kpi.label}</p>
            <p className="text-2xl font-semibold text-[color:var(--ex-shell-text)]">{kpi.value.toLocaleString()}</p>
          </GlassCard>
        ))}
      </div>

      {/* Filters */}
      <GlassCard className="space-y-4">
        <input
          type="text"
          placeholder="Search by name, email, username, or phone…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-lg px-3 py-2 text-sm text-[color:var(--ex-shell-text)] placeholder:text-[color:var(--ex-shell-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <div className="flex flex-wrap gap-6">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium">Role</p>
            <ChipFilter options={ROLE_FILTERS} active={roleFilter} onSelect={setRoleFilter} />
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium">Status</p>
            <ChipFilter options={STATUS_FILTERS} active={statusFilter} onSelect={setStatusFilter} />
          </div>
        </div>
        {(error || success) && (
          <div className={`px-3 py-2 rounded-lg text-sm border ${error ? 'bg-rose-500/10 text-rose-300 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'}`}>
            {error || success}
          </div>
        )}
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--ex-shell-line)]">
                {['User', 'Role', 'Status', 'Verification', 'Listings', 'Joined', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
                : filteredUsers.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} className="py-0">
                        <EmptyState icon={Users} title="No users match your filters." />
                      </td>
                    </tr>
                  )
                  : filteredUsers.map((u, i) => {
                    const displayName = getDisplayName(u);
                    const initials = getInitials(u);
                    const accountStatus = u.account_status || 'active';
                    const isSuspended = accountStatus === 'suspended';
                    const isBanned = accountStatus === 'banned';
                    const isInactive = isSuspended || isBanned;
                    const listingCount = u.listing_count ?? u.listings_count ?? null;
                    const fullyVerified = Boolean(u.email_verified && u.phone_verified);
                    const isSelf = u.id === user?.id;
                    const isProtected = isSelf || isProtectedSuperAdmin(u);

                    return (
                      <motion.tr
                        key={u.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-[color:var(--ex-shell-line)] hover:bg-[color:var(--ex-shell-surface)] transition-colors group"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {u.profile_photo_url ? (
                              <img
                                src={u.profile_photo_url}
                                alt={displayName}
                                className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-[color:var(--ex-shell-surface-strong)] flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-semibold text-[color:var(--ex-shell-text-muted)]">{initials}</span>
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-[color:var(--ex-shell-text)] font-medium text-sm truncate">{displayName}</p>
                              <p className="text-[color:var(--ex-shell-text-muted)] text-xs truncate">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><RoleBadge u={u} /></td>
                        <td className="px-4 py-3"><StatusBadge status={accountStatus} /></td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <VerificationBadge label="Email" verified={Boolean(u.email_verified)} />
                            <VerificationBadge label="Phone" verified={Boolean(u.phone_verified)} />
                            <VerificationBadge label="Dealer" verified={Boolean(u.dealer_verified)} />
                            {fullyVerified && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-500/10 text-sky-300 border-sky-500/20">
                                <ShieldCheck size={10} />
                                Fully verified
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {listingCount !== null ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)] border-[color:var(--ex-shell-line)]">
                              {listingCount}
                            </span>
                          ) : (
                            <span className="text-[color:var(--ex-shell-text-muted)] text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[color:var(--ex-shell-text-muted)] text-xs whitespace-nowrap">{relTime(u.created_at)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                              title="View user"
                              onClick={() => navigate(`/admin/users/${u.id}`)}
                              className="p-1.5 rounded-lg hover:bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] transition-colors"
                            >
                              <Eye size={15} />
                            </button>
                            {u.is_admin ? (
                              <button
                                title="Remove admin"
                                onClick={() => handleRemoveAdmin(u.id)}
                                disabled={isProtected}
                                className="px-2 py-1 rounded-full text-[10px] font-semibold border bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)] border-[color:var(--ex-shell-line)] hover:bg-[color:var(--ex-shell-surface-strong)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              >
                                Remove Admin
                              </button>
                            ) : (
                              <button
                                title="Make admin"
                                onClick={() => handleMakeAdmin(u.id)}
                                disabled={isProtectedSuperAdmin(u)}
                                className="px-2 py-1 rounded-full text-[10px] font-semibold border bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              >
                                Make Admin
                              </button>
                            )}
                            {isInactive ? (
                              <button
                                title="Reactivate user"
                                onClick={() => openActionModal('reactivate', u)}
                                disabled={isProtected}
                                className="px-2 py-1 rounded-full text-[10px] font-semibold border bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              >
                                Reactivate
                              </button>
                            ) : (
                              <button
                                title="Suspend user"
                                onClick={() => openActionModal('suspend', u)}
                                disabled={isProtected}
                                className="px-2 py-1 rounded-full text-[10px] font-semibold border bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              >
                                Suspend
                              </button>
                            )}
                            <button
                              title="Ban user"
                              onClick={() => openActionModal('ban', u)}
                              disabled={isProtected || isBanned}
                              className="px-2 py-1 rounded-full text-[10px] font-semibold border bg-rose-500/10 text-rose-300 border-rose-500/20 hover:bg-rose-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              Ban
                            </button>
                            <button
                              title="Delete user"
                              onClick={() => openActionModal('delete', u)}
                              disabled={isProtected}
                              className="p-1.5 rounded-lg text-rose-300/70 hover:text-rose-300 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
        {!loading && (
          <div className="px-4 py-3 border-t border-[color:var(--ex-shell-line)]">
            <p className="text-xs text-[color:var(--ex-shell-text-muted)]">{filteredUsers.length} users found</p>
          </div>
        )}
      </GlassCard>

      <ReasonModal
        open={modalState.open}
        action={modalState.action}
        userLabel={modalState.user ? (getDisplayName(modalState.user) + (modalState.user.email ? ` · ${modalState.user.email}` : '')) : ''}
        busy={modalBusy}
        onClose={closeActionModal}
        onConfirm={handleModalConfirm}
      />
    </div>
  );
};

export default AdminUsers;
