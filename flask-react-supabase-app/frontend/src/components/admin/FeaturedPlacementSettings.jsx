import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../utils/apiClient';

const DEFAULT_PATTERN = [{ type: 'featured', count: 1 }, { type: 'normal', count: 5 }];

// Backend shape is [{featured: N} | {normal: N}] — flatten to {type, count}
// rows for the editor, which is easier to render/mutate.
const toRows = (pattern) => (pattern || []).map((seg) => (
  'featured' in seg ? { type: 'featured', count: seg.featured } : { type: 'normal', count: seg.normal }
));
const toPattern = (rows) => rows.map((r) => ({ [r.type]: Number(r.count) }));

const previewCycle = (rows, totalSlots = 24) => {
  const seq = [];
  if (!rows.length) return seq;
  let i = 0;
  while (seq.length < totalSlots) {
    const row = rows[i % rows.length];
    for (let n = 0; n < Number(row.count || 0) && seq.length < totalSlots; n++) {
      seq.push(row.type);
    }
    i++;
    if (i > rows.length * 50) break; // guard against a pathological 0-count pattern
  }
  return seq;
};

export default function FeaturedPlacementSettings() {
  const [rows, setRows] = useState(toRows(DEFAULT_PATTERN));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get('/api/admin/featured-placement/settings');
      setRows(toRows(data?.pattern) || toRows(DEFAULT_PATTERN));
    } catch (err) {
      setError(err?.details?.error || err?.message || 'Failed to load placement settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(false);
  };

  const addRow = () => {
    setRows((prev) => [...prev, { type: 'normal', count: 3 }]);
    setSaved(false);
  };

  const removeRow = (index) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const pattern = toPattern(rows);
      const data = await apiClient.patch('/api/admin/featured-placement/settings', { pattern });
      setRows(toRows(data?.pattern));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err?.details?.error || err?.message || 'Failed to save placement settings');
    } finally {
      setSaving(false);
    }
  };

  const preview = previewCycle(rows);

  return (
    <div className="space-y-5 text-white max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Featured placement pattern</h2>
        <p className="text-sm text-white/50 mt-1">
          Controls how featured listings are woven into the normal feed on the landing page and Explore —
          e.g. 3 featured, then 3 normal, then 2 featured, then 4 normal, then 1 featured, then repeat.
          Only affects the default (unfiltered, newest-first) view — search, filters, and custom sorts
          always show plain results.
        </p>
      </div>

      {loading ? (
        <p className="text-white/50">Loading…</p>
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <span className="text-xs text-white/40 w-6 text-center">{i + 1}</span>
                <select
                  value={row.type}
                  onChange={(e) => updateRow(i, { type: e.target.value })}
                  className="rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm text-white"
                >
                  <option value="featured">Featured</option>
                  <option value="normal">Normal</option>
                </select>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={row.count}
                  onChange={(e) => updateRow(i, { count: e.target.value })}
                  className="w-20 rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 text-sm text-white"
                />
                <span className="text-xs text-white/40 flex-1">
                  {row.type === 'featured' ? 'featured listing' : 'normal listing'}{Number(row.count) === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={rows.length <= 1}
                  className="text-white/40 hover:text-rose-300 disabled:opacity-30 text-sm px-2"
                  title="Remove step"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="text-sm text-amber-300 hover:text-amber-200"
          >
            + Add a step
          </button>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[11px] uppercase tracking-wider text-white/40 mb-2">Preview (cycles forever)</p>
            <div className="flex flex-wrap gap-1">
              {preview.map((type, i) => (
                <span
                  key={i}
                  title={type}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                    type === 'featured'
                      ? 'bg-amber-400 text-amber-950'
                      : 'bg-white/10 text-white/50'
                  }`}
                >
                  {type === 'featured' ? '★' : '·'}
                </span>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save pattern'}
            </button>
            {saved && <span className="text-sm text-emerald-300">Saved.</span>}
          </div>
        </>
      )}
    </div>
  );
}
