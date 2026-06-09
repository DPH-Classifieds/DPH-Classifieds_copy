import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Lock, Check, FileText, Upload, AlertTriangle } from 'lucide-react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';
import { getBestAccessToken } from '../../utils/supabaseClient';

const DOC_TYPES = [
  { key: 'trade_license', label: 'Trade license', requiresExpiry: true },
  { key: 'company_registration', label: 'Company registration', requiresExpiry: false },
  { key: 'tax_registration', label: 'Tax registration (TRN)', requiresExpiry: false },
];

const API_URL = process.env.REACT_APP_API_URL
  || (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : 'https://api.dphclassifieds.com');

const statusToClass = (status, days) => {
  if (status === 'denied') return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  if (status === 'approved' && days != null && days < 0) return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  if (status === 'approved' && days != null && days <= 30) return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  if (status === 'approved') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (status === 'pending') return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  return 'text-white/40 bg-white/[0.04] border-white/[0.10]';
};

const DealerDocumentsSection = () => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingKey, setUploadingKey] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await apiClient.get('/api/user/dealer-documents');
      const active = (resp?.documents || []).filter((d) => !d.replaced_at);
      setDocs(active);
    } catch (err) {
      setMessage(err?.message || 'Could not load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (docType, file, expiresAt) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    if (!file) return;
    if (!allowed.includes(file.type)) {
      setMessage('File must be PDF, PNG, or JPG');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setMessage('File must be 10 MB or smaller');
      return;
    }
    const meta = DOC_TYPES.find((d) => d.key === docType) || {};
    if (meta.requiresExpiry && !expiresAt) {
      setMessage('Please pick an expiry date');
      return;
    }
    try {
      setUploadingKey(docType);
      setMessage('');
      const token = await getBestAccessToken();
      const form = new FormData();
      form.append('document_type', docType);
      form.append('file', file);
      if (expiresAt) form.append('expires_at', expiresAt);
      const resp = await fetch(`${API_URL}/api/auth/upload-dealer-document`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.error || 'Upload failed');
      }
      setMessage('Uploaded. Awaiting admin review.');
      await load();
    } catch (err) {
      setMessage(err?.message || 'Upload failed');
    } finally {
      setUploadingKey(null);
    }
  };

  const byType = (key) => docs.find((d) => d.document_type === key);

  const expiringSoon = docs.find((d) => {
    if (!d.expires_at) return false;
    const days = Math.floor((new Date(d.expires_at) - new Date()) / 86400000);
    return days <= 30;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.12 }}
      className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/20 p-5"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">Documents</p>
        {expiringSoon && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle size={12} /> A document expires soon
          </span>
        )}
      </div>
      <p className="text-xs text-white/40 mb-4">
        Upload or replace your trade license, company registration, and tax registration here.
        We&apos;ll email you 30 days before your trade license expires.
      </p>
      {loading ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : (
        <div className="space-y-3">
          {DOC_TYPES.map((meta) => {
            const doc = byType(meta.key);
            const days = doc?.expires_at
              ? Math.floor((new Date(doc.expires_at) - new Date()) / 86400000)
              : null;
            const inputId = `dealer-doc-${meta.key}`;
            const dateId = `dealer-doc-date-${meta.key}`;
            return (
              <div key={meta.key} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                  <FileText size={14} className="text-white/40" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white/80 font-medium">{meta.label}</p>
                  {doc ? (
                    <p className="text-[11px] text-white/40 mt-0.5">
                      Uploaded {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : ''}
                      {doc.expires_at && (
                        <>
                          {' · '}
                          {days < 0
                            ? `Expired ${Math.abs(days)} day(s) ago`
                            : `Expires in ${days} day(s) (${doc.expires_at})`}
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="text-[11px] text-white/30 mt-0.5">Not uploaded yet</p>
                  )}
                  {doc?.status === 'denied' && doc.denial_reason && (
                    <p className="text-[11px] text-rose-300 mt-1">Denied: {doc.denial_reason}</p>
                  )}
                </div>
                <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${statusToClass(doc?.status, days)}`}>
                  {doc?.status || 'missing'}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {meta.requiresExpiry && (
                    <input
                      id={dateId}
                      type="date"
                      min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                      className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
                      defaultValue=""
                    />
                  )}
                  <input
                    id={inputId}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0];
                      const dateEl = document.getElementById(dateId);
                      const exp = dateEl ? dateEl.value : '';
                      handleUpload(meta.key, f, exp);
                      e.target.value = '';
                    }}
                  />
                  <label
                    htmlFor={inputId}
                    className={`inline-flex items-center gap-1 cursor-pointer text-xs px-3 py-1.5 rounded-full border transition ${
                      uploadingKey === meta.key
                        ? 'opacity-50 bg-white/5 border-white/10'
                        : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                    }`}
                  >
                    <Upload size={12} />
                    {doc ? 'Replace' : 'Upload'}
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {message && (
        <p className="mt-3 text-xs text-white/50">{message}</p>
      )}
      <DealerApplicationSubmit
        hasTradeLicense={Boolean(byType('trade_license'))}
        onSubmitted={() => setMessage('Application submitted — admin review pending.')}
      />
    </motion.div>
  );
};

const DealerApplicationSubmit = ({ hasTradeLicense, onSubmitted }) => {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const me = await apiClient.get('/api/auth/me');
        setStatus(me?.user?.dealer_application_status || me?.dealer_application_status || null);
      } catch (_) {
        setStatus(null);
      }
    })();
  }, []);

  if (status !== 'draft' || !hasTradeLicense) return null;

  const handleSubmit = async () => {
    try {
      setBusy(true);
      setErr('');
      await apiClient.post('/api/auth/dealer-submit-application', {});
      setStatus('submitted');
      onSubmitted && onSubmitted();
    } catch (e) {
      setErr(e?.message || 'Failed to submit application');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
      <p className="text-sm text-emerald-200 mb-2">
        Trade license uploaded. Submit your application so an admin can review it.
      </p>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={busy}
        className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm transition disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
      {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
    </div>
  );
};

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

      <DealerDocumentsSection />
    </div>
  );
};

export default DealerSettings;
