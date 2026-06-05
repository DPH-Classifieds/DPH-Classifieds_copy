import React, { useCallback, useEffect, useState } from 'react';
import {
  Plug,
  Plus,
  Edit3,
  Trash2,
  Play,
  ShieldOff,
  Loader2,
  X,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';

// ── constants ────────────────────────────────────────────────────────────────

const AUTH_TYPES = ['none', 'bearer', 'basic', 'hmac'];

const DEFAULT_FIELD_MAPPING = {
  sku: 'external_id',
  make: 'make',
  model: 'model',
  year: 'year',
  price: 'price',
};

const DEFAULT_CREDENTIALS_TEMPLATE = {
  none: '{}',
  bearer: '{"token": "your-bearer-token"}',
  basic: '{"username": "user", "password": "pass"}',
  hmac: '{"key": "your-secret-key"}',
};

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

function truncateUrl(url) {
  if (!url) return '—';
  if (url.length <= 40) return url;
  return url.substring(0, 37) + '…';
}

// ── status pill ──────────────────────────────────────────────────────────────

function StatusPill({ status }) {
  if (!status) {
    return (
      <span className="inline-flex items-center text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border text-white/40 bg-white/[0.05] border-white/10">
        —
      </span>
    );
  }

  let className = 'text-white/40 bg-white/[0.05] border-white/10';
  if (status === 'ok') {
    className = 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  } else if (status.startsWith('auth') || status.startsWith('key')) {
    className = 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  } else if (status.startsWith('parse') || status.startsWith('http_error')) {
    className = 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  } else if (status === 'credentials_unreadable') {
    className = 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  }

  return (
    <span
      className={`inline-flex items-center text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border ${className}`}
    >
      {status}
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

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type = 'info', onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const bgColor =
    type === 'success'
      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
      : type === 'error'
      ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
      : 'bg-white/10 border-white/20 text-white/80';

  return (
    <div
      className={`fixed bottom-4 right-4 rounded-lg border px-4 py-3 text-sm ${bgColor} z-40 animate-in fade-in slide-in-from-bottom-2`}
    >
      {message}
    </div>
  );
}

// ── Modal overlay ────────────────────────────────────────────────────────────

function Modal({ title, isOpen, onClose, children }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="rounded-2xl border border-white/[0.06] bg-[#0a1410] p-6 max-w-[640px] w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/[0.08] transition text-white/40 hover:text-white/70"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Add/Edit Source Modal ────────────────────────────────────────────────────

function SourceModal({ isOpen, onClose, source, onSave }) {
  const [label, setLabel] = useState('');
  const [endpoint_url, setEndpointUrl] = useState('');
  const [auth_type, setAuthType] = useState('none');
  const [credentials, setCredentials] = useState('');
  const [field_mapping, setFieldMapping] = useState('');
  const [poll_interval_min, setPollIntervalMin] = useState(60);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (source) {
      setLabel(source.label || '');
      setEndpointUrl(source.endpoint_url || '');
      setAuthType(source.auth_type || 'none');
      setCredentials('');
      setFieldMapping(JSON.stringify(source.field_mapping || DEFAULT_FIELD_MAPPING, null, 2));
      setPollIntervalMin(source.poll_interval_min || 60);
    } else {
      setLabel('');
      setEndpointUrl('');
      setAuthType('none');
      setCredentials('');
      setFieldMapping(JSON.stringify(DEFAULT_FIELD_MAPPING, null, 2));
      setPollIntervalMin(60);
    }
    setError('');
  }, [source, isOpen]);

  const handleSave = async () => {
    setError('');
    setSaving(true);

    try {
      let mappingObj = {};
      if (field_mapping.trim()) {
        try {
          mappingObj = JSON.parse(field_mapping);
        } catch {
          setError('Invalid JSON in field mapping');
          setSaving(false);
          return;
        }
      }

      let credsObj = null;
      if (credentials.trim()) {
        try {
          credsObj = JSON.parse(credentials);
        } catch {
          setError('Invalid JSON in credentials');
          setSaving(false);
          return;
        }
      }

      const payload = {
        label,
        adapter: 'generic_json',
        endpoint_url,
        auth_type,
        field_mapping: mappingObj,
        poll_interval_min: Math.max(5, parseInt(poll_interval_min, 10)),
      };

      if (credsObj) {
        payload.credentials = credsObj;
      }

      if (source) {
        await apiClient.patch(`/api/dealer/api-sources/${source.id}`, payload);
      } else {
        await apiClient.post('/api/dealer/api-sources', payload);
      }

      onSave();
      onClose();
    } catch (err) {
      if (err.status === 503) {
        setError('Encryption unavailable. Please configure DEALER_INTEGRATIONS_KEY.');
      } else {
        setError(err.message || 'Failed to save source');
      }
    } finally {
      setSaving(false);
    }
  };

  const title = source ? 'Edit API Source' : 'Add API Source';
  const credentialsPlaceholder =
    DEFAULT_CREDENTIALS_TEMPLATE[auth_type] || '{}';

  return (
    <Modal title={title} isOpen={isOpen} onClose={onClose}>
      <div className="space-y-4">
        {/* Label */}
        <div>
          <label className="block text-xs font-medium text-white/70 mb-2">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g., Primary DMS"
            className="w-full rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
          />
        </div>

        {/* Adapter (read-only) */}
        <div>
          <label className="block text-xs font-medium text-white/70 mb-2">Adapter</label>
          <div className="rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 text-sm text-white/50">
            generic_json
          </div>
        </div>

        {/* Endpoint URL */}
        <div>
          <label className="block text-xs font-medium text-white/70 mb-2">Endpoint URL</label>
          <input
            type="text"
            value={endpoint_url}
            onChange={(e) => setEndpointUrl(e.target.value)}
            placeholder="https://your-dms/api/listings"
            className="w-full rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
          />
        </div>

        {/* Auth Type */}
        <div>
          <label className="block text-xs font-medium text-white/70 mb-2">Auth type</label>
          <select
            value={auth_type}
            onChange={(e) => {
              setAuthType(e.target.value);
              setCredentials('');
            }}
            className="w-full rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
          >
            {AUTH_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Credentials */}
        <div>
          <label className="block text-xs font-medium text-white/70 mb-2">Credentials (JSON)</label>
          <textarea
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            placeholder={credentialsPlaceholder}
            rows={4}
            className="w-full rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 text-xs font-mono text-white/80 focus:outline-none focus:border-white/20"
          />
          <p className="text-xs text-white/40 mt-1">
            {source ? 'Leave blank to keep existing credentials.' : 'Leave blank for none.'}
          </p>
        </div>

        {/* Field Mapping */}
        <div>
          <label className="block text-xs font-medium text-white/70 mb-2">Field mapping (JSON)</label>
          <textarea
            value={field_mapping}
            onChange={(e) => setFieldMapping(e.target.value)}
            placeholder={JSON.stringify(DEFAULT_FIELD_MAPPING, null, 2)}
            rows={4}
            className="w-full rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 text-xs font-mono text-white/80 focus:outline-none focus:border-white/20"
          />
        </div>

        {/* Poll interval */}
        <div>
          <label className="block text-xs font-medium text-white/70 mb-2">Poll interval (minutes, min 5)</label>
          <input
            type="number"
            value={poll_interval_min}
            onChange={(e) => setPollIntervalMin(Math.max(5, parseInt(e.target.value, 10) || 5))}
            min={5}
            className="w-full rounded-lg bg-white/[0.05] border border-white/[0.08] px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg px-4 py-2 text-sm text-white/40 border border-white/[0.08] hover:text-white/70 hover:bg-white/[0.04] transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg px-4 py-2 text-sm font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/15 transition disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DealerApiSources() {
  // dealership is intentionally not destructured — backend resolves it from the
  // JWT for every /api/dealer/api-sources call. We only need the loading flag.
  const { loading: dealerLoading } = useDealer();
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [toast, setToast] = useState(null);

  const fetchSources = useCallback(async () => {
    try {
      setError('');
      const data = await apiClient.get('/api/dealer/api-sources');
      setSources(Array.isArray(data) ? data : data?.sources ?? []);
    } catch (err) {
      setError(err.message || 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  const handleOpenAdd = () => {
    setEditingSource(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (source) => {
    setEditingSource(source);
    setModalOpen(true);
  };

  const handleModalSave = () => {
    fetchSources();
  };

  const handleTest = async (sourceId) => {
    setTestingId(sourceId);
    try {
      const result = await apiClient.post(`/api/dealer/api-sources/${sourceId}/test`, {});
      const message = `Fetched ${result.rows_valid ?? result.rows_seen ?? 0} rows`;
      setToast({ message, type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Test failed', type: 'error' });
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleEnabled = async (source) => {
    try {
      await apiClient.patch(`/api/dealer/api-sources/${source.id}`, {
        enabled: !source.enabled,
      });
      fetchSources();
    } catch (err) {
      setToast({ message: err.message || 'Failed to toggle', type: 'error' });
    }
  };

  const handleDelete = async (sourceId) => {
    if (!window.confirm('Delete this API source?')) return;
    try {
      await apiClient.delete(`/api/dealer/api-sources/${sourceId}`);
      fetchSources();
      setToast({ message: 'Source deleted', type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Delete failed', type: 'error' });
    }
  };

  if (dealerLoading) {
    return (
      <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
        <TableSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Plug className="h-6 w-6 text-white/60" />
          <div>
            <h1 className="text-xl font-semibold text-white">API Integrations</h1>
            <p className="text-sm text-white/40 mt-0.5">
              Pull listings from your DMS / inventory system via JSON endpoints.
            </p>
          </div>
        </div>
        <button
          onClick={handleOpenAdd}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/15 transition"
        >
          <Plus className="h-4 w-4" />
          Add source
        </button>
      </div>

      {/* Sources table card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
        {loading && <TableSkeleton rows={4} />}
        {!loading && error && (
          <p className="text-xs text-rose-300">
            Error loading sources: {error}
          </p>
        )}
        {!loading && !error && sources.length === 0 && (
          <p className="text-xs text-white/30 py-6 text-center">
            No API sources configured. Click "Add source" to get started.
          </p>
        )}
        {!loading && !error && sources.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="px-3 py-2.5 text-left text-white/40 font-medium">Label</th>
                  <th className="px-3 py-2.5 text-left text-white/40 font-medium">Endpoint</th>
                  <th className="px-3 py-2.5 text-left text-white/40 font-medium">Auth</th>
                  <th className="px-3 py-2.5 text-left text-white/40 font-medium">Last pulled</th>
                  <th className="px-3 py-2.5 text-left text-white/40 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-left text-white/40 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr
                    key={source.id}
                    className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition"
                  >
                    <td className="px-3 py-2.5 text-white/60">{source.label || '—'}</td>
                    <td className="px-3 py-2.5 text-white/50 font-mono text-[10px]">
                      {truncateUrl(source.endpoint_url)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center text-[11px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border text-white/60 bg-white/[0.05] border-white/10">
                        {source.auth_type || 'none'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-white/50">
                      {relTime(source.last_pulled_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={source.last_status} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        {/* Enabled toggle */}
                        <button
                          onClick={() => handleToggleEnabled(source)}
                          className={`p-1.5 rounded-lg transition ${
                            source.enabled
                              ? 'text-emerald-400 hover:bg-emerald-500/10'
                              : 'text-white/30 hover:bg-white/[0.08]'
                          }`}
                          title={source.enabled ? 'Disable' : 'Enable'}
                        >
                          <ShieldOff className="h-4 w-4" />
                        </button>

                        {/* Test button */}
                        <button
                          onClick={() => handleTest(source.id)}
                          disabled={testingId === source.id}
                          className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[0.08] transition disabled:opacity-40"
                          title="Test connection"
                        >
                          {testingId === source.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>

                        {/* Edit button */}
                        <button
                          onClick={() => handleOpenEdit(source)}
                          className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[0.08] transition"
                          title="Edit"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>

                        {/* Delete button */}
                        <button
                          onClick={() => handleDelete(source.id)}
                          className="p-1.5 rounded-lg text-white/40 hover:text-rose-400 hover:bg-rose-500/10 transition"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      <SourceModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingSource(null);
        }}
        source={editingSource}
        onSave={handleModalSave}
      />

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}
