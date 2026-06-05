// flask-react-supabase-app/frontend/src/components/dealer/DealerLeadDetail.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Send, MessageSquare, Activity, ExternalLink } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';
import DealerLeadStatusPill from './DealerLeadStatusPill';

const STATUS_FLOW = ['new', 'contacted', 'quoted', 'test_drive', 'won', 'lost'];
const LOST_REASONS = [
  { value: 'price', label: 'Price' },
  { value: 'financing', label: 'Financing' },
  { value: 'stock', label: 'Out of stock' },
  { value: 'unreachable', label: 'Could not reach' },
  { value: 'other', label: 'Other' },
];

function fmtTime(ts) {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export default function DealerLeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role, actorKind } = useDealer();

  const [data, setData] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [saving, setSaving] = useState(false);

  // Members list for the assignee picker — served by Phase 1 core.py.
  // The endpoint returns [{id, user_id, role, status, user: {id, email, first_name, ...}}]
  useEffect(() => {
    let cancelled = false;
    apiClient.get('/api/dealer/members')
      .then((resp) => { if (!cancelled) setMembers(resp.members || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiClient.get(`/api/dealer/leads/${id}`);
      setData(resp);
    } catch (e) {
      setError(e.message || 'Failed to load lead');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (body) => {
    setSaving(true);
    try {
      await apiClient.patch(`/api/dealer/leads/${id}`, body);
      await load();
    } catch (e) {
      setError(e.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [id, load]);

  const addNote = useCallback(async (e) => {
    e?.preventDefault?.();
    const body = noteBody.trim();
    if (!body) return;
    setSaving(true);
    try {
      await apiClient.post(`/api/dealer/leads/${id}/note`, { body });
      setNoteBody('');
      await load();
    } catch (err) {
      setError(err.message || 'Failed to add note');
    } finally {
      setSaving(false);
    }
  }, [id, noteBody, load]);

  if (loading) {
    return (
      <div className="p-8 text-white/60 flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading lead…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-rose-200">{error}</div>
        <button onClick={() => navigate('/dealer/leads')} className="mt-4 text-sm text-white/60 underline">Back to inbox</button>
      </div>
    );
  }
  if (!data?.lead) return null;

  const { lead, listing, timeline = [], session = [] } = data;
  const canEditAll = actorKind === 'admin' || role === 'owner' || role === 'manager';

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto">
      <Link to="/dealer/leads" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white/80 mb-4">
        <ArrowLeft size={14} /> Back to inbox
      </Link>

      <header className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-xl font-semibold text-white">Lead · {lead.source}</h1>
        <DealerLeadStatusPill status={lead.status} />
        <span className="text-xs text-white/40">{lead.event_count} touches</span>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">

        <div className="space-y-6">
          {listing && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-1">Listing</p>
                <p className="text-base font-semibold text-white">{listing.title}</p>
                <p className="text-sm text-white/50">
                  {listing.price ? `AED ${Number(listing.price).toLocaleString('en-AE')}` : 'Price on request'}
                </p>
              </div>
              <Link
                to={`/dealer/listings/${listing.type}/${listing.id}/analytics`}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-white/70 hover:text-white"
              >
                Open analytics <ExternalLink size={11} />
              </Link>
            </div>
          )}

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-3 flex items-center gap-2">
              <Activity size={11} /> Timeline
            </p>
            {!timeline.length ? (
              <p className="text-white/40 text-sm">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {timeline.map((e) => (
                  <li key={e.id} className="text-sm flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-400/70 mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white/80">
                        <span className="font-medium capitalize">{e.kind.replace('_', ' ')}</span>
                        {' '}
                        {e.kind === 'note' && e.payload?.body && (
                          <span className="text-white/70"> — {e.payload.body}</span>
                        )}
                        {e.kind === 'status_change' && (
                          <span className="text-white/60"> {e.payload?.from || '—'} → {e.payload?.to}</span>
                        )}
                        {e.kind === 'inbound_contact' && (
                          <span className="text-white/60"> ({e.payload?.source})</span>
                        )}
                      </p>
                      <p className="text-[11px] text-white/30">{fmtTime(e.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={addNote} className="mt-5 flex items-end gap-2">
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Add a note…"
                className="flex-1 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/80 text-sm px-3 py-2 min-h-[60px]"
              />
              <button
                type="submit"
                disabled={saving || !noteBody.trim()}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 disabled:opacity-50"
              >
                <Send size={14} /> Post
              </button>
            </form>
          </div>

          {!!session.length && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-3">
                Visitor session ({session.length})
              </p>
              <ul className="text-sm space-y-1 text-white/70">
                {session.slice(0, 20).map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="text-[11px] text-white/30 w-28">{fmtTime(s.created_at)}</span>
                    <span className="text-white/40">{s.event_name}</span>
                    <span className="truncate">{s.page_path}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-3">Status</p>
            <select
              value={lead.status}
              onChange={(e) => patch({ status: e.target.value })}
              disabled={saving}
              className="w-full text-sm rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/80 px-3 py-2"
            >
              {STATUS_FLOW.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            {lead.status === 'won' && (
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-1">Sale price (AED)</p>
                <input
                  type="number"
                  defaultValue={lead.sale_price ?? ''}
                  onBlur={(e) => patch({ sale_price: e.target.value ? Number(e.target.value) : null })}
                  className="w-full text-sm rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/80 px-3 py-2"
                />
              </div>
            )}
            {lead.status === 'lost' && (
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-1">Lost reason</p>
                <select
                  value={lead.lost_reason || ''}
                  onChange={(e) => patch({ lost_reason: e.target.value || null })}
                  disabled={saving}
                  className="w-full text-sm rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/80 px-3 py-2"
                >
                  <option value="">—</option>
                  {LOST_REASONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {canEditAll && (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
              <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 mb-3 flex items-center gap-2">
                <MessageSquare size={11} /> Assignee
              </p>
              <select
                value={lead.assigned_to || ''}
                onChange={(e) => patch({ assigned_to: e.target.value || null })}
                disabled={saving || !members.length}
                className="w-full text-sm rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/80 px-3 py-2"
              >
                <option value="">— Unassigned —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.user?.first_name || m.user?.email || String(m.user_id).slice(0, 8)}
                    {m.role ? ` (${m.role})` : ''}
                  </option>
                ))}
              </select>
              {!members.length && (
                <p className="mt-2 text-[11px] text-white/30">No team members loaded yet.</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
