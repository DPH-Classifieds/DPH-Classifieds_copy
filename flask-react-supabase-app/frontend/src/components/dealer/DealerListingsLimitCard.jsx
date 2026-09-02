import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../utils/apiClient';

function Status({ summary }) {
  if (summary.used >= summary.limit) {
    return <span className="text-red-300 font-medium">You&rsquo;ve reached your limit.</span>;
  }
  if (summary.used >= summary.limit * 0.8) {
    return <span className="text-amber-300">Approaching your limit.</span>;
  }
  return <span className="text-white/60">{summary.used} / {summary.limit} used ({summary.remaining} remaining)</span>;
}

function RequestModal({ summary, onClose, onSubmitted }) {
  const [requested, setRequested] = useState(Math.max(summary.limit + 4, 8));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await apiClient.post('/api/dealer/listing-upgrade-requests', {
        requested_limit: Number(requested),
        reason,
      });
      onSubmitted(data);
    } catch (err) {
      const body = err?.response?.data;
      setError(body?.error || body?.message || err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={submit}
        className="bg-[color:var(--ex-shell-surface)] border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4 text-white"
      >
        <h3 className="text-lg font-semibold">Request more listings</h3>
        <p className="text-sm text-white/60">
          Your current limit is <strong>{summary.limit}</strong>. Tell us how many more you need and why.
        </p>
        <label className="block">
          <span className="text-sm text-white/70">Requested limit</span>
          <input
            type="number"
            min={summary.limit + 1}
            max={1000}
            required
            value={requested}
            onChange={(e) => setRequested(e.target.value)}
            className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </label>
        <label className="block">
          <span className="text-sm text-white/70">Reason (10&ndash;1000 characters)</span>
          <textarea
            required
            minLength={10}
            maxLength={1000}
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Tell us about your showroom size, inventory turnover, or expansion plans."
            className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <div className="text-xs text-white/40 mt-1">{reason.length} / 1000</div>
        </label>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-white/70 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function DealerListingsLimitCard({ onUpgradeResolved }) {
  const [summary, setSummary] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [pending, setPending] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/dealer/listing-limit');
      setSummary(data);
    } catch (e) {
      // Non-fatal: card silently hides
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (!summary) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <div className="text-xs uppercase tracking-wider text-white/40">Current limit</div>
        <div className="text-3xl font-semibold text-white mt-1">{summary.limit}</div>
        <div className="text-sm mt-2">
          <Status summary={summary} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pending ? (
          <span className="text-sm text-white/60">
            Request pending review &mdash; target {pending.requested_limit}
          </span>
        ) : (
          <button
            disabled={!summary.can_request}
            onClick={() => setShowModal(true)}
            title={!summary.can_request ? 'You need to use at least 80% of your current limit before requesting more' : undefined}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Request more listings
          </button>
        )}
      </div>
      {showModal && (
        <RequestModal
          summary={summary}
          onClose={() => setShowModal(false)}
          onSubmitted={(r) => {
            setPending(r);
            setShowModal(false);
            onUpgradeResolved?.(r);
          }}
        />
      )}
    </div>
  );
}
