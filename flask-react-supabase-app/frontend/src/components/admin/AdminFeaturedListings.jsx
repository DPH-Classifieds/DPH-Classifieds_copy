import React, { useEffect, useState, useCallback, useMemo } from 'react';
import apiClient from '../../utils/apiClient';

const LISTING_TYPES = [
  { key: 'car',   label: 'Car' },
  { key: 'bike',  label: 'Bike' },
  { key: 'plate', label: 'Plate' },
  { key: 'part',  label: 'Part' },
];

const DURATION_PRESETS = [
  { label: '24 hours',     days: 1 },
  { label: '3 days',       days: 3 },
  { label: '7 days',       days: 7 },
  { label: '14 days',      days: 14 },
  { label: '30 days',      days: 30 },
  { label: '90 days',      days: 90 },
  { label: 'Until removed', days: null },
];

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

function isExpired(until) {
  if (!until) return false;
  return new Date(until).getTime() <= Date.now();
}

function FeatureForm({ onClose, onCreated }) {
  const [listingType, setListingType] = useState('car');
  const [listingId, setListingId] = useState('');
  const [duration, setDuration] = useState(7);
  const [customDate, setCustomDate] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      let featuredUntil = null;
      if (customDate) {
        featuredUntil = new Date(customDate).toISOString();
      } else if (duration) {
        const d = new Date();
        d.setDate(d.getDate() + Number(duration));
        featuredUntil = d.toISOString();
      }
      const data = await apiClient.post('/api/admin/featured-listings', {
        listing_type: listingType,
        listing_id: listingId.trim(),
        featured_until: featuredUntil,
        note: note.trim() || undefined,
      });
      onCreated(data);
    } catch (err) {
      const body = err?.response?.data;
      setError(body?.error || body?.message || err.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={submit}
        className="bg-[#0c1410] border border-white/10 rounded-2xl p-6 w-full max-w-md space-y-4 text-white"
      >
        <h3 className="text-lg font-semibold">Feature a listing</h3>
        <label className="block">
          <span className="text-sm text-white/70">Listing type</span>
          <select
            value={listingType}
            onChange={(e) => setListingType(e.target.value)}
            className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white"
          >
            {LISTING_TYPES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-white/70">Listing ID (UUID)</span>
          <input
            type="text"
            required
            value={listingId}
            onChange={(e) => setListingId(e.target.value)}
            placeholder="e.g. 1a2b3c4d-…"
            className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white font-mono text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm text-white/70">Duration</span>
            <select
              value={duration ?? '__null'}
              onChange={(e) => setDuration(e.target.value === '__null' ? null : Number(e.target.value))}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white"
            >
              {DURATION_PRESETS.map((d) => (
                <option key={d.label} value={d.days ?? '__null'}>{d.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm text-white/70">Or custom date</span>
            <input
              type="datetime-local"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm text-white/70">Note (optional)</span>
          <input
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. homepage spotlight for launch week"
            className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white"
          />
        </label>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-white/70 hover:text-white">Cancel</button>
          <button
            type="submit"
            disabled={submitting || !listingId.trim()}
            className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-medium disabled:opacity-50"
          >
            {submitting ? 'Featuring…' : 'Feature listing'}
          </button>
        </div>
      </form>
    </div>
  );
}

function FeaturedRow({ row, onRemoved, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const expired = isExpired(row.featured_until);
  const typeLabel = LISTING_TYPES.find((t) => t.key === row.listing_type)?.label || row.listing_type;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-white/40 bg-white/[0.06] border border-white/10 rounded-full px-2 py-0.5">
            {typeLabel}
          </span>
          <span className="text-base font-semibold text-white truncate">{row.title}</span>
          {expired && (
            <span className="text-[10px] uppercase tracking-wider text-red-300 bg-red-500/10 border border-red-500/30 rounded-full px-2 py-0.5">
              Expired
            </span>
          )}
        </div>
        <div className="text-xs text-white/50 font-mono truncate">{row.listing_id}</div>
        <div className="text-xs text-white/60">
          Featured {fmt(row.featured_at)}
          {' · '}
          {row.featured_until ? <>until <strong>{fmt(row.featured_until)}</strong></> : <em>no expiry</em>}
          {row.note && <> · &ldquo;{row.note}&rdquo;</>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {row.listing?.is_approved === false && (
          <span className="text-[10px] text-amber-300 border border-amber-500/30 rounded-full px-2 py-0.5">
            Listing not approved
          </span>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await apiClient.delete(`/api/admin/featured-listings/${row.id}`);
              onRemoved(row.id);
            } finally { setBusy(false); }
          }}
          className="px-3 py-1.5 rounded-lg text-sm border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-50"
        >
          {busy ? '…' : 'Remove'}
        </button>
      </div>
    </div>
  );
}

export default function AdminFeaturedListings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = showInactive
        ? '/api/admin/featured-listings?include_inactive=1'
        : '/api/admin/featured-listings';
      const data = await apiClient.get(url);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => !isExpired(r.featured_until));
    const byType = active.reduce((acc, r) => {
      acc[r.listing_type] = (acc[r.listing_type] || 0) + 1;
      return acc;
    }, {});
    return { total: rows.length, active: active.length, byType };
  }, [rows]);

  return (
    <div className="space-y-5 text-white">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Featured listings</h1>
          <p className="text-sm text-white/50 mt-1">
            {stats.active} active · {rows.length - stats.active} expired · {Object.entries(stats.byType).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-white/60 flex items-center gap-2">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-white/20"
            />
            Show expired
          </label>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-medium"
          >
            + Feature a listing
          </button>
        </div>
      </div>

      {loading && <p className="text-white/50">Loading…</p>}
      {error && <p className="text-red-300">{error}</p>}
      {!loading && !error && !rows.length && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <p className="text-white/50">No featured listings yet.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 text-sm text-amber-300 hover:text-amber-200"
          >
            Feature your first listing →
          </button>
        </div>
      )}

      {rows.map((r) => (
        <FeaturedRow
          key={r.id}
          row={r}
          onRemoved={(id) => setRows((prev) => prev.filter((x) => x.id !== id))}
          onUpdated={load}
        />
      ))}

      {showForm && (
        <FeatureForm
          onClose={() => setShowForm(false)}
          onCreated={(r) => {
            setShowForm(false);
            setRows((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
          }}
        />
      )}
    </div>
  );
}
