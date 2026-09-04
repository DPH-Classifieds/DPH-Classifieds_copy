import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  ArrowRight,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { supabase } from '../../utils/supabaseClient';
import { useDealer } from '../../context/DealerContext';
import API_BASE_URL from '../../utils/apiBase';

// ── constants ────────────────────────────────────────────────────────────────

const CANONICAL_FIELDS = [
  '(ignore)',
  'external_id',
  'make',
  'model',
  'year',
  'price',
  'mileage',
  'body_type',
  'color',
  'fuel_type',
  'transmission',
  'description',
  'image_urls',
];
const REQUIRED = ['make', 'model', 'year', 'price'];

// ── helpers ──────────────────────────────────────────────────────────────────

function relTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

function parseCSVPreview(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1, 6).map((line) => {
    const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']));
  });
  return { headers, rows };
}

// ── status pill ──────────────────────────────────────────────────────────────

const STATUS_PILL = {
  queued:    'text-amber-300 bg-amber-500/10 border-amber-500/20',
  running:   'text-amber-300 bg-amber-500/10 border-amber-500/20',
  succeeded: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  partial:   'text-amber-300 bg-amber-500/10 border-amber-500/20',
  failed:    'text-rose-300 bg-rose-500/10 border-rose-500/20',
};

function StatusPill({ status }) {
  const cls = STATUS_PILL[status] || 'text-white/40 bg-white/[0.05] border-white/10';
  return (
    <span
      className={`inline-flex items-center text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border ${cls}`}
    >
      {status || '—'}
    </span>
  );
}

// ── skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-10" />
      ))}
    </div>
  );
}

// ── Section A: Upload wizard ──────────────────────────────────────────────────

function UploadWizard({ dealershipId, onJobCreated }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('upload'); // upload | mapping | confirm | submitting
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [kind, setKind] = useState('csv_import');
  const [error, setError] = useState('');
  const dropRef = useRef(null);
  const inputRef = useRef(null);

  // ── file processing ────────────────────────────────────────────────────────

  const processFile = useCallback((f) => {
    if (!f) return;
    setError('');
    const ext = f.name.split('.').pop().toLowerCase();
    const importKind = ext === 'xml' ? 'xml_import' : 'csv_import';
    setFile(f);
    setKind(importKind);

    if (importKind === 'csv_import') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const { headers: h, rows: r } = parseCSVPreview(e.target.result);
        setHeaders(h);
        setPreviewRows(r);
        const initial = {};
        h.forEach((hdr) => { initial[hdr] = '(ignore)'; });
        setMapping(initial);
        setStep('mapping');
      };
      reader.readAsText(f);
    } else {
      // XML: skip preview, user supplies mapping manually
      setHeaders([]);
      setPreviewRows([]);
      setMapping({});
      setStep('mapping');
    }
  }, []);

  // ── drag-drop ──────────────────────────────────────────────────────────────

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f) processFile(f);
    },
    [processFile],
  );

  const onDragOver = (e) => e.preventDefault();

  // ── mapping helpers ────────────────────────────────────────────────────────

  const assignedCanonicals = Object.values(mapping).filter((v) => v !== '(ignore)');
  const missingRequired = REQUIRED.filter((r) => !assignedCanonicals.includes(r));
  const canProceedFromMapping = missingRequired.length === 0;

  // ── submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setStep('submitting');
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      fd.append('mapping', JSON.stringify(mapping));
      const data = await apiClient.post('/api/dealer/inventory/import', fd);
      if (onJobCreated) onJobCreated(data);
      navigate(`/dealer/inventory/jobs/${data.job_id}`);
    } catch (err) {
      setError(err.message || 'Upload failed');
      setStep('confirm');
    }
  };

  // ── render helpers ─────────────────────────────────────────────────────────

  const renderUpload = () => (
    <div
      ref={dropRef}
      onDrop={onDrop}
      onDragOver={onDragOver}
      className="flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-white/[0.12] bg-white/[0.02] p-12 transition hover:border-white/25 hover:bg-white/[0.04] cursor-pointer"
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="h-8 w-8 text-white/30" />
      <div className="text-center">
        <p className="text-sm text-white/70">Drag &amp; drop a CSV or XML file here</p>
        <p className="text-xs text-white/30 mt-1">or click to browse — max 10 MB</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xml"
        className="hidden"
        onChange={(e) => processFile(e.target.files?.[0])}
      />
    </div>
  );

  const renderMapping = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileSpreadsheet className="h-5 w-5 text-white/40" />
        <span className="text-sm text-white/70 truncate max-w-xs">{file?.name}</span>
      </div>

      {kind === 'xml_import' ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
          <AlertCircle className="inline h-4 w-4 mr-2" />
          XML detected — enter your column mapping as JSON below (e.g.&nbsp;
          <code className="font-mono text-xs">{`{"StockNum":"external_id","Make":"make",...}`}</code>
          ).
          <textarea
            rows={4}
            placeholder='{"Make":"make","Model":"model","Year":"year","Price":"price"}'
            className="mt-3 w-full rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 text-xs font-mono text-white/80 focus:outline-none focus:border-white/20"
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                setMapping(parsed);
                setError('');
              } catch {
                setError('Invalid JSON mapping');
              }
            }}
          />
        </div>
      ) : (
        <>
          <p className="text-xs text-white/40">
            Map each detected column to the canonical field it represents.
          </p>
          {missingRequired.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-300">
              <AlertCircle className="inline h-3.5 w-3.5 mr-1.5" />
              Still missing: <strong>{missingRequired.join(', ')}</strong>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                  <th className="px-4 py-2.5 text-left text-xs text-white/40 font-medium">Detected column</th>
                  <th className="px-4 py-2.5 text-left text-xs text-white/40 font-medium">Canonical field</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((hdr) => {
                  const isRequiredUnset =
                    mapping[hdr] === '(ignore)' &&
                    REQUIRED.includes(hdr.toLowerCase());
                  return (
                    <tr key={hdr} className="border-b border-white/[0.04] last:border-0">
                      <td
                        className={`px-4 py-2 text-xs font-mono ${
                          isRequiredUnset ? 'text-amber-300' : 'text-white/60'
                        }`}
                      >
                        {hdr}
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={mapping[hdr] ?? '(ignore)'}
                          onChange={(e) =>
                            setMapping((prev) => ({ ...prev, [hdr]: e.target.value }))
                          }
                          className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-2 py-1 text-xs text-white/80 focus:outline-none focus:border-white/20"
                        >
                          {CANONICAL_FIELDS.map((cf) => (
                            <option key={cf} value={cf}>
                              {cf}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => { setStep('upload'); setFile(null); setHeaders([]); setPreviewRows([]); setMapping({}); setError(''); }}
          className="rounded-xl px-4 py-2 text-sm text-white/40 border border-white/[0.08] hover:text-white/70 hover:bg-white/[0.04] transition"
        >
          Back
        </button>
        <button
          disabled={!canProceedFromMapping}
          onClick={() => setStep('confirm')}
          className="rounded-xl px-5 py-2 text-sm font-medium bg-white/10 text-white border border-white/[0.12] hover:bg-white/15 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Preview &amp; confirm
        </button>
      </div>
    </div>
  );

  const renderConfirm = () => {
    // Build canonical columns that are actually mapped
    const mappedCols = Object.entries(mapping)
      .filter(([, v]) => v !== '(ignore)')
      .map(([src, dst]) => ({ src, dst }));

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-white/70">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          Mapping looks good — review the preview below.
        </div>

        {previewRows.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                  {mappedCols.map(({ dst }) => (
                    <th key={dst} className="px-3 py-2 text-left text-white/40 font-medium capitalize">
                      {dst}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-b border-white/[0.04] last:border-0">
                    {mappedCols.map(({ src, dst }) => (
                      <td key={dst} className="px-3 py-2 text-white/60 max-w-[160px] truncate">
                        {row[src] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-white/40">No preview available for XML files.</p>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-2 text-xs text-rose-300">
            <AlertCircle className="inline h-3.5 w-3.5 mr-1.5" />
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setStep('mapping')}
            className="rounded-xl px-4 py-2 text-sm text-white/40 border border-white/[0.08] hover:text-white/70 hover:bg-white/[0.04] transition"
          >
            Back
          </button>
          <button
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/15 transition"
          >
            Start import <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

  const renderSubmitting = () => (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-white/70 animate-spin" />
      <p className="text-sm text-white/50">Creating import job…</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {['upload', 'mapping', 'confirm'].map((s, idx) => {
          const stepOrder = ['upload', 'mapping', 'confirm', 'submitting'];
          const current = stepOrder.indexOf(step);
          const thisIdx = stepOrder.indexOf(s);
          const done = current > thisIdx;
          const active = current === thisIdx;
          return (
            <React.Fragment key={s}>
              <span
                className={`text-xs font-medium capitalize px-2 py-0.5 rounded-full border transition ${
                  done
                    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                    : active
                    ? 'text-white border-white/20 bg-white/[0.08]'
                    : 'text-white/30 border-white/[0.06]'
                }`}
              >
                {idx + 1}. {s}
              </span>
              {idx < 2 && (
                <span className="text-white/20 text-xs">›</span>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {step === 'upload' && renderUpload()}
      {step === 'mapping' && renderMapping()}
      {(step === 'confirm') && renderConfirm()}
      {step === 'submitting' && renderSubmitting()}
    </div>
  );
}

// ── Section B: Recent jobs ────────────────────────────────────────────────────

function RecentJobs({ dealershipId }) {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchJobs = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/dealer/inventory/jobs?limit=20');
      setJobs(data?.jobs ?? data ?? []);
    } catch (err) {
      setError(err.message || 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!dealershipId) return;

    const channel = supabase
      .channel(`dealer_inventory_jobs_${dealershipId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'dealer_inventory_jobs',
          filter: `dealership_id=eq.${dealershipId}`,
        },
        () => {
          fetchJobs();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealershipId, fetchJobs]);

  const rowSummary = (job) => {
    const created = job.rows_created ?? 0;
    const updated = job.rows_updated ?? 0;
    const failed = job.rows_failed ?? 0;
    const parts = [];
    if (created > 0) parts.push(`${created} created`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (failed > 0) parts.push(`${failed} failed`);
    return parts.join(', ') || '—';
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white/80">Recent imports</h2>
        <Clock className="h-4 w-4 text-white/30" />
      </div>

      {loading && <TableSkeleton rows={4} />}
      {!loading && error && (
        <p className="text-xs text-rose-300">
          <AlertCircle className="inline h-3.5 w-3.5 mr-1" />
          {error}
        </p>
      )}
      {!loading && !error && jobs.length === 0 && (
        <p className="text-xs text-white/30 py-6 text-center">No import jobs yet.</p>
      )}
      {!loading && !error && jobs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="px-3 py-2.5 text-left text-white/40 font-medium">Started</th>
                <th className="px-3 py-2.5 text-left text-white/40 font-medium">Kind</th>
                <th className="px-3 py-2.5 text-left text-white/40 font-medium">Status</th>
                <th className="px-3 py-2.5 text-left text-white/40 font-medium">Rows</th>
                <th className="px-3 py-2.5 text-left text-white/40 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition"
                >
                  <td className="px-3 py-2.5 text-white/50">{relTime(job.started_at || job.created_at)}</td>
                  <td className="px-3 py-2.5 text-white/60 font-mono">{job.kind ?? '—'}</td>
                  <td className="px-3 py-2.5"><StatusPill status={job.status} /></td>
                  <td className="px-3 py-2.5 text-white/50">{rowSummary(job)}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => navigate(`/dealer/inventory/jobs/${job.id}`)}
                      className="inline-flex items-center gap-1 text-white/40 hover:text-white/80 transition"
                    >
                      Open <ArrowRight className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── export button ─────────────────────────────────────────────────────────────

function ExportButton() {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      // Trigger download by opening the authenticated URL in a new tab
      // (the backend serves the CSV with Content-Disposition: attachment)
      const { getBestAccessToken } = await import('../../utils/supabaseClient');
      const token = await getBestAccessToken();
      const baseUrl =
        window.API_BASE_URL_OVERRIDE ||
        API_BASE_URL;
      const url = `${baseUrl}/api/dealer/inventory/export.csv`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        mode: 'cors',
      });
      if (!resp.ok) throw new Error('Export failed');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'inventory-export.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={exporting}
      className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm border border-white/[0.08] text-white/60 hover:text-white/90 hover:bg-white/[0.04] transition disabled:opacity-40"
    >
      <Download className="h-4 w-4" />
      {exporting ? 'Exporting…' : 'Export CSV'}
    </button>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function DealerInventory() {
  const { dealership, loading: dealerLoading } = useDealer();
  const [refreshKey, setRefreshKey] = useState(0);

  const handleJobCreated = () => {
    setRefreshKey((k) => k + 1);
  };

  if (dealerLoading) {
    return (
      <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
        <TableSkeleton rows={6} />
      </div>
    );
  }

  const dealershipId = dealership?.id;

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Inventory imports</h1>
          <p className="text-sm text-white/40 mt-0.5">
            Upload CSV or XML files to bulk-import listings into your inventory.
          </p>
        </div>
        <ExportButton />
      </div>

      {/* Upload wizard */}
      <UploadWizard dealershipId={dealershipId} onJobCreated={handleJobCreated} />

      {/* Recent jobs */}
      <RecentJobs key={refreshKey} dealershipId={dealershipId} />
    </div>
  );
}
