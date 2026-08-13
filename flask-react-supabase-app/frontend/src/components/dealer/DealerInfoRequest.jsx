import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { FileText, CheckCircle2, AlertCircle, Upload, Loader2, ShieldAlert } from 'lucide-react';

const API_BASE_URL = process.env.REACT_APP_API_URL
  || (typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : 'https://api.dphclassifieds.com');

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const formatExpiry = (iso) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
};

const DealerInfoRequest = () => {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [requestData, setRequestData] = useState(null);
  const [uploadingDoc, setUploadingDoc] = useState(null);
  const [perDocError, setPerDocError] = useState({});
  const [expiryByDoc, setExpiryByDoc] = useState({});

  const fetchRequest = useCallback(async () => {
    if (!token) {
      setLoadError('Missing token.');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setLoadError('');
      const resp = await fetch(`${API_BASE_URL}/api/info-requests/${token}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || 'This link is invalid or has expired.');
      }
      const data = await resp.json();
      setRequestData(data);
    } catch (e) {
      setLoadError(e.message || 'Failed to load request.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchRequest(); }, [fetchRequest]);

  const uploadsByLabel = useMemo(() => {
    const map = {};
    (requestData?.uploads || []).forEach((u) => {
      if (!map[u.document_label]) map[u.document_label] = [];
      map[u.document_label].push(u);
    });
    return map;
  }, [requestData]);

  const requiresExpiry = (docLabel) => ['trade license', 'trade licence'].includes(String(docLabel).toLowerCase());

  const handleFilePick = async (docLabel, file) => {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setPerDocError((prev) => ({ ...prev, [docLabel]: 'Only JPG, PNG, or PDF files are accepted.' }));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPerDocError((prev) => ({ ...prev, [docLabel]: 'File is over the 10MB limit.' }));
      return;
    }
    setPerDocError((prev) => ({ ...prev, [docLabel]: '' }));
    setUploadingDoc(docLabel);
    try {
      const formData = new FormData();
      formData.append('document_label', docLabel);
      formData.append('file', file);
      if (requiresExpiry(docLabel)) {
        const expiresAt = expiryByDoc[docLabel];
        if (!expiresAt) throw new Error('Choose the trade license expiry date before uploading.');
        formData.append('expires_at', expiresAt);
      }
      const resp = await fetch(`${API_BASE_URL}/api/info-requests/${token}/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || 'Upload failed.');
      }
      await fetchRequest();
    } catch (e) {
      setPerDocError((prev) => ({ ...prev, [docLabel]: e.message || 'Upload failed.' }));
    } finally {
      setUploadingDoc(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070d10] flex items-center justify-center px-4">
        <Loader2 size={28} className="text-emerald-400 animate-spin" />
      </div>
    );
  }

  if (loadError || !requestData) {
    return (
      <div className="min-h-screen bg-[#070d10] flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-[480px] bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 text-center">
          <ShieldAlert size={32} className="text-rose-400 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-white mb-1">Link unavailable</h1>
          <p className="text-sm text-white/55">{loadError || 'This request could not be loaded.'}</p>
        </div>
      </div>
    );
  }

  const { documents = [], message, status, expires_at: expiresAt, dealer_name: dealerName } = requestData;
  const isClosed = status === 'submitted' || status === 'cancelled' || status === 'expired';

  return (
    <div className="min-h-screen bg-[#070d10] px-4 py-12 sm:py-16">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="mx-auto w-full max-w-[640px] bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl shadow-2xl shadow-black/30 p-7 sm:p-9"
      >
        <div className="flex flex-col items-center gap-3 mb-7">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <FileText size={24} className="text-emerald-400" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white mb-1">
              Additional documents requested
            </h1>
            <p className="text-sm text-white/50">
              {dealerName ? `Hi ${dealerName}, ` : 'Hi, '}
              please upload the following so we can finish verifying your dealer account.
            </p>
            {expiresAt && (
              <p className="text-xs text-white/35 mt-2">Link expires {formatExpiry(expiresAt)}</p>
            )}
          </div>
        </div>

        {message && (
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl px-4 py-3 mb-6">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/35 mb-1.5">Note from review team</p>
            <p className="text-sm text-white/70 whitespace-pre-line leading-relaxed">{message}</p>
          </div>
        )}

        {status === 'submitted' && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-300">
              Thanks — we've received all your documents. Our team will review them and follow up.
            </p>
          </div>
        )}
        {status === 'cancelled' && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
            <AlertCircle size={18} className="text-amber-400 shrink-0" />
            <p className="text-sm text-amber-200">This request has been cancelled by the review team.</p>
          </div>
        )}
        {status === 'expired' && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
            <AlertCircle size={18} className="text-rose-400 shrink-0" />
            <p className="text-sm text-rose-200">This link has expired. Please contact support to get a new one.</p>
          </div>
        )}

        <div className="space-y-3">
          {documents.map((docLabel) => {
            const uploads = uploadsByLabel[docLabel] || [];
            const err = perDocError[docLabel];
            const isUploading = uploadingDoc === docLabel;
            return (
              <div
                key={docLabel}
                className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white break-words">{docLabel}</p>
                    <p className="text-xs text-white/40 mt-0.5">JPG, PNG, or PDF · up to 10MB</p>
                  </div>
                  {uploads.length > 0 && (
                    <span className="text-[11px] uppercase tracking-[0.14em] text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                      {uploads.length} file{uploads.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>

                {uploads.length > 0 && (
                  <ul className="mb-3 space-y-1">
                    {uploads.map((u) => (
                      <li key={u.id} className="text-xs text-white/60 truncate">• {u.filename}</li>
                    ))}
                  </ul>
                )}

                {requiresExpiry(docLabel) && !isClosed && (
                  <label className="block text-xs text-white/50 mb-3">
                    Trade license valid until
                    <input
                      type="date"
                      min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                      value={expiryByDoc[docLabel] || ''}
                      onChange={(e) => setExpiryByDoc((prev) => ({ ...prev, [docLabel]: e.target.value }))}
                      className="mt-1.5 w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                    />
                  </label>
                )}

                {!isClosed && (
                  <label className="inline-flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 rounded-lg px-3 py-2 text-xs font-medium cursor-pointer transition disabled:opacity-50">
                    {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {isUploading ? 'Uploading…' : uploads.length > 0 ? 'Upload another' : 'Choose file'}
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.pdf"
                      className="hidden"
                      disabled={isUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        handleFilePick(docLabel, f);
                      }}
                    />
                  </label>
                )}

                {err && (
                  <p className="mt-2 text-xs text-rose-300">{err}</p>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-white/30 mt-7 text-center">
          Your files are encrypted in transit and only visible to the DPH Classifieds review team.
        </p>
      </motion.div>
    </div>
  );
};

export default DealerInfoRequest;
