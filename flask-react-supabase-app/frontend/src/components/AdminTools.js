import React, { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  RefreshCw,
  Loader2,
  LayoutDashboard,
  ChevronRight,
  Zap,
  Bot,
  Rss,
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
    flushCache: initialToolState(),
    autoReview: initialToolState(),
    redditVisibility: initialToolState(),
    redditOnExplore: initialToolState(),
    googleSignin: initialToolState(),
  });

  // Auto-review toggle state: null = loading, true/false = known
  const [arEnabled, setArEnabled] = useState(null);
  const [arToggleLoading, setArToggleLoading] = useState(false);
  const [arSource, setArSource] = useState(null); // 'redis' | 'env'

  useEffect(() => {
    apiClient.get('/api/admin/auto-review/settings')
      .then(data => {
        setArEnabled(data.enabled);
        setArSource(data.source);
      })
      .catch(() => setArEnabled(false));
  }, []);

  // Reddit imported-listings visibility kill switch
  const [redditEnabled, setRedditEnabled] = useState(null);
  const [redditToggleLoading, setRedditToggleLoading] = useState(false);
  const [redditSource, setRedditSource] = useState(null);

  useEffect(() => {
    apiClient.get('/api/admin/reddit-listings/settings')
      .then(data => {
        setRedditEnabled(data.enabled);
        setRedditSource(data.source);
      })
      .catch(() => setRedditEnabled(false));
  }, []);

  // Reddit-on-explore toggle: mix Reddit listings into the main explore feed
  const [redditOnExplore, setRedditOnExplore] = useState(null);
  const [redditExploreLoading, setRedditExploreLoading] = useState(false);
  const [redditExploreSource, setRedditExploreSource] = useState(null);

  useEffect(() => {
    apiClient.get('/api/admin/reddit-explore/settings')
      .then(data => {
        setRedditOnExplore(data.enabled);
        setRedditExploreSource(data.source);
      })
      .catch(() => setRedditOnExplore(false));
  }, []);

  // Google sign-in toggle: show/hide the Google button on login & signup
  const [googleSignin, setGoogleSignin] = useState(null);
  const [googleSigninLoading, setGoogleSigninLoading] = useState(false);
  const [googleSigninSource, setGoogleSigninSource] = useState(null);

  useEffect(() => {
    apiClient.get('/api/admin/google-signin/settings')
      .then(data => {
        setGoogleSignin(data.enabled);
        setGoogleSigninSource(data.source);
      })
      .catch(() => setGoogleSignin(false));
  }, []);

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

  // ── tool: auto-review toggle ──────────────────────────────────────────────
  const toggleAutoReview = useCallback(async () => {
    const newVal = !arEnabled;
    setArEnabled(newVal);
    setArToggleLoading(true);
    try {
      const res = await apiClient.patch('/api/admin/auto-review/settings', { enabled: newVal });
      setArEnabled(res.enabled);
      setArSource(res.source);
      successToast('autoReview', `Auto-review ${res.enabled ? 'enabled ✓' : 'disabled'}`);
    } catch (err) {
      setArEnabled(!newVal); // revert
      errorToast('autoReview', `Failed: ${err.message || 'Unknown error'}`);
    } finally {
      setArToggleLoading(false);
    }
  }, [arEnabled, successToast, errorToast]);

  // ── tool: reddit imported-listings visibility ─────────────────────────────
  const toggleRedditVisibility = useCallback(async () => {
    const newVal = !redditEnabled;
    setRedditEnabled(newVal);
    setRedditToggleLoading(true);
    try {
      const res = await apiClient.patch('/api/admin/reddit-listings/settings', { enabled: newVal });
      setRedditEnabled(res.enabled);
      setRedditSource(res.source);
      successToast('redditVisibility', `Reddit listings ${res.enabled ? 'shown ✓' : 'hidden from site'}`);
    } catch (err) {
      setRedditEnabled(!newVal); // revert
      errorToast('redditVisibility', `Failed: ${err.message || 'Unknown error'}`);
    } finally {
      setRedditToggleLoading(false);
    }
  }, [redditEnabled, successToast, errorToast]);

  // ── tool: reddit listings on the main explore feed ────────────────────────
  const toggleRedditOnExplore = useCallback(async () => {
    const newVal = !redditOnExplore;
    setRedditOnExplore(newVal);
    setRedditExploreLoading(true);
    try {
      const res = await apiClient.patch('/api/admin/reddit-explore/settings', { enabled: newVal });
      setRedditOnExplore(res.enabled);
      setRedditExploreSource(res.source);
      successToast('redditOnExplore', `Reddit ${res.enabled ? 'now shown on Explore ✓' : 'kept to its own tab'}`);
    } catch (err) {
      setRedditOnExplore(!newVal); // revert
      errorToast('redditOnExplore', `Failed: ${err.message || 'Unknown error'}`);
    } finally {
      setRedditExploreLoading(false);
    }
  }, [redditOnExplore, successToast, errorToast]);

  // ── tool: Google sign-in on/off ───────────────────────────────────────────
  const toggleGoogleSignin = useCallback(async () => {
    const newVal = !googleSignin;
    setGoogleSignin(newVal);
    setGoogleSigninLoading(true);
    try {
      const res = await apiClient.patch('/api/admin/google-signin/settings', { enabled: newVal });
      setGoogleSignin(res.enabled);
      setGoogleSigninSource(res.source);
      successToast('googleSignin', `Google sign-in ${res.enabled ? 'enabled ✓' : 'disabled'}`);
    } catch (err) {
      setGoogleSignin(!newVal); // revert
      errorToast('googleSignin', `Failed: ${err.message || 'Unknown error'}`);
    } finally {
      setGoogleSigninLoading(false);
    }
  }, [googleSignin, successToast, errorToast]);

  // ── tool: run auto-review now ─────────────────────────────────────────────
  const runAutoReview = useCallback(async () => {
    updateTool('autoReview', { running: true, toast: null });
    const t0 = Date.now();
    try {
      const res = await apiClient.post('/api/admin/auto-review/run');
      const ms = Date.now() - t0;
      successToast('autoReview', `Done · ${res.processed ?? 0} listing(s) reviewed · ${ms}ms`);
    } catch (err) {
      errorToast('autoReview', `Failed: ${err.message || 'Unknown error'}`);
    } finally {
      updateTool('autoReview', { running: false });
    }
  }, [updateTool, successToast, errorToast]);

  // ── tool: flush public listing cache ──────────────────────────────────────
  const flushCache = useCallback(async () => {
    updateTool('flushCache', { running: true, toast: null });
    const t0 = Date.now();
    try {
      const res = await apiClient.post('/api/admin/cache/flush', {});
      const ms = Date.now() - t0;
      if (res && res.ok) {
        successToast('flushCache', `Flushed ${(res.flushed || []).join(', ')} · ${ms}ms`);
      } else {
        errorToast('flushCache', 'Unexpected response from server.');
      }
    } catch (err) {
      errorToast('flushCache', `Failed: ${err.message || 'Unknown error'}`);
    } finally {
      updateTool('flushCache', { running: false });
    }
  }, [updateTool, successToast, errorToast]);

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

      {/* ── Section: Auto Review ─────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.07 }}
      >
        <SectionLabel>Auto Review</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Toggle card */}
          <GlassCard className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Bot size={24} className="text-white/40 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white leading-snug">Auto-approve toggle</p>
                <p className="text-sm text-white/60 mt-1 leading-relaxed">
                  When on, new listings go to auto-review and approved instantly if they pass. When off, everything goes to the manual pending queue.
                  {arSource === 'env' && (
                    <span className="block mt-1 text-amber-400/80 text-xs">Stored in env var — toggle requires Redis to override.</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-auto pt-1">
              <button
                type="button"
                onClick={toggleAutoReview}
                disabled={arEnabled === null || arToggleLoading}
                aria-label={arEnabled ? 'Disable auto-review' : 'Enable auto-review'}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  arEnabled ? 'bg-emerald-500' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                    arEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-white/70">
                {arEnabled === null ? 'Loading…' : arEnabled ? 'Enabled' : 'Disabled'}
                {arToggleLoading && <span className="ml-2 text-white/40 text-xs">Saving…</span>}
              </span>
            </div>

            <InlineToast toast={toolStates.autoReview.toast} />
          </GlassCard>

          {/* Run now card */}
          <ToolCard
            icon={Bot}
            title="Run auto-review now"
            description="Process all pending_auto_review listings immediately — useful to clear the backlog or after toggling the feature on."
            toolState={toolStates.autoReview}
            onRun={runAutoReview}
            runLabel="Run now"
          />

        </div>
      </motion.div>

      {/* ── Section: Reddit imported listings ────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.075 }}
      >
        <SectionLabel>Reddit imported listings</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassCard className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Rss size={24} className="text-white/40 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white leading-snug">Show Reddit listings on site</p>
                <p className="text-sm text-white/60 mt-1 leading-relaxed">
                  When off, every Reddit-imported listing is hidden from the public site (cars, bikes, plates, parts) — they stay in the database and the 4-hourly import keeps running in the background, just hidden. Turn on when you're ready to go live.
                  {redditSource === 'env' && (
                    <span className="block mt-1 text-amber-400/80 text-xs">Stored in env var — toggle requires Redis to override.</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-auto pt-1">
              <button
                type="button"
                onClick={toggleRedditVisibility}
                disabled={redditEnabled === null || redditToggleLoading}
                aria-label={redditEnabled ? 'Hide Reddit listings' : 'Show Reddit listings'}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  redditEnabled ? 'bg-emerald-500' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                    redditEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-white/70">
                {redditEnabled === null ? 'Loading…' : redditEnabled ? 'Shown on site' : 'Hidden'}
                {redditToggleLoading && <span className="ml-2 text-white/40 text-xs">Saving…</span>}
              </span>
            </div>

            <InlineToast toast={toolStates.redditVisibility.toast} />
          </GlassCard>

          <GlassCard className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Rss size={24} className="text-white/40 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white leading-snug">Show Reddit listings on Explore</p>
                <p className="text-sm text-white/60 mt-1 leading-relaxed">
                  When on, Reddit-imported listings are mixed into the main Explore feed alongside normal listings. When off, they stay in their own Reddit tab only. (Requires "Show Reddit listings on site" to also be on.)
                  {redditExploreSource === 'env' && (
                    <span className="block mt-1 text-amber-400/80 text-xs">Stored in env var — toggle requires Redis to override.</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-auto pt-1">
              <button
                type="button"
                onClick={toggleRedditOnExplore}
                disabled={redditOnExplore === null || redditExploreLoading}
                aria-label={redditOnExplore ? 'Hide Reddit from Explore' : 'Show Reddit on Explore'}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  redditOnExplore ? 'bg-emerald-500' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                    redditOnExplore ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-white/70">
                {redditOnExplore === null ? 'Loading…' : redditOnExplore ? 'On Explore feed' : 'Reddit tab only'}
                {redditExploreLoading && <span className="ml-2 text-white/40 text-xs">Saving…</span>}
              </span>
            </div>

            <InlineToast toast={toolStates.redditOnExplore.toast} />
          </GlassCard>

          <GlassCard className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck size={24} className="text-white/40 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold text-white leading-snug">Google sign-in</p>
                <p className="text-sm text-white/60 mt-1 leading-relaxed">
                  When on, the "Continue with Google" button is shown on the login and signup pages. When off, only email/password sign-in is offered.
                  {googleSigninSource === 'env' && (
                    <span className="block mt-1 text-amber-400/80 text-xs">Stored in env var — toggle requires Redis to override.</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-auto pt-1">
              <button
                type="button"
                onClick={toggleGoogleSignin}
                disabled={googleSignin === null || googleSigninLoading}
                aria-label={googleSignin ? 'Disable Google sign-in' : 'Enable Google sign-in'}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                  googleSignin ? 'bg-emerald-500' : 'bg-white/20'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                    googleSignin ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-sm font-medium text-white/70">
                {googleSignin === null ? 'Loading…' : googleSignin ? 'Enabled' : 'Disabled'}
                {googleSigninLoading && <span className="ml-2 text-white/40 text-xs">Saving…</span>}
              </span>
            </div>

            <InlineToast toast={toolStates.googleSignin.toast} />
          </GlassCard>
        </div>
      </motion.div>

      {/* ── Section: Cache ───────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <SectionLabel>Cache</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ToolCard
            icon={Zap}
            title="Flush listing cache"
            description="Clears Redis and in-memory caches for all public listing endpoints (cars, bikes, parts, plates). Use this if the live site is showing stale results after approving listings."
            toolState={toolStates.flushCache}
            onRun={flushCache}
            runLabel="Flush cache"
          />
        </div>
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
