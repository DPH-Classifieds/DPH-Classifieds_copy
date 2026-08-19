import React, { useState } from 'react';
import apiClient from '../../utils/apiClient';

const TYPE_LABELS = { car: 'Car', bike: 'Bike', plate: 'Plate', part: 'Part' };

const DURATION_PRESETS = [
  { label: '24 hours',      days: 1 },
  { label: '3 days',        days: 3 },
  { label: '7 days',        days: 7 },
  { label: '14 days',       days: 14 },
  { label: '30 days',       days: 30 },
  { label: '90 days',       days: 90 },
  { label: 'Until removed', days: null },
];

/**
 * Feature-a-listing modal. The listing itself is already known by the time
 * this opens (either picked via ListingPicker, or the row an admin is
 * already looking at on the Listings page) — this only collects duration
 * and an optional note, then POSTs to /api/admin/featured-listings.
 */
export default function FeatureListingModal({ listingType, listingId, title, onClose, onCreated }) {
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
        listing_id: listingId,
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
        <h3 className="text-lg font-semibold">Feature listing</h3>
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-white/40">
            {TYPE_LABELS[listingType] || listingType}
          </span>
          <p className="text-sm text-white truncate">{title}</p>
          <p className="text-[11px] text-white/30 font-mono truncate">{listingId}</p>
        </div>
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
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-medium disabled:opacity-50"
          >
            {submitting ? 'Featuring…' : 'Feature listing'}
          </button>
        </div>
      </form>
    </div>
  );
}
