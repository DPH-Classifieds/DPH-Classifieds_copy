import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Mail, CheckCircle2, AlertCircle } from 'lucide-react';
import apiClient from '../../utils/apiClient';

const DealerInviteAccept = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');

  const handleAccept = async () => {
    if (!token) return;
    setStatus('loading');
    setErrorMsg('');
    try {
      await apiClient.post('/api/dealer/invitations/accept', { token });
      setStatus('success');
      setTimeout(() => navigate('/dealer/dashboard'), 1200);
    } catch (e) {
      setStatus('error');
      setErrorMsg(e.message || 'Something went wrong. The invite may have expired or already been used.');
    }
  };

  return (
    <div className="min-h-screen bg-[color:var(--ex-shell-bg)] flex items-center justify-center px-4 py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="w-full max-w-[480px] bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-8"
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Mail size={26} className="text-emerald-400" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white mb-1">Dealership Invitation</h1>
            <p className="text-sm text-white/45">
              {token
                ? "You've been invited to join a dealership."
                : 'Invite link is missing or invalid.'}
            </p>
          </div>
        </div>

        {/* No token */}
        {!token && (
          <div className="flex items-start gap-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3">
            <AlertCircle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
            <p className="text-rose-300 text-sm">
              No invitation token found in the URL. Please use the full invite link you received.
            </p>
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center gap-4 text-center"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-white font-semibold mb-1">You're in!</p>
              <p className="text-sm text-white/45">Redirecting to your dealer dashboard…</p>
            </div>
          </motion.div>
        )}

        {/* Error */}
        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <div className="flex items-start gap-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3">
              <AlertCircle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
              <p className="text-rose-300 text-sm">{errorMsg}</p>
            </div>
            <button
              onClick={handleAccept}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2.5 text-sm transition"
            >
              Try again
            </button>
          </motion.div>
        )}

        {/* Idle / loading */}
        {token && status !== 'success' && status !== 'error' && (
          <div className="space-y-4">
            <p className="text-sm text-white/50 text-center">
              Click <span className="text-white/80 font-medium">Accept invitation</span> below to join the dealership and access the dealer panel.
            </p>
            <button
              onClick={handleAccept}
              disabled={status === 'loading'}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2.5 text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status === 'loading' ? 'Accepting…' : 'Accept invitation'}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default DealerInviteAccept;
