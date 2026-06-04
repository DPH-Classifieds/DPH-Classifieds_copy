import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, Users, ShieldCheck, Store } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { GlassCard, EmptyState } from './ui/dashboard';

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
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.10em] border bg-white/5 text-white/50 border-white/10">
      User
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const s = String(status || 'active').toLowerCase();
  const map = {
    active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    suspended: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    banned: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize border ${map[s] || 'bg-white/5 text-white/40 border-white/10'}`}>
      {s}
    </span>
  );
};

const SkeletonRow = () => (
  <tr className="border-b border-white/[0.04] animate-pulse">
    {[...Array(7)].map((_, i) => (
      <td key={i} className="px-4 py-3">
        <div className="h-3 bg-white/5 rounded-full w-full" />
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
];

const AdminUsers = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get('/api/admin/users');
        setUsers(Array.isArray(response) ? response : []);
        setError(null);
      } catch (err) {
        setError('Failed to fetch users');
        console.error('Error fetching users:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const handleMakeAdmin = async (userId) => {
    try {
      await apiClient.post(`/api/admin/users/${userId}/make-admin`);
      setSuccess('User has been made an admin successfully');
      const response = await apiClient.get('/api/admin/users');
      setUsers(Array.isArray(response) ? response : []);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to make user admin');
      console.error('Error making user admin:', err);
    }
  };

  const handleRemoveAdmin = async (userId) => {
    try {
      await apiClient.post(`/api/admin/users/${userId}/remove-admin`);
      setSuccess('Admin privileges removed successfully');
      const response = await apiClient.get('/api/admin/users');
      setUsers(Array.isArray(response) ? response : []);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to remove admin privileges');
      console.error('Error removing admin:', err);
    }
  };

  const handleStatusChange = async (userId, nextStatus) => {
    try {
      await apiClient.patch(`/api/admin/users/${userId}/status`, { status: nextStatus });
      const response = await apiClient.get('/api/admin/users');
      setUsers(Array.isArray(response) ? response : []);
      setSuccess(`User ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'} successfully`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to update user status');
      console.error('Error updating user status:', err);
    }
  };

  const userSummary = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.is_admin).length;
    const dealers = users.filter((u) => u.is_dealer).length;
    const suspended = users.filter((u) => (u.account_status || 'active') === 'suspended' || (u.account_status || 'active') === 'banned').length;
    const verified = users.filter((u) => u.email_verified && u.phone_verified).length;
    return { total, admins, dealers, suspended, verified };
  }, [users]);

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
      const matchStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && (u.account_status || 'active') === 'active') ||
        (statusFilter === 'suspended' && ((u.account_status || 'active') === 'suspended' || (u.account_status || 'active') === 'banned'));
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
              : 'bg-white/[0.04] text-white/50 border-white/10 hover:text-white/70 hover:bg-white/[0.07]'
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
          <h1 className="text-3xl font-semibold text-white">Users</h1>
          <p className="text-sm text-white/50 mt-1">Search every account, manage roles, and suspend accounts.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/[0.06] text-white/60 border border-white/10">
            {userSummary.total} total
          </span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: userSummary.total, icon: Users },
          { label: 'Admins', value: userSummary.admins, icon: ShieldCheck },
          { label: 'Dealers', value: userSummary.dealers, icon: Store },
          { label: 'Suspended', value: userSummary.suspended, icon: null },
        ].map((kpi) => (
          <GlassCard key={kpi.label} className="flex flex-col gap-1">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">{kpi.label}</p>
            <p className="text-2xl font-semibold text-white">{kpi.value.toLocaleString()}</p>
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
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <div className="flex flex-wrap gap-6">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">Role</p>
            <ChipFilter options={ROLE_FILTERS} active={roleFilter} onSelect={setRoleFilter} />
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">Status</p>
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
              <tr className="border-b border-white/[0.06]">
                {['User', 'Role', 'Status', 'Listings', 'Joined', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium whitespace-nowrap">
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
                    const isSuspended = accountStatus === 'suspended' || accountStatus === 'banned';
                    const listingCount = u.listing_count ?? u.listings_count ?? null;

                    return (
                      <motion.tr
                        key={u.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors group"
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
                              <div className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                                <span className="text-xs font-semibold text-white/60">{initials}</span>
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-white/80 font-medium text-sm truncate">{displayName}</p>
                              <p className="text-white/40 text-xs truncate">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><RoleBadge u={u} /></td>
                        <td className="px-4 py-3"><StatusBadge status={accountStatus} /></td>
                        <td className="px-4 py-3">
                          {listingCount !== null ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-white/5 text-white/50 border-white/10">
                              {listingCount}
                            </span>
                          ) : (
                            <span className="text-white/30 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white/40 text-xs whitespace-nowrap">{relTime(u.created_at)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                              title="View user"
                              onClick={() => navigate(`/admin/users/${u.id}`)}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                            >
                              <Eye size={15} />
                            </button>
                            {u.is_admin ? (
                              <button
                                title="Remove admin"
                                onClick={() => handleRemoveAdmin(u.id)}
                                disabled={u.id === user?.id || isProtectedSuperAdmin(u)}
                                className="px-2 py-1 rounded-full text-[10px] font-semibold border bg-white/5 text-white/50 border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                            <button
                              title={isSuspended ? 'Activate' : 'Suspend'}
                              onClick={() => handleStatusChange(u.id, isSuspended ? 'active' : 'suspended')}
                              disabled={u.id === user?.id || isProtectedSuperAdmin(u)}
                              className={`px-2 py-1 rounded-full text-[10px] font-semibold border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                                isSuspended
                                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-300 border-rose-500/20 hover:bg-rose-500/20'
                              }`}
                            >
                              {isSuspended ? 'Activate' : 'Suspend'}
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
          <div className="px-4 py-3 border-t border-white/[0.06]">
            <p className="text-xs text-white/30">{filteredUsers.length} users found</p>
          </div>
        )}
      </GlassCard>
    </div>
  );
};

export default AdminUsers;
