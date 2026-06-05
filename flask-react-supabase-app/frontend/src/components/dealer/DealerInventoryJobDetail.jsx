import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { supabase } from '../../utils/supabaseClient';
import { useDealer } from '../../context/DealerContext';

// ── constants ────────────────────────────────────────────────────────────────

const STATUS_TONES = {
  queued: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  running: 'bg-sky-500/10 border-sky-500/30 text-sky-300',
  succeeded: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  partial: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  failed: 'bg-rose-500/10 border-rose-500/30 text-rose-300',
};

// ── status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }) {
  const cls = STATUS_TONES[status] || 'bg-white/[0.05] border-white/[0.06] text-white/40';
  return (
    <span
      className={`inline-flex items-center text-[11px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full border ${cls}`}
    >
      {status || '—'}
    </span>
  );
}

// ── count tile ───────────────────────────────────────────────────────────────

function CountTile({ label, value }) {
  return (
    <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-white/40 mt-2">
        {label}
      </div>
    </div>
  );
}

// ── error table ──────────────────────────────────────────────────────────────

function ErrorTable({ jobId, initialErrors = [] }) {
  const [errors, setErrors] = useState(initialErrors);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(initialErrors.length);

  const fetchErrors = useCallback(async (off) => {
    setLoading(true);
    try {
      const data = await apiClient.get(
        `/api/dealer/inventory/jobs/${jobId}/errors?limit=50&offset=${off}`
      );
      setErrors(data?.errors ?? []);
      setTotal(data?.total ?? 0);
    } catch (err) {
      console.error('Failed to load errors:', err);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  const handlePrev = () => {
    const newOffset = Math.max(0, offset - 50);
    setOffset(newOffset);
    fetchErrors(newOffset);
  };

  const handleNext = () => {
    const newOffset = offset + 50;
    if (newOffset < total) {
      setOffset(newOffset);
      fetchErrors(newOffset);
    }
  };

  if (!errors || errors.length === 0) {
    return (
      <p className="text-xs text-white/40 py-6 text-center">
        No errors recorded for this job.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <th className="px-4 py-3 text-left text-white/40 font-medium">
                Row
              </th>
              <th className="px-4 py-3 text-left text-white/40 font-medium">
                External ID
              </th>
              <th className="px-4 py-3 text-left text-white/40 font-medium">
                Error code
              </th>
              <th className="px-4 py-3 text-left text-white/40 font-medium">
                Message
              </th>
            </tr>
          </thead>
          <tbody>
            {errors.map((err) => (
              <tr
                key={`${err.row_index}-${err.error_code}`}
                className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition"
              >
                <td className="px-4 py-3 text-white/60 font-mono">
                  {err.row_index}
                </td>
                <td className="px-4 py-3 text-white/60 font-mono">
                  {err.external_id || '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-300">
                    {err.error_code}
                  </span>
                </td>
                <td className="px-4 py-3 text-white/50 max-w-xs truncate">
                  {err.error_message}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-white/40">
            Showing {offset + 1}–{Math.min(offset + 50, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handlePrev}
              disabled={offset === 0 || loading}
              className="rounded-lg px-3 py-1 text-xs border border-white/[0.08] text-white/60 hover:text-white/90 hover:bg-white/[0.04] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              onClick={handleNext}
              disabled={offset + 50 >= total || loading}
              className="rounded-lg px-3 py-1 text-xs border border-white/[0.08] text-white/60 hover:text-white/90 hover:bg-white/[0.04] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function DealerInventoryJobDetail() {
  const { id: jobId } = useParams();
  const navigate = useNavigate();
  const { dealership } = useDealer();

  const [job, setJob] = useState(null);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchJob = useCallback(async () => {
    try {
      const data = await apiClient.get(`/api/dealer/inventory/jobs/${jobId}`);
      setJob(data?.job || data);
      setErrors(data?.errors || []);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load job details');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  // Initial load
  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!jobId || !dealership?.id) return;

    const channel = supabase
      .channel(`dealer_inventory_job_${jobId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'dealer_inventory_jobs',
          filter: `id=eq.${jobId}`,
        },
        () => {
          fetchJob();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, dealership?.id, fetchJob]);

  if (loading) {
    return (
      <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-32 bg-white/[0.04] rounded-xl" />
          <div className="grid grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-24 bg-white/[0.04] rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <AlertCircle className="inline h-4 w-4 mr-2 text-rose-300" />
          <span className="text-sm text-rose-300">
            {error || 'Job not found'}
          </span>
        </div>
      </div>
    );
  }

  const displayJobId = jobId ? jobId.slice(-8) : '—';

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <button
          onClick={() => navigate('/dealer/inventory')}
          className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to inventory
        </button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-white">
              Job <span className="font-mono text-lg">{displayJobId}</span>
            </h1>
            <p className="text-sm text-white/40 mt-1">{job.kind || '—'}</p>
          </div>
          <StatusPill status={job.status} />
        </div>
      </div>

      {/* Counts grid */}
      <div className="grid grid-cols-5 gap-4">
        <CountTile label="Total" value={job.rows_total ?? 0} />
        <CountTile label="Created" value={job.rows_created ?? 0} />
        <CountTile label="Updated" value={job.rows_updated ?? 0} />
        <CountTile label="Failed" value={job.rows_failed ?? 0} />
        <CountTile label="Skipped" value={job.rows_skipped ?? 0} />
      </div>

      {/* Metadata row */}
      <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {/* Started at */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
              Started
            </p>
            <p className="text-sm text-white/70">
              {job.started_at
                ? new Date(job.started_at).toLocaleString()
                : '—'}
            </p>
          </div>

          {/* Finished at */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
              Finished
            </p>
            <p className="text-sm text-white/70">
              {job.finished_at
                ? new Date(job.finished_at).toLocaleString()
                : '—'}
            </p>
          </div>

          {/* File path */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
              File path
            </p>
            <p className="text-xs text-white/60 font-mono truncate">
              {job.file_path || '—'}
            </p>
          </div>

          {/* Triggered by */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
              Triggered by
            </p>
            <p className="text-sm text-white/70">
              {job.triggered_by ? job.triggered_by.slice(0, 8) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Error table */}
      {(job.rows_failed ?? 0) > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">
              Row errors ({job.rows_failed})
            </h2>
            <AlertCircle className="h-4 w-4 text-rose-400" />
          </div>
          <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-6">
            <ErrorTable jobId={jobId} initialErrors={errors} />
          </div>
        </div>
      )}
    </div>
  );
}
