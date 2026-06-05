// flask-react-supabase-app/frontend/src/components/dealer/DealerLeads.jsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Inbox, Phone, MessageCircle, Eye, FileText, Loader2 } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';
import DealerLeadStatusPill from './DealerLeadStatusPill';
import useDealerLeadsRealtime from './useDealerLeadsRealtime';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'test_drive', label: 'Test drive' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];
const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'call', label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'vin_open', label: 'VIN reveal' },
  { value: 'form', label: 'Form' },
];

const SOURCE_ICONS = {
  call: Phone,
  whatsapp: MessageCircle,
  vin_open: Eye,
  form: FileText,
};

const PAGE_SIZE = 50;

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function DealerLeads() {
  const { dealership, loading: dealerLoading } = useDealer();

  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [offset, setOffset] = useState(0);

  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set('limit', String(PAGE_SIZE));
    qs.set('offset', String(offset));
    if (status) qs.set('status', status);
    if (source) qs.set('source', source);
    return qs.toString();
  }, [status, source, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiClient.get(`/api/dealer/leads?${params}`);
      setLeads(resp.leads || []);
      setTotal(resp.total ?? null);
    } catch (e) {
      setError(e.message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => { load(); }, [load]);

  // Toast for incoming realtime leads — auto-dismiss after 5s.
  const [toast, setToast] = useState(null);

  // Realtime: a new lead lands → prepend if it matches current filters; else just bump total.
  useDealerLeadsRealtime(dealership?.id, useCallback((row) => {
    setLeads((prev) => {
      if (status && row.status !== status) return prev;
      if (source && row.source !== source) return prev;
      return [row, ...prev.filter((r) => r.id !== row.id)].slice(0, PAGE_SIZE);
    });
    setTotal((prev) => (prev == null ? prev : prev + 1));
    setToast({ id: row.id, source: row.source, listing_id: row.listing_id });
    setTimeout(() => setToast((t) => (t && t.id === row.id ? null : t)), 5000);
  }, [status, source]));

  if (dealerLoading) {
    return (
      <div className="p-8 text-white/60 flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading dealership…
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-[1400px] mx-auto">
      <header className="flex flex-wrap items-center gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Inbox size={18} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Leads</h1>
            <p className="text-sm text-white/50">
              {total != null ? `${total.toLocaleString('en-AE')} total` : 'Loading total…'}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
            className="text-sm rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/80 px-3 py-2"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={source}
            onChange={(e) => { setSource(e.target.value); setOffset(0); }}
            className="text-sm rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/80 px-3 py-2"
          >
            {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-rose-200">
          {error}
        </div>
      )}

      {/* Realtime toast for new leads */}
      {toast && (
        <Link
          to={`/dealer/leads/${toast.id}`}
          className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 backdrop-blur-md px-4 py-3 text-emerald-100 shadow-lg"
        >
          <Inbox size={14} />
          <span className="text-sm">
            New {toast.source} lead — listing {String(toast.listing_id).slice(0, 8)}
          </span>
        </Link>
      )}

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        {loading && !leads.length ? (
          <div className="p-10 text-white/40 flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : !leads.length ? (
          <div className="p-10 text-white/40">No leads match your filters.</div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {leads.map((lead, i) => {
              const Icon = SOURCE_ICONS[lead.source] || Phone;
              return (
                <motion.li
                  key={lead.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(0.02 * i, 0.4) }}
                >
                  <Link
                    to={`/dealer/leads/${lead.id}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                      <Icon size={14} className="text-white/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/80 truncate">
                        {lead.listing_type} · {lead.listing_id?.slice(0, 8)}
                      </p>
                      <p className="text-xs text-white/40 truncate">
                        {lead.event_count} touch{lead.event_count === 1 ? '' : 'es'} · last {relTime(lead.last_event_at)}
                      </p>
                    </div>
                    <DealerLeadStatusPill status={lead.status} />
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>

      {total != null && total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 text-sm text-white/60">
          <button
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] disabled:opacity-30"
          >
            ← Prev
          </button>
          <span>Showing {offset + 1}–{Math.min(offset + leads.length, total)} of {total}</span>
          <button
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={offset + leads.length >= total}
            className="px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
