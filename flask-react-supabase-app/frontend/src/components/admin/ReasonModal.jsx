import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * ReasonModal — shared modal for destructive admin actions (suspend/ban/delete) that
 * require a reason note. Also handles "reactivate" via simple confirm (no reason).
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - action: 'suspend' | 'ban' | 'delete' | 'reactivate'
 *  - userLabel: string                         // displayed to confirm which user is affected
 *  - onConfirm: (reason: string) => Promise<void> | void
 *  - busy?: boolean                            // disables buttons while parent is working
 */
const ACTION_COPY = {
  suspend: {
    title: 'Suspend user',
    description: 'Temporarily suspend this account. They will not be able to sign in or post listings until reactivated.',
    confirmLabel: 'Suspend',
    requiresReason: true,
    tone: 'amber',
  },
  ban: {
    title: 'Ban user',
    description: 'Permanently ban this account. All of their active listings will be soft-archived.',
    confirmLabel: 'Ban user',
    requiresReason: true,
    tone: 'rose',
  },
  delete: {
    title: 'Delete user',
    description: 'Delete this account. Their listings will be soft-archived. This action is logged.',
    confirmLabel: 'Delete user',
    requiresReason: true,
    tone: 'rose',
  },
  reactivate: {
    title: 'Reactivate user',
    description: 'Restore this account to active status. They will be able to sign in and post listings again.',
    confirmLabel: 'Reactivate',
    requiresReason: false,
    tone: 'emerald',
  },
};

const toneClasses = {
  amber: 'bg-amber-500 hover:bg-amber-400 text-amber-950',
  rose: 'bg-rose-500 hover:bg-rose-400 text-rose-50',
  emerald: 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950',
};

const ReasonModal = ({ open, onClose, action, userLabel, onConfirm, busy = false }) => {
  const cfg = ACTION_COPY[action] || ACTION_COPY.suspend;
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  // Reset internal state whenever the modal opens or the action changes.
  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open, action]);

  if (!open) return null;

  const reasonTooShort = cfg.requiresReason && reason.trim().length < 5;
  const showError = touched && reasonTooShort;

  const handleConfirm = async () => {
    if (cfg.requiresReason && reasonTooShort) {
      setTouched(true);
      return;
    }
    await onConfirm(cfg.requiresReason ? reason.trim() : '');
  };

  return (
    <AnimatePresence>
      <motion.div
        key="reason-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={busy ? undefined : onClose}
      >
        <motion.div
          key="reason-modal-card"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-2xl bg-[#0c1015] border border-white/10 shadow-2xl overflow-hidden"
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                cfg.tone === 'emerald'
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                  : cfg.tone === 'amber'
                    ? 'bg-amber-500/10 border border-amber-500/20 text-amber-300'
                    : 'bg-rose-500/10 border border-rose-500/20 text-rose-300'
              }`}>
                <AlertTriangle size={16} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-white">{cfg.title}</h2>
                {userLabel && (
                  <p className="text-xs text-white/50 mt-0.5 truncate max-w-[260px]">{userLabel}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-5 space-y-4">
            <p className="text-sm text-white/60">{cfg.description}</p>

            {cfg.requiresReason && (
              <div className="space-y-1.5">
                <label className="block text-[11px] uppercase tracking-[0.14em] text-white/40 font-medium">
                  Reason <span className="text-rose-300">*</span>
                </label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => setTouched(true)}
                  disabled={busy}
                  placeholder="Why are you taking this action? (min 5 characters)"
                  className={`w-full bg-white/[0.04] border rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/25 resize-none focus:outline-none transition ${
                    showError
                      ? 'border-rose-500/40 focus:border-rose-500/60'
                      : 'border-white/10 focus:border-emerald-500/40'
                  }`}
                />
                {showError && (
                  <p className="text-xs text-rose-300">Please provide at least 5 characters.</p>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy || (cfg.requiresReason && reasonTooShort)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneClasses[cfg.tone]}`}
              >
                {busy ? 'Working…' : cfg.confirmLabel}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ReasonModal;
