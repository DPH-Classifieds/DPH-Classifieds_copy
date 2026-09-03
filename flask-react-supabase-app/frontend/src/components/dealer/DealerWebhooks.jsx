import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Webhook,
  Plus,
  Edit3,
  Trash2,
  Send,
  KeyRound,
  Power,
  RefreshCw,
} from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';
import { supabase } from '../../utils/supabaseClient';

// ── constants ─────────────────────────────────────────────────────────────────

const EVENT_TYPES = [
  'lead.created',
  'lead.status_changed',
  'lead.assigned',
  'listing.sold',
  'listing.view_milestone',
  'inventory.import_completed',
];

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

function generateSecret() {
  const a = crypto.randomUUID().replace(/-/g, '');
  const b = crypto.randomUUID().replace(/-/g, '');
  return a + b;
}

// ── sub-components ────────────────────────────────────────────────────────────

const EventChip = ({ event, active, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(event)}
    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
      active
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
        : 'text-white/40 border-white/[0.06] hover:text-white/60 hover:bg-white/[0.04]'
    }`}
  >
    {event}
  </button>
);

const StatusPill = ({ status }) => {
  const map = {
    pending:     'bg-amber-500/10 text-amber-300 border-amber-500/20',
    succeeded:   'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    failed:      'bg-amber-500/10 text-amber-300 border-amber-500/20',
    dead_letter: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
  };
  return (
    <span className={`text-[10px] font-medium rounded-full border px-2 py-0.5 capitalize ${map[status] || 'bg-white/[0.06] text-white/50 border-white/10'}`}>
      {status?.replace('_', ' ') || '—'}
    </span>
  );
};

const Skeleton = () => (
  <div className="space-y-2 p-1">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="animate-pulse bg-white/[0.04] rounded-xl h-10" />
    ))}
  </div>
);

// ── Toast ─────────────────────────────────────────────────────────────────────

const Toast = ({ message, onDismiss }) => (
  <div className="fixed bottom-6 right-6 z-50 max-w-sm bg-white/[0.08] border border-white/[0.12] rounded-2xl shadow-2xl shadow-black/40 backdrop-blur-xl px-5 py-4 text-sm text-white/90 animate-in fade-in slide-in-from-bottom-2">
    <p className="leading-relaxed">{message}</p>
    <button
      onClick={onDismiss}
      className="mt-2 text-xs text-white/40 hover:text-white/70 transition-colors"
    >
      Dismiss
    </button>
  </div>
);

// ── Webhook form (shared by Add + Edit) ───────────────────────────────────────

const emptyForm = () => ({ label: '', url: '', events: [], secret: '' });

const WebhookForm = ({ initial, onSave, onCancel, saving, error }) => {
  const [form, setForm] = useState(initial || emptyForm());

  const toggleEvent = (event) => {
    setForm((prev) => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter((e) => e !== event)
        : [...prev.events, event],
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg mx-4 bg-[color:var(--ex-shell-surface)] border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/40"
      >
        <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
          <h2 className="text-base font-semibold text-white">
            {initial ? 'Edit webhook' : 'Add webhook'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Label */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Label</label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
              placeholder="e.g. CRM sync"
              required
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/40 focus:bg-white/[0.06] transition-colors"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">Endpoint URL</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
              placeholder="https://example.com/webhook"
              required
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/40 focus:bg-white/[0.06] transition-colors"
            />
          </div>

          {/* Events */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-2">Events</label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map((event) => (
                <EventChip
                  key={event}
                  event={event}
                  active={form.events.includes(event)}
                  onClick={toggleEvent}
                />
              ))}
            </div>
            {form.events.length === 0 && (
              <p className="mt-1 text-[11px] text-white/30">Select at least one event.</p>
            )}
          </div>

          {/* Secret */}
          <div>
            <label className="block text-xs font-medium text-white/50 mb-1.5">
              <span className="flex items-center gap-1.5">
                <KeyRound size={11} />
                Signing secret {initial && <span className="text-white/30">(leave blank to keep existing)</span>}
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={form.secret}
                onChange={(e) => setForm((p) => ({ ...p, secret: e.target.value }))}
                placeholder={initial ? '(unchanged)' : 'Paste or generate…'}
                required={!initial}
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-emerald-500/40 focus:bg-white/[0.06] transition-colors font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, secret: generateSecret() }))}
                className="px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-xs text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors flex-shrink-0"
              >
                Generate
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3.5 py-2.5">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-sm text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || form.events.length === 0}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const DealerWebhooks = () => {
  const { dealership } = useDealer();

  const [webhooks, setWebhooks] = useState(null);
  const [deliveries, setDeliveries] = useState(null);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState(null);

  const [toast, setToast] = useState(null);

  // ── data fetching ──────────────────────────────────────────────────────────

  const fetchWebhooks = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/dealer/webhooks');
      setWebhooks(data?.webhooks || data || []);
    } catch (err) {
      console.error('Failed to load webhooks', err);
      setWebhooks([]);
    }
  }, []);

  const fetchDeliveries = useCallback(async () => {
    setLoadingDeliveries(true);
    try {
      const data = await apiClient.get('/api/dealer/webhooks/deliveries?limit=20');
      setDeliveries(data?.deliveries || data || []);
    } catch (err) {
      console.error('Failed to load deliveries', err);
      setDeliveries([]);
    } finally {
      setLoadingDeliveries(false);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
    fetchDeliveries();
  }, [fetchWebhooks, fetchDeliveries]);

  // ── realtime subscription ──────────────────────────────────────────────────

  useEffect(() => {
    if (!dealership?.id) return;

    const channel = supabase
      .channel(`dealer_webhook_deliveries_${dealership.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dealer_webhook_deliveries',
          filter: `dealership_id=eq.${dealership.id}`,
        },
        () => {
          fetchDeliveries();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealership?.id, fetchDeliveries]);

  // ── toast helper ──────────────────────────────────────────────────────────

  const showToast = (message, durationMs = 6000) => {
    setToast(message);
    setTimeout(() => setToast(null), durationMs);
  };

  // ── CRUD handlers ─────────────────────────────────────────────────────────

  const handleAdd = async (form) => {
    setModalSaving(true);
    setModalError(null);
    try {
      await apiClient.post('/api/dealer/webhooks', {
        label: form.label,
        url: form.url,
        events: form.events,
        secret: form.secret,
      });
      setShowAdd(false);
      fetchWebhooks();
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('503') || msg.toLowerCase().includes('encryption')) {
        setModalError('Encryption key not configured. Ask your admin to set DEALER_INTEGRATIONS_KEY.');
      } else {
        setModalError(msg || 'Failed to save webhook.');
      }
    } finally {
      setModalSaving(false);
    }
  };

  const handleEdit = async (form) => {
    if (!editTarget) return;
    setModalSaving(true);
    setModalError(null);
    try {
      const payload = {
        label: form.label,
        url: form.url,
        events: form.events,
      };
      if (form.secret) payload.secret = form.secret;
      await apiClient.patch(`/api/dealer/webhooks/${editTarget.id}`, payload);
      setEditTarget(null);
      fetchWebhooks();
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('503') || msg.toLowerCase().includes('encryption')) {
        setModalError('Encryption key not configured. Ask your admin to set DEALER_INTEGRATIONS_KEY.');
      } else {
        setModalError(msg || 'Failed to save webhook.');
      }
    } finally {
      setModalSaving(false);
    }
  };

  const handleToggleEnabled = async (webhook) => {
    try {
      await apiClient.patch(`/api/dealer/webhooks/${webhook.id}`, {
        enabled: !webhook.enabled,
      });
      setWebhooks((prev) =>
        prev.map((w) => (w.id === webhook.id ? { ...w, enabled: !w.enabled } : w))
      );
    } catch (err) {
      console.error('Toggle failed', err);
    }
  };

  const handleDelete = async (webhook) => {
    if (!window.confirm(`Delete webhook "${webhook.label}"? This cannot be undone.`)) return;
    try {
      await apiClient.delete(`/api/dealer/webhooks/${webhook.id}`);
      fetchWebhooks();
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const handleSendTest = async (webhook) => {
    try {
      const res = await apiClient.post(`/api/dealer/webhooks/${webhook.id}/test`, {});
      const code = res?.status_code ?? res?.code ?? '?';
      const sig = res?.signature ?? res?.x_dph_signature ?? '';
      const sigPreview = sig ? sig.slice(0, 32) : '—';
      showToast(`Status: ${code} · Signature: ${sigPreview}…`, 6000);
      fetchDeliveries();
    } catch (err) {
      showToast(`Test failed: ${err?.message || 'Unknown error'}`, 6000);
    }
  };

  // ── webhook label lookup ───────────────────────────────────────────────────

  const webhookById = (id) => (webhooks || []).find((w) => w.id === id);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Webhook size={18} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Outbound webhooks</h1>
            <p className="text-xs text-white/40 mt-0.5">
              Send events to your CRM or internal tools via HMAC-signed HTTP callbacks.
            </p>
          </div>
        </div>
        <button
          onClick={() => { setShowAdd(true); setModalError(null); }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex-shrink-0"
        >
          <Plus size={14} />
          Add webhook
        </button>
      </motion.div>

      {/* Webhooks table */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <p className="text-sm font-medium text-white/80">
            Configured endpoints
            {webhooks !== null && (
              <span className="ml-2 text-xs text-white/30">({webhooks.length})</span>
            )}
          </p>
          <button
            onClick={fetchWebhooks}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {webhooks === null ? (
          <div className="p-4"><Skeleton /></div>
        ) : webhooks.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-white/30">
            No webhooks yet. Click "Add webhook" to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {['Label', 'URL', 'Events', 'Enabled', 'Actions'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-white/30"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {webhooks.map((wh) => (
                  <tr key={wh.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-3 text-white/80 font-medium text-xs">{wh.label}</td>
                    <td className="px-4 py-3 text-white/40 text-xs font-mono">
                      {(wh.url || '').length > 40 ? (wh.url || '').slice(0, 40) + '…' : wh.url}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(wh.events || []).map((ev) => (
                          <span
                            key={ev}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-white/50"
                          >
                            {ev}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleEnabled(wh)}
                        className={`flex items-center gap-1.5 text-xs transition-colors ${
                          wh.enabled
                            ? 'text-emerald-400 hover:text-emerald-300'
                            : 'text-white/30 hover:text-white/50'
                        }`}
                      >
                        <Power size={13} />
                        {wh.enabled ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditTarget(wh); setModalError(null); }}
                          title="Edit"
                          className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          onClick={() => handleSendTest(wh)}
                          title="Send test"
                          className="p-1.5 rounded-lg text-white/30 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                        >
                          <Send size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(wh)}
                          title="Delete"
                          className="p-1.5 rounded-lg text-white/30 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Delivery log */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <p className="text-sm font-medium text-white/80">
            Delivery log
            {deliveries !== null && (
              <span className="ml-2 text-xs text-white/30">(last 20)</span>
            )}
          </p>
          <button
            onClick={fetchDeliveries}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {deliveries === null || loadingDeliveries ? (
          <div className="p-4"><Skeleton /></div>
        ) : deliveries.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-white/30">
            No deliveries yet. Send a test or wait for a real event.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {['Event', 'Webhook', 'Status', 'Attempts', 'Response', 'When'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-white/30"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {deliveries.map((d) => {
                  const wh = webhookById(d.webhook_id);
                  return (
                    <tr key={d.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-white/60">
                          {d.event_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-white/50">
                        {wh?.label || d.webhook_id?.slice(0, 8) || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={d.status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-white/40 text-center">
                        {d.attempt_count ?? 0}
                      </td>
                      <td className="px-4 py-3 text-xs text-white/40">
                        {d.last_response_code ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-white/30">
                        {formatRelativeTime(d.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>

      {/* Add modal */}
      {showAdd && (
        <WebhookForm
          initial={null}
          onSave={handleAdd}
          onCancel={() => { setShowAdd(false); setModalError(null); }}
          saving={modalSaving}
          error={modalError}
        />
      )}

      {/* Edit modal */}
      {editTarget && (
        <WebhookForm
          initial={{
            label: editTarget.label || '',
            url: editTarget.url || '',
            events: editTarget.events || [],
            secret: '',
          }}
          onSave={handleEdit}
          onCancel={() => { setEditTarget(null); setModalError(null); }}
          saving={modalSaving}
          error={modalError}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
};

export default DealerWebhooks;
