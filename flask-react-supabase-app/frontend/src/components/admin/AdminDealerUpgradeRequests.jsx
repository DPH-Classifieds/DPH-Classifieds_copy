import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../utils/apiClient';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

function dealerLabel(dealer) {
  if (!dealer) return 'Unknown dealer';
  return dealer.legal_business_name || dealer.company_name || dealer.email || dealer.id;
}

export default function AdminDealerUpgradeRequests() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [filter, setFilter] = useState('pending');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get(`/api/admin/dealer/listing-upgrade-requests?status=${filter}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id, decision, newLimit) => {
    setBusy(id);
    try {
      await apiClient.post(`/api/admin/dealer/listing-upgrade-requests/${id}/decision`,
        { decision, new_limit: newLimit });
      await load();
    } catch (err) {
      const body = err?.response?.data;
      alert(body?.error || body?.message || err.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 text-white">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold">Dealer listing-upgrade requests</h1>
        <div className="flex items-center gap-2">
          {['pending', 'approved', 'rejected', 'cancelled'].map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                filter === s
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-white/50">Loading…</p>}
      {error && <p className="text-red-300">{error}</p>}
      {!loading && !error && !rows.length && (
        <p className="text-white/50">No {filter} upgrade requests.</p>
      )}

      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wider text-white/40">Dealer</div>
              <div className="text-lg font-semibold">{dealerLabel(r.dealer)}</div>
              <div className="text-sm text-white/60">{r.dealer?.email || r.dealer_id}</div>
              <div className="text-sm text-white/70 mt-2">
                <strong>Current:</strong> {r.current_limit} → <strong>Requested:</strong> {r.requested_limit}
              </div>
              <p className="text-sm text-white/70 mt-2">
                <strong>Reason:</strong> {r.reason}
              </p>
              <p className="text-xs text-white/40 mt-2">
                Submitted {fmt(r.created_at)}
                {r.resolved_at && <> · Resolved {fmt(r.resolved_at)}</>}
                {r.resolution_note && <> · &ldquo;{r.resolution_note}&rdquo;</>}
              </p>
            </div>
            {r.status === 'pending' && (
              <div className="flex flex-col gap-2 min-w-[180px]">
                <button
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, 'approve', r.requested_limit)}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-medium disabled:opacity-50"
                >
                  Approve ({r.requested_limit})
                </button>
                <button
                  disabled={busy === r.id}
                  onClick={() => decide(r.id, 'reject')}
                  className="px-4 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
            {r.status !== 'pending' && (
              <span className="self-start px-3 py-1 rounded-full text-xs border border-white/10 text-white/60 capitalize">
                {r.status}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
