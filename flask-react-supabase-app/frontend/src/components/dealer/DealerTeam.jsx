import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { UserX, Users, Send, Copy, Check } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';

// ── helpers ───────────────────────────────────────────────────────────────────

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

const ROLE_BADGE = {
  owner:     'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  manager:   'text-blue-300 bg-blue-500/10 border-blue-500/20',
  sales_rep: 'text-white/50 bg-white/[0.06] border-white/10',
};

const STATUS_BADGE = {
  active:  'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  invited: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
};

// ── Avatar ────────────────────────────────────────────────────────────────────

const Avatar = ({ user }) => {
  const initials = [user?.first_name, user?.last_name]
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase() || (user?.username?.[0] || '?').toUpperCase();

  if (user?.profile_photo_url) {
    return (
      <img
        src={user.profile_photo_url}
        alt={initials}
        className="w-8 h-8 rounded-full object-cover border border-white/10 flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center flex-shrink-0">
      <span className="text-[11px] font-semibold text-white/50">{initials}</span>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const DealerTeam = () => {
  const { role } = useDealer();
  const [members, setMembers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Invite form state
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('sales_rep');
  const [sending, setSending] = useState(false);
  const [inviteLink, setInviteLink] = useState(null);
  const [inviteError, setInviteError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Revoke state
  const [revoking, setRevoking] = useState(null);

  const loadMembers = () => {
    setLoading(true);
    setError(null);
    apiClient
      .get('/api/dealer/members')
      .then((r) => { setMembers(r.members || []); setLoading(false); })
      .catch((e) => { setError(e.message || 'Failed'); setLoading(false); });
  };

  useEffect(() => { loadMembers(); }, []);

  const handleInvite = async () => {
    if (!email.trim()) return;
    setSending(true);
    setInviteError(null);
    setInviteLink(null);
    try {
      const r = await apiClient.post('/api/dealer/invitations', { email: email.trim(), role: inviteRole });
      const token = r.invitation?.token;
      if (token) {
        setInviteLink(`${window.location.origin}/dealer/invite/accept?token=${token}`);
      }
      setEmail('');
      loadMembers();
    } catch (e) {
      setInviteError(e.message || 'Failed to send invite');
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (memberId) => {
    setRevoking(memberId);
    try {
      await apiClient.delete(`/api/dealer/members/${memberId}`);
      loadMembers();
    } catch {
      // silently ignore
    } finally {
      setRevoking(null);
    }
  };

  const copyLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Owner member (don't show revoke for them)
  const ownerIds = new Set(
    (members || []).filter((m) => m.role === 'owner').map((m) => m.id)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center gap-3"
      >
        <h1 className="text-3xl font-semibold text-white">Team</h1>
        {members && (
          <span className="text-[11px] font-semibold text-white/50 bg-white/[0.06] border border-white/10 rounded-full px-2.5 py-1">
            {members.length}
          </span>
        )}
      </motion.div>

      {/* Members table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06 }}
        className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 overflow-hidden"
      >
        {loading && (
          <div className="p-5 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-12" />
            ))}
          </div>
        )}

        {error && (
          <div className="px-5 py-4 text-rose-300 text-sm">
            Failed to load team — {error}
          </div>
        )}

        {!loading && !error && members && members.length === 0 && (
          <div className="flex flex-col items-center py-12 gap-3">
            <Users size={36} className="text-white/20" />
            <p className="text-sm text-white/40">No team members yet.</p>
          </div>
        )}

        {!loading && !error && members && members.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Member', 'Email', 'Role', 'Status', 'Joined', ''].map((h) => (
                    <th
                      key={h}
                      className="text-left text-[10px] uppercase tracking-[0.14em] text-white/30 font-medium px-5 py-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {members.map((m, idx) => {
                  const name =
                    [m.user?.first_name, m.user?.last_name].filter(Boolean).join(' ') ||
                    m.user?.username ||
                    '—';
                  return (
                    <motion.tr
                      key={m.id}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: 0.08 + idx * 0.04 }}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar user={m.user} />
                          <span className="text-sm text-white/70">{name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-white/40">
                        {m.user?.email || '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${
                            ROLE_BADGE[m.role] || 'text-white/40 bg-white/[0.06] border-white/10'
                          }`}
                        >
                          {m.role?.replace('_', ' ') || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${
                            STATUS_BADGE[m.status] || 'text-white/40 bg-white/[0.06] border-white/10'
                          }`}
                        >
                          {m.status || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-white/30 tabular-nums">
                        {formatRelativeTime(m.joined_at || m.invited_at)}
                      </td>
                      <td className="px-5 py-3">
                        {role === 'owner' && !ownerIds.has(m.id) && (
                          <button
                            onClick={() => handleRevoke(m.id)}
                            disabled={revoking === m.id}
                            title="Revoke access"
                            className="p-1.5 rounded-lg text-white/25 hover:text-rose-400 hover:bg-rose-500/10 transition disabled:opacity-40"
                          >
                            <UserX size={14} />
                          </button>
                        )}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Invite section (owner only) */}
      {role === 'owner' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12 }}
          className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
        >
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-4">
            Invite a teammate
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition"
            >
              <option value="manager">Manager</option>
              <option value="sales_rep">Sales rep</option>
            </select>
            <button
              onClick={handleInvite}
              disabled={sending || !email.trim()}
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send size={13} />
              {sending ? 'Sending…' : 'Send invite'}
            </button>
          </div>

          {inviteError && (
            <p className="mt-3 text-xs text-rose-300">{inviteError}</p>
          )}

          {inviteLink && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-4"
            >
              <p className="text-[10px] uppercase tracking-[0.12em] text-white/30 font-medium mb-2">
                Invite link
              </p>
              <div className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2">
                <code className="text-xs text-emerald-300/80 flex-1 truncate break-all">
                  {inviteLink}
                </code>
                <button
                  onClick={copyLink}
                  className="flex-shrink-0 p-1 rounded text-white/40 hover:text-white transition"
                  title="Copy link"
                >
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default DealerTeam;
