import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Lock, Check } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';

// ── Field config ──────────────────────────────────────────────────────────────

const FIELDS = [
  { key: 'name',       label: 'Dealership name',  type: 'text',     col: 'full' },
  { key: 'legal_name', label: 'Legal name',        type: 'text',     col: 'half' },
  { key: 'phone',      label: 'Phone',             type: 'tel',      col: 'half' },
  { key: 'whatsapp',   label: 'WhatsApp',          type: 'tel',      col: 'half' },
  { key: 'website',    label: 'Website',            type: 'url',      col: 'half' },
  { key: 'bio',        label: 'Bio',               type: 'textarea', col: 'full' },
];

const emptyForm = (dealership) =>
  Object.fromEntries(FIELDS.map(({ key }) => [key, dealership?.[key] || '']));

// ── Main component ────────────────────────────────────────────────────────────

const DealerSettings = () => {
  const { dealership, role, refresh } = useDealer();
  const [form, setForm] = useState(() => emptyForm(dealership));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Keep form in sync if dealership loads late
  useEffect(() => {
    if (dealership) setForm(emptyForm(dealership));
  }, [dealership]);

  if (role && role !== 'owner') {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-10 flex flex-col items-center gap-4 max-w-sm text-center">
          <Lock size={36} className="text-white/25" />
          <p className="text-white/60 text-sm">
            Only the dealership owner can edit settings.
          </p>
        </div>
      </div>
    );
  }

  const handleChange = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiClient.request('/api/dealer/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm(emptyForm(dealership));
    setError(null);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="text-3xl font-semibold text-white"
      >
        Settings
      </motion.h1>

      {/* Form card */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.06 }}
        className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
      >
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-5">
          Dealership profile
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FIELDS.map(({ key, label, type }) => {
            const isFull = key === 'name' || key === 'bio';
            return (
              <div key={key} className={isFull ? 'sm:col-span-2' : ''}>
                <label className="block text-xs text-white/50 mb-1.5" htmlFor={`field-${key}`}>
                  {label}
                </label>
                {type === 'textarea' ? (
                  <textarea
                    id={`field-${key}`}
                    rows={4}
                    value={form[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition resize-y"
                    placeholder={label}
                  />
                ) : (
                  <input
                    id={`field-${key}`}
                    type={type}
                    value={form[key]}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition"
                    placeholder={label}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-rose-300 text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-5 py-2 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saved ? (
              <>
                <Check size={14} />
                Saved
              </>
            ) : saving ? (
              'Saving…'
            ) : (
              'Save changes'
            )}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-5 py-2 text-sm transition border border-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default DealerSettings;
