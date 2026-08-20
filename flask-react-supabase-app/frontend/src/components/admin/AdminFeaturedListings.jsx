import React, { useEffect, useState, useCallback, useMemo } from 'react';
import apiClient from '../../utils/apiClient';
import ListingPicker from './ListingPicker';
import FeatureListingModal from './FeatureListingModal';

const LISTING_TYPES = [
  { key: 'car',   label: 'Car' },
  { key: 'bike',  label: 'Bike' },
  { key: 'plate', label: 'Plate' },
  { key: 'part',  label: 'Part' },
];

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

function isExpired(until) {
  if (!until) return false;
  return new Date(until).getTime() <= Date.now();
}

function FeaturedRow({ row, onRemoved, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
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
            setError(null);
            try {
              await apiClient.delete(`/api/admin/featured-listings/${row.id}`);
              onRemoved(row.id);
            } catch (err) {
              setError(err?.details?.error || err?.message || 'Failed to remove featured listing');
            } finally { setBusy(false); }
          }}
          className="px-3 py-1.5 rounded-lg text-sm border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-50"
        >
          {busy ? '…' : 'Remove'}
        </button>
      </div>
      {error && <p className="text-xs text-red-300 md:col-span-2">{error}</p>}
    </div>
  );
}

export default function AdminFeaturedListings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickedListing, setPickedListing] = useState(null);
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
      setError(err?.details?.error || err.message || 'Failed to load');
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
            onClick={() => setShowPicker(true)}
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
            onClick={() => setShowPicker(true)}
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

      {showPicker && (
        <ListingPicker
          onClose={() => setShowPicker(false)}
          onSelect={(picked) => {
            setShowPicker(false);
            setPickedListing(picked);
          }}
        />
      )}

      {pickedListing && (
        <FeatureListingModal
          listingType={pickedListing.listingType}
          listingId={pickedListing.listingId}
          title={pickedListing.title}
          onClose={() => setPickedListing(null)}
          onCreated={(r) => {
            setPickedListing(null);
            setRows((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
          }}
        />
      )}
    </div>
  );
}
