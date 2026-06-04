import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  LayoutDashboard,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { GlassCard } from './ui/dashboard';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Per-tool state shape */
const initialToolState = () => ({
  running: false,
  toast: null,   // { type: 'success'|'error', msg: string }
  details: null,
  showDetails: false,
});

// ─── sub-components ───────────────────────────────────────────────────────────

const SectionLabel = ({ children }) => (
  <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-3">
    {children}
  </p>
);

/** Inline result toast — success (emerald) or error (rose) */
const InlineToast = ({ toast }) => {
  if (!toast) return null;
  const isError = toast.type === 'error';
  return (
    <AnimatePresence>
      <motion.p
        key={toast.msg}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className={`mt-3 text-xs font-medium leading-snug ${
          isError ? 'text-rose-300' : 'text-emerald-300'
        }`}
      >
        {toast.msg}
      </motion.p>
    </AnimatePresence>
  );
};

/** Expandable raw error details block */
const ErrorDetails = ({ details, show, onToggle }) => {
  if (!details) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-[11px] text-white/40 hover:text-white/70 transition-colors underline underline-offset-2"
      >
        {show ? 'Hide details' : 'Show details'}
      </button>
      <AnimatePresence>
        {show && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 text-[10px] text-white/40 bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 overflow-x-auto max-h-40"
          >
            {details}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
};

/** Single tool card */
const ToolCard = ({ icon: Icon, title, description, toolState, onRun, runLabel = 'Run', extraContent }) => {
  const { running, toast } = toolState;

  return (
    <GlassCard className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Icon size={24} className="text-white/40 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-white leading-snug">{title}</p>
          <p className="text-sm text-white/60 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>

      {/* Extra content (e.g. user info rows) */}
      {extraContent}

      {/* Inline toast */}
      <InlineToast toast={toast} />

      {/* Action button */}
      <div className="mt-auto pt-1">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm transition-colors"
        >
          {running ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Running…
            </>
          ) : (
            runLabel
          )}
        </button>
      </div>
    </GlassCard>
  );
};

// ─── main component ───────────────────────────────────────────────────────────

const AdminTools = () => {
  const { user, syncWithSupabase } = useAuth();

  // Per-tool state keyed by tool id
  const [toolStates, setToolStates] = useState({
    makeAdmin: initialToolState(),
    refreshUser: initialToolState(),
  });

  const updateTool = useCallback((id, patch) => {
    setToolStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  }, []);

  /** Show a success toast that auto-dismisses after 3 s */
  const successToast = useCallback((id, msg) => {
    updateTool(id, { toast: { type: 'success', msg } });
    setTimeout(() => updateTool(id, { toast: null }), 3000);
  }, [updateTool]);

  /** Show a persistent error toast */
  const errorToast = useCallback((id, msg) => {
    updateTool(id, { toast: { type: 'error', msg } });
  }, [updateTool]);

  // ── tool: make admin ───────────────────────────────────────────────────────
  const makeAdmin = useCallback(async () => {
    updateTool('makeAdmin', { running: true, toast: null, details: null, showDetails: false });
    const t0 = Date.now();

    try {
      const response = await apiClient.post('/api/auth/make-admin');

      if (response && response.success) {
        const ms = Date.now() - t0;
        successToast('makeAdmin', `Done · ${ms}ms — refreshing page…`);
        await syncWithSupabase({ forceBackendCheck: true });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        errorToast('makeAdmin', 'Response received but admin status was not updated successfully.');
        if (response && response.details) {
          updateTool('makeAdmin', { details: JSON.stringify(response.details, null, 2) });
        }
      }
    } catch (err) {
      let msg;
      if (err.status === 503) {
        msg = 'Server connection error: Unable to reach authentication service. Try again later.';
      } else if (err.status === 401) {
        msg = 'Authentication error: Your session may have expired. Please log in again.';
      } else if (err.details && err.details.message) {
        msg = `Error: ${err.details.message}`;
      } else {
        msg = `Failed: ${err.message || 'Unknown error'}`;
      }
      errorToast('makeAdmin', msg);

      const raw = err.details || err.response || err;
      updateTool('makeAdmin', { details: JSON.stringify(raw, null, 2) });
      console.error('Make admin error:', err);
    } finally {
      updateTool('makeAdmin', { running: false });
    }
  }, [updateTool, successToast, errorToast, syncWithSupabase]);

  // ── tool: refresh user status ──────────────────────────────────────────────
  const refreshUserStatus = useCallback(async () => {
    updateTool('refreshUser', { running: true, toast: null });
    const t0 = Date.now();

    try {
      const success = await syncWithSupabase({ forceBackendCheck: true });

      if (success) {
        const ms = Date.now() - t0;
        successToast('refreshUser', `Done · ${ms}ms — reloading…`);
        setTimeout(() => window.location.reload(), 1000);
      } else {
        errorToast('refreshUser', 'Failed to refresh user data. Please try again.');
      }
    } catch (err) {
      errorToast('refreshUser', `Error refreshing user data: ${err.message || 'Unknown error'}`);
      console.error('Refresh error:', err);
    } finally {
      updateTool('refreshUser', { running: false });
    }
  }, [updateTool, successToast, errorToast, syncWithSupabase]);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <h1 className="text-3xl font-semibold text-white">Operational tools</h1>
        <p className="text-sm text-white/50 mt-1">
          Internal utilities for the engineering and ops team.
        </p>
      </motion.div>

      {/* ── Section: Account ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.10 }}
      >
        <SectionLabel>Account</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Refresh user status */}
          <ToolCard
            icon={RefreshCw}
            title="Refresh user status"
            description="Force a sync with Supabase to update your local user object and admin claims."
            toolState={toolStates.refreshUser}
            onRun={refreshUserStatus}
            runLabel="Refresh"
            extraContent={
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-white/40 w-14 flex-shrink-0 text-xs">ID</span>
                  <span className="text-white/70 font-mono text-xs truncate">{user?.id || '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/40 w-14 flex-shrink-0 text-xs">Email</span>
                  <span className="text-white/70 text-xs truncate">{user?.email || '—'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/40 w-14 flex-shrink-0 text-xs">Admin</span>
                  {user?.is_admin ? (
                    <span className="text-emerald-300 text-xs font-semibold">Yes</span>
                  ) : (
                    <span className="text-white/50 text-xs">No</span>
                  )}
                </div>
              </div>
            }
          />

          {/* Make admin — only show when not already admin */}
          {!user?.is_admin ? (
            <div>
              <ToolCard
                icon={ShieldCheck}
                title="Claim admin privileges"
                description="Grant yourself admin access. Use this only if you are the developer or owner of this application."
                toolState={toolStates.makeAdmin}
                onRun={makeAdmin}
                runLabel="Make me admin"
              />
              {/* Error details below the card */}
              <ErrorDetails
                details={toolStates.makeAdmin.details}
                show={toolStates.makeAdmin.showDetails}
                onToggle={() =>
                  updateTool('makeAdmin', {
                    showDetails: !toolStates.makeAdmin.showDetails,
                  })
                }
              />
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.18 }}
            >
              <GlassCard className="flex flex-col gap-4 h-full">
                <div className="flex items-start gap-3">
                  <ShieldCheck size={24} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-base font-semibold text-white">Admin access active</p>
                    <p className="text-sm text-white/60 mt-1">
                      You already have admin privileges and can manage the application.
                    </p>
                  </div>
                </div>
                <div className="mt-auto">
                  <Link
                    to="/admin"
                    className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm transition-colors"
                  >
                    <LayoutDashboard size={14} />
                    Go to Admin Dashboard
                    <ChevronRight size={13} />
                  </Link>
                </div>
              </GlassCard>
            </motion.div>
          )}

        </div>
      </motion.div>

    </div>
  );
};

export default AdminTools;
