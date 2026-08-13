import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Building2,
  FileText,
  Receipt,
  ShieldCheck,
  ShieldOff,
  CheckCircle,
  XCircle,
  RotateCcw,
  Phone,
  Mail,
  MapPin,
  X,
  Activity,
  BarChart2,
  AlertTriangle,
  MailQuestion,
  Send,
  Clock,
} from 'lucide-react';
import apiClient from '../utils/apiClient';
import { GlassCard, KpiTile, EmptyState } from './ui/dashboard';
import { DEALER_REJECTION_REASONS } from './admin/rejectionConstants';
import {
  formatDateTime,
  formatNumber,
  getDisplayName,
  getEventActorLabel,
  getStatusTone,
} from './admin/adminUtils';

/* ── helpers ─────────────────────────────────────────────────────────────── */

const statusBadgeClass = (status) => {
  const t = getStatusTone(status);
  if (t === 'success') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (t === 'danger') return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
};

const docStatusClass = (status) => {
  if (status === 'approved') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (status === 'denied') return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
};

const Badge = ({ children, className = '' }) => (
  <span className={`text-[10px] font-semibold rounded-full border px-2.5 py-1 ${className}`}>
    {children}
  </span>
);

const SectionLabel = ({ children }) => (
  <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-3">{children}</p>
);

const InfoRow = ({ icon: Icon, label, value, mono = false }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon size={12} className="text-white/30" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.12em] text-white/30 font-medium">{label}</p>
        <p className={`text-sm text-white/70 mt-0.5 break-all${mono ? ' font-mono' : ''}`}>{value}</p>
      </div>
    </div>
  );
};

/* ── document type config ─────────────────────────────────────────────────── */
const DOC_TYPES = [
  { key: 'trade_license', label: 'Trade License', icon: FileText },
  { key: 'company_registration', label: 'Company Registration', icon: Building2 },
  { key: 'tax_registration', label: 'Tax Registration (TRN)', icon: Receipt },
];

const INFO_REQUEST_STANDARD_DOCUMENTS = DOC_TYPES.map(({ key, label }) => ({ key, label }));

/* ── loading skeleton ─────────────────────────────────────────────────────── */
const Skeleton = () => (
  <div className="text-white space-y-5 animate-pulse">
    <div className="h-4 w-32 bg-white/[0.06] rounded-lg" />
    <div className="h-9 w-64 bg-white/[0.06] rounded-xl" />
    <div className="grid grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => <div key={i} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 h-80" />)}
    </div>
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 h-40" />
  </div>
);

/* ── deny modal ───────────────────────────────────────────────────────────── */
const DenyModal = ({ doc, docLabel, onClose, onConfirm, busy }) => {
  const [denyReason, setDenyReason] = useState(doc?.denial_reason || '');
  const [denyFix, setDenyFix] = useState(doc?.denial_fix || '');
  if (!doc) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1000] px-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          className="bg-[#0f1117] border border-white/10 rounded-2xl p-7 max-w-lg w-full shadow-2xl"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-white">Deny {docLabel}</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white transition p-1"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">Reason for denial *</label>
              <input
                type="text"
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                placeholder="e.g. Document is expired or unclear"
                className="w-full bg-white/[0.05] border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm text-white/80 placeholder-white/25 focus:outline-none focus:border-rose-500/40"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5">How to fix it *</label>
              <textarea
                rows={3}
                value={denyFix}
                onChange={(e) => setDenyFix(e.target.value)}
                placeholder="e.g. Upload a clear photo of your current trade license"
                className="w-full bg-white/[0.05] border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm text-white/80 placeholder-white/25 resize-none focus:outline-none focus:border-rose-500/40"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm text-white/50 hover:text-white border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm(doc.id, 'deny', denyReason, denyFix)}
                disabled={busy || !denyReason || !denyFix}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-500 hover:bg-rose-400 text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Denying…' : 'Confirm Denial'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ── reject dealer modal ──────────────────────────────────────────────────── */
const RejectModal = ({ show, onClose, onConfirm, busy }) => {
  const [rejectReasonIndex, setRejectReasonIndex] = useState('');
  const [note, setNote] = useState('');
  if (!show) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1000] px-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          className="bg-[#0f1117] border border-white/10 rounded-2xl p-7 max-w-lg w-full shadow-2xl"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-white">Reject Dealer Application</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white transition p-1"><X size={18} /></button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">Reason for rejection *</label>
              <select
                value={rejectReasonIndex}
                onChange={(e) => setRejectReasonIndex(e.target.value)}
                className="w-full bg-white/[0.05] border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500/40"
              >
                <option value="">Select a reason…</option>
                {DEALER_REJECTION_REASONS.map((item, idx) => (
                  <option key={idx} value={idx}>{item.reason}</option>
                ))}
              </select>
            </div>
            {rejectReasonIndex !== '' && (
              <div className="p-3 rounded-xl bg-rose-500/[0.08] border border-rose-500/20">
                <p className="text-[11px] text-rose-300 font-semibold uppercase tracking-wide mb-1">How to fix:</p>
                <p className="text-sm text-white/70">{DEALER_REJECTION_REASONS[Number(rejectReasonIndex)].fix}</p>
              </div>
            )}
            <div>
              <label className="block text-xs text-white/50 mb-1.5">Additional notes (optional)</label>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add any extra context…"
                className="w-full bg-white/[0.05] border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm text-white/80 placeholder-white/25 resize-none focus:outline-none focus:border-amber-500/40"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm text-white/50 hover:text-white border border-white/10 bg-white/5 hover:bg-white/10 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm(rejectReasonIndex, note)}
                disabled={busy || rejectReasonIndex === ''}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-500 hover:bg-rose-400 text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ── request more info modal ──────────────────────────────────────────────── */
const RequestMoreInfoModal = ({ show, onClose, onConfirm, busy }) => {
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [otherDocument, setOtherDocument] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!show) {
      setSelectedDocuments([]);
      setOtherDocument('');
      setMessage('');
    }
  }, [show]);

  if (!show) return null;

  const toggleDocument = (label) => {
    setSelectedDocuments((current) => (
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
    ));
  };
  const cleanDocs = [...selectedDocuments, ...otherDocument.split('\n').map((item) => item.trim()).filter(Boolean)];
  const canSubmit = cleanDocs.length > 0 && !busy;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[1000] px-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 8 }}
          transition={{ duration: 0.2 }}
          className="bg-[#0f1117] border border-white/10 rounded-2xl p-7 max-w-lg w-full shadow-2xl"
        >
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-white">Request more information</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white transition p-1"><X size={18} /></button>
          </div>
          <p className="text-xs text-white/45 mb-5">
            Select standard verification documents where possible. They return directly to the normal review queue. The dealer also receives a secure upload link.
          </p>

          <div className="space-y-3 mb-4">
            <label className="block text-xs text-white/50">Documents required *</label>
            <div className="grid grid-cols-1 gap-2">
              {INFO_REQUEST_STANDARD_DOCUMENTS.map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2.5 rounded-xl border border-white/[0.10] bg-white/[0.03] px-3 py-2.5 text-sm text-white/75 cursor-pointer hover:bg-white/[0.06]">
                  <input
                    type="checkbox"
                    checked={selectedDocuments.includes(label)}
                    onChange={() => toggleDocument(label)}
                    className="accent-emerald-400"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <label className="block text-xs text-white/50 pt-1">Other document (optional)</label>
            <textarea
              rows={2}
              value={otherDocument}
              onChange={(e) => setOtherDocument(e.target.value)}
              placeholder="One document per line, e.g. shareholder passport"
              className="w-full bg-white/[0.05] border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm text-white/80 placeholder-white/25 resize-none focus:outline-none focus:border-emerald-500/40"
            />
          </div>

          <div className="mb-5">
            <label className="block text-xs text-white/50 mb-1.5">Note for the dealer (optional)</label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Explain what you need or why, in plain language…"
              className="w-full bg-white/[0.05] border border-white/[0.12] rounded-xl px-3 py-2.5 text-sm text-white/80 placeholder-white/25 resize-none focus:outline-none focus:border-emerald-500/40"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-white/50 hover:text-white border border-white/10 bg-white/5 hover:bg-white/10 transition"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(cleanDocs, message.trim())}
              disabled={!canSubmit}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-emerald-950 transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Send size={14} />
              {busy ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ═══════════════════════════════════════════════════════════════════════════ */

const AdminDealerDetail = () => {
  const { dealerId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [dealerDocs, setDealerDocs] = useState([]);
  const [reviewingDocId, setReviewingDocId] = useState(null);
  const [denyModalDoc, setDenyModalDoc] = useState(null);
  const [showInfoRequestModal, setShowInfoRequestModal] = useState(false);
  const [infoRequests, setInfoRequests] = useState([]);
  const [infoRequestNotice, setInfoRequestNotice] = useState('');
  const [sendingInfoRequest, setSendingInfoRequest] = useState(false);
  const [adLimitDraft, setAdLimitDraft] = useState('');
  const [adLimitSaving, setAdLimitSaving] = useState(false);
  const [adLimitMessage, setAdLimitMessage] = useState('');
  const [cancellingRequestId, setCancellingRequestId] = useState(null);

  const refreshData = async () => {
    const response = await apiClient.get(`/api/admin/dealers/${dealerId}/overview`);
    setData(response || null);
    const currentLimit = response?.dealer?.dealer_listing_limit;
    setAdLimitDraft(currentLimit === null || currentLimit === undefined ? '' : String(currentLimit));
    const docsResp = await apiClient.get(`/api/admin/dealers/${dealerId}/documents`);
    setDealerDocs(docsResp?.documents || []);
    try {
      const infoResp = await apiClient.get(`/api/admin/dealers/${dealerId}/info-requests`);
      setInfoRequests(infoResp?.requests || []);
    } catch (_) {
      setInfoRequests([]);
    }
  };

  const handleCreateInfoRequest = async (documents, message) => {
    setSendingInfoRequest(true);
    try {
      const result = await apiClient.post(`/api/admin/dealers/${dealerId}/info-requests`, {
        documents,
        message,
      });
      setInfoRequestNotice(result?.email_sent === false
        ? 'Secure request created, but email could not be delivered. Copy the link below and send it to the dealer manually.'
        : 'Request created and the dealer has been sent a secure upload link.');
      setShowInfoRequestModal(false);
      await refreshData();
    } catch (e) {
      setError(e.message || 'Failed to send info request');
    } finally {
      setSendingInfoRequest(false);
    }
  };

  const handleCancelInfoRequest = async (requestId) => {
    setCancellingRequestId(requestId);
    try {
      await apiClient.post(`/api/admin/info-requests/${requestId}/cancel`, {});
      await refreshData();
    } catch (e) {
      setError(e.message || 'Failed to cancel request');
    } finally {
      setCancellingRequestId(null);
    }
  };

  const copyInfoRequestLink = async (token) => {
    if (!token) return;
    const url = `${window.location.origin}/dealer-info-request/${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {
      // Clipboard may be blocked; fall back to a prompt so the admin can copy manually.
      window.prompt('Copy the link:', url);
    }
  };

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        setLoading(true);
        await refreshData();
      } catch (fetchError) {
        console.error('Failed to load dealer overview:', fetchError);
        setError(fetchError.message || 'Failed to load dealer overview');
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [dealerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dealer = data?.dealer || {};
  const summary = data?.summary || {};
  const recentListings = data?.recent_listings || [];
  const recentEvents = data?.recent_events || [];
  const listingTotals = useMemo(() => Object.entries(data?.listing_summary || {}), [data]);

  const handleReviewDocument = async (docId, action, denyReason = '', fix = '') => {
    setReviewingDocId(docId);
    try {
      await apiClient.post(`/api/admin/dealer-documents/${docId}/review`, {
        action,
        denial_reason: denyReason,
        denial_fix: fix,
      });
      await refreshData();
    } catch (err) {
      console.error('Failed to review document:', err);
    } finally {
      setReviewingDocId(null);
      setDenyModalDoc(null);
    }
  };

  const handleVerify = async () => {
    try {
      setActionLoading(true);
      await apiClient.post(`/api/admin/dealers/${dealerId}/verify`);
      await refreshData();
    } catch (actionError) {
      setError(actionError.message || 'Failed to verify dealer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveAdLimit = async () => {
    setAdLimitMessage('');
    let payload;
    if (adLimitDraft === '' || adLimitDraft === null) {
      payload = { limit: null };
    } else {
      const parsed = Number.parseInt(adLimitDraft, 10);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 10000) {
        setAdLimitMessage('Enter a whole number between 0 and 10000, or leave blank for default.');
        return;
      }
      payload = { limit: parsed };
    }
    try {
      setAdLimitSaving(true);
      const resp = await apiClient.request(`/api/admin/dealers/${dealerId}/listing-limit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      setAdLimitMessage(
        payload.limit === null
          ? `Cleared. Dealer now uses default (${resp?.default_limit ?? 20}).`
          : `Saved. Dealer can post up to ${resp?.effective_limit ?? payload.limit} active listings.`
      );
      await refreshData();
    } catch (saveError) {
      setAdLimitMessage(saveError?.message || 'Failed to save ad limit.');
    } finally {
      setAdLimitSaving(false);
    }
  };

  const handleReject = async (reasonIdx, note) => {
    try {
      setActionLoading(true);
      const selected = reasonIdx !== '' ? DEALER_REJECTION_REASONS[Number(reasonIdx)] : null;
      const fullNote = selected
        ? `${selected.reason}${note.trim() ? ` - ${note.trim()}` : ''}`
        : note || 'Rejected by admin';
      await apiClient.post(`/api/admin/dealers/${dealerId}/reject`, {
        rejection_note: fullNote,
        rejection_reason: selected?.reason || '',
        rejection_fix: selected?.fix || '',
      });
      await refreshData();
      setShowRejectModal(false);
    } catch (actionError) {
      setError(actionError.message || 'Failed to reject dealer');
    } finally {
      setActionLoading(false);
    }
  };

  /* ── derived ──────────────────────────────────────────────────────────── */
  const activeDocs = dealerDocs.filter((d) => !d.replaced_at);
  const allDocsApproved = DOC_TYPES.every((type) =>
    activeDocs.some((doc) => doc.document_type === type.key && doc.status === 'approved')
  ) && !activeDocs.some((doc) => (
    doc.document_type === 'trade_license'
    && doc.expires_at
    && new Date(doc.expires_at) <= new Date(new Date().toDateString())
  ));

  const getDocByType = (type) => activeDocs.find((d) => d.document_type === type);
  const isPdf = (doc) => doc?.file_type === 'application/pdf' || doc?.filename?.toLowerCase().endsWith('.pdf');

  const initial = (dealer.company_name || getDisplayName(dealer) || '??').slice(0, 2).toUpperCase();

  if (loading) return <Skeleton />;

  if (error && !data) {
    return (
      <div className="text-white flex flex-col items-center justify-center py-24 gap-4">
        <Building2 size={48} className="text-white/20" />
        <p className="text-lg font-semibold text-white/70">Dealer not available</p>
        <p className="text-sm text-white/40">{error}</p>
        <button
          onClick={() => navigate('/admin/dealers')}
          className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-emerald-400 transition-colors mt-2"
        >
          <ArrowLeft size={14} /> Back to dealers
        </button>
      </div>
    );
  }

  return (
    <div className="text-white space-y-5">

      {/* Breadcrumb */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <Link
          to="/admin/dealers"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-emerald-400 transition-colors"
        >
          <ArrowLeft size={14} /> Back to dealers
        </Link>
      </motion.div>

      {/* Hero card */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <GlassCard>
          <div className="flex items-start gap-5 flex-wrap">
            {/* Avatar */}
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xl font-bold text-emerald-400">{initial}</span>
            </div>

            {/* Identity */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap mb-1">
                <h1 className="text-3xl font-semibold text-white">
                  {dealer.company_name || getDisplayName(dealer)}
                </h1>
                <Badge className={dealer.dealer_verified
                  ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                  : 'text-amber-300 bg-amber-500/10 border-amber-500/20'}>
                  {dealer.dealer_verified ? 'Verified' : 'Pending verification'}
                </Badge>
                <Badge className={statusBadgeClass(dealer.account_status)}>
                  {dealer.account_status || 'active'}
                </Badge>
              </div>
              <p className="text-sm text-white/50">{dealer.email || 'No email'}</p>
              <p className="text-xs text-white/30 mt-1">
                {dealer.phone || ''}{dealer.phone && dealer.emirate ? ' · ' : ''}{dealer.emirate || ''}
              </p>
            </div>

            {/* Document status badges */}
            <div className="flex gap-2 flex-wrap">
              {DOC_TYPES.map(({ key, label }) => {
                const doc = getDocByType(key);
                const s = doc?.status || 'missing';
                return (
                  <Badge key={key} className={docStatusClass(s)}>
                    {label}: {s === 'approved' ? 'Approved' : s === 'denied' ? 'Denied' : s === 'pending' ? 'Pending' : 'Missing'}
                  </Badge>
                );
              })}
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* KPI row */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <KpiTile label="Total Listings" value={summary.total_listings ?? 0} icon={BarChart2} />
        <KpiTile label="Total Views" value={summary.total_views ?? 0} icon={Activity} />
        <KpiTile label="Qualified Leads" value={summary.qualified_leads ?? 0} icon={Phone} />
        <KpiTile label="Reports" value={summary.recent_reports ?? 0} icon={AlertTriangle} />
      </motion.div>

      {/* Document review grid */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-5"
      >
        {DOC_TYPES.map(({ key, label, icon: DocIcon }) => {
          const doc = getDocByType(key);
          const status = doc?.status || 'missing';
          return (
            <GlassCard key={key}>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                  <DocIcon size={14} className="text-white/40" />
                </div>
                <div>
                  <SectionLabel>{label}</SectionLabel>
                </div>
                <Badge className={`ml-auto ${docStatusClass(status)}`}>{status === 'approved' ? 'Approved' : status === 'denied' ? 'Denied' : status === 'pending' ? 'Pending' : 'Missing'}</Badge>
              </div>

              {/* Document preview */}
              {doc ? (
                <div className="space-y-3">
                  {/* Preview */}
                  <div className="rounded-xl overflow-hidden border border-white/[0.06] bg-white/[0.02]" style={{ height: '300px' }}>
                    {isPdf(doc) ? (
                      <div className="flex flex-col items-center justify-center h-full gap-3">
                        <FileText size={40} className="text-white/20" />
                        <a
                          href={doc.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300 transition font-medium"
                        >
                          Download PDF
                        </a>
                        <p className="text-xs text-white/30">{doc.filename}</p>
                      </div>
                    ) : (
                      <a href={doc.download_url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={doc.download_url}
                          alt={label}
                          className="w-full h-full object-cover hover:scale-[1.02] transition-transform cursor-zoom-in"
                          onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                        />
                      </a>
                    )}
                  </div>

                  {/* File info */}
                  <div className="text-xs text-white/40 space-y-0.5">
                    <p className="truncate">{doc.filename}</p>
                    {doc.uploaded_at && <p>Uploaded {formatDateTime(doc.uploaded_at)}</p>}
                    {doc.expires_at && (() => {
                      const exp = new Date(doc.expires_at);
                      const today = new Date(); today.setHours(0,0,0,0);
                      const days = Math.floor((exp - today) / (1000 * 60 * 60 * 24));
                      let tone = 'text-emerald-300';
                      let label = `Expires ${doc.expires_at}`;
                      if (days < 0) { tone = 'text-rose-300'; label = `Expired ${Math.abs(days)} day(s) ago`; }
                      else if (days <= 30) { tone = 'text-amber-300'; label = `Expires in ${days} day(s) (${doc.expires_at})`; }
                      return <p className={tone}>{label}</p>;
                    })()}
                  </div>

                  {/* Denial info */}
                  {status === 'denied' && doc.denial_reason && (
                    <div className="p-3 rounded-xl bg-rose-500/[0.08] border border-rose-500/20">
                      <p className="text-[10px] text-rose-300 font-semibold uppercase tracking-wide mb-1">Denial reason</p>
                      <p className="text-sm text-white/70">{doc.denial_reason}</p>
                      {doc.denial_fix && (
                        <p className="text-xs text-amber-300 mt-1"><span className="font-medium">Fix:</span> {doc.denial_fix}</p>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  {status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={reviewingDocId === doc.id}
                        onClick={() => handleReviewDocument(doc.id, 'approve')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-xl px-3 py-2.5 text-sm transition disabled:opacity-40"
                      >
                        <CheckCircle size={14} />
                        {reviewingDocId === doc.id ? 'Working…' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        disabled={reviewingDocId === doc.id}
                        onClick={() => setDenyModalDoc(doc)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl px-3 py-2.5 text-sm transition font-semibold disabled:opacity-40"
                      >
                        <XCircle size={14} />
                        Deny
                      </button>
                    </div>
                  )}

                  {status === 'approved' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/20">
                      <CheckCircle size={14} className="text-emerald-400" />
                      <span className="text-sm text-emerald-300 font-medium">Approved</span>
                      <button
                        type="button"
                        disabled={reviewingDocId === doc.id}
                        onClick={() => handleReviewDocument(doc.id, 'pending')}
                        className="ml-auto text-[10px] text-white/40 hover:text-white border border-white/10 rounded-lg px-2 py-1 bg-white/[0.04] transition"
                      >
                        Re-review
                      </button>
                    </div>
                  )}

                  {status === 'denied' && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={reviewingDocId === doc.id}
                        onClick={() => setDenyModalDoc(doc)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl px-3 py-2 text-sm transition font-medium disabled:opacity-40"
                      >
                        Update denial
                      </button>
                      <button
                        type="button"
                        disabled={reviewingDocId === doc.id}
                        onClick={() => handleReviewDocument(doc.id, 'pending')}
                        className="inline-flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white border border-white/10 rounded-xl px-3 py-2 text-sm transition"
                      >
                        <RotateCcw size={13} />
                        Re-review
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState
                  icon={DocIcon}
                  title="Not submitted"
                  description={`No ${label.toLowerCase()} has been uploaded yet.`}
                />
              )}
            </GlassCard>
          );
        })}
      </motion.div>

      {/* Final action + right sidebar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-5"
      >
        {/* Final action card (left 2/3) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Final verification decision */}
          <GlassCard>
            <SectionLabel>Final Action</SectionLabel>
            <p className="text-sm text-white/50 mb-5">
              Approve the dealer only when all three documents are verified. The applicant will receive an email on both outcomes.
            </p>

            {!allDocsApproved && dealerDocs.length > 0 && (
              <div className="mb-4 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-500/[0.07] border border-amber-500/20">
                <AlertTriangle size={15} className="text-amber-300 flex-shrink-0" />
                <p className="text-sm text-amber-300">
                  All 3 documents must be approved before the dealer can be verified.
                </p>
              </div>
            )}

            <div className="flex gap-3 flex-wrap">
              {!dealer.dealer_verified && (
                <button
                  type="button"
                  disabled={actionLoading || !allDocsApproved}
                  onClick={handleVerify}
                  className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-xl px-5 py-3 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ShieldCheck size={15} />
                  {actionLoading ? 'Working…' : 'Approve dealer'}
                </button>
              )}

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setShowRejectModal(true)}
                className="inline-flex items-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl px-5 py-3 text-sm transition font-semibold disabled:opacity-40"
              >
                <ShieldOff size={15} />
                Reject application
              </button>

              <button
                type="button"
                onClick={() => setShowInfoRequestModal(true)}
                className="inline-flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl px-5 py-3 text-sm transition font-semibold"
              >
                <MailQuestion size={15} />
                Request more info
              </button>

              <button
                type="button"
                onClick={() => navigate(`/admin/users/${dealerId}`)}
                className="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 rounded-xl px-5 py-3 text-sm transition"
              >
                Open user profile
              </button>
            </div>

            {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
          </GlassCard>

          {/* Listing breakdown */}
          {listingTotals.length > 0 && (
            <GlassCard>
              <SectionLabel>Listing mix</SectionLabel>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {listingTotals.map(([type, bucket]) => (
                  <div key={type} className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-3">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium mb-1">{type}</p>
                    <p className="text-2xl font-semibold text-white tabular-nums">{formatNumber(bucket.count || 0)}</p>
                    <p className="text-xs text-white/40 mt-1">{formatNumber(bucket.views || 0)} views · {formatNumber(bucket.approved || 0)} approved</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {/* Recent listings */}
          {recentListings.length > 0 && (
            <GlassCard>
              <SectionLabel>Recent listings</SectionLabel>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Listing</th>
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Type</th>
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Status</th>
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Views</th>
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentListings.map((lst) => (
                      <tr key={`${lst.type}-${lst.id}`} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition">
                        <td className="py-2.5">
                          <Link
                            to={`/admin/listings/${lst.type}/${lst.id}`}
                            className="text-white/70 hover:text-emerald-400 transition"
                          >
                            {lst.title}
                          </Link>
                        </td>
                        <td className="py-2.5 text-white/50 capitalize">{lst.type}</td>
                        <td className="py-2.5">
                          <Badge className={statusBadgeClass(lst.status)}>{lst.status}</Badge>
                        </td>
                        <td className="py-2.5 text-white/50 tabular-nums">{formatNumber(lst.view_count)}</td>
                        <td className="py-2.5 text-white/40 text-xs">{formatDateTime(lst.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}

          {/* Recent events */}
          {recentEvents.length > 0 && (
            <GlassCard>
              <SectionLabel>Recent activity</SectionLabel>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Actor</th>
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Context</th>
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">Action</th>
                      <th className="text-left text-[11px] uppercase tracking-[0.14em] text-white/30 font-medium pb-2">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvents.slice(0, 12).map((event) => (
                      <tr key={event.id} className="border-b border-white/[0.04] last:border-0">
                        <td className="py-2.5 text-white/70">{getEventActorLabel(event)}</td>
                        <td className="py-2.5 text-white/50">{event.listing_type} · {event.listing_id}</td>
                        <td className="py-2.5">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300">
                            {event.action}
                          </span>
                        </td>
                        <td className="py-2.5 text-white/40 text-xs">{formatDateTime(event.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          )}
        </div>

        {/* Right sidebar: applicant info */}
        <div className="space-y-4">
          <GlassCard>
            <SectionLabel>Applicant info</SectionLabel>
            <InfoRow icon={Building2} label="Dealership name" value={dealer.company_name} />
            <InfoRow icon={Building2} label="Legal business name" value={dealer.legal_business_name || dealer.legal_name || (dealer.first_name ? `${dealer.first_name} ${dealer.last_name || ''}`.trim() : null)} />
            <InfoRow icon={FileText} label="TRN" value={dealer.trn} mono />
            <InfoRow icon={FileText} label="Trade license no." value={dealer.trade_license_number} />
            <InfoRow icon={FileText} label="Company reg. no." value={dealer.company_registration_number} />
            <InfoRow icon={FileText} label="Application status" value={dealer.dealer_application_status || (dealer.dealer_verified ? 'approved' : 'draft')} />
            <InfoRow icon={MapPin} label="Emirate" value={dealer.emirate} />
            <InfoRow icon={MapPin} label="City" value={dealer.city} />
            <InfoRow icon={MapPin} label="Address" value={dealer.address} />
            <InfoRow icon={Phone} label="Phone" value={dealer.phone} />
            <InfoRow icon={Phone} label="WhatsApp" value={dealer.whatsapp_number} />
            <InfoRow icon={Mail} label="Email" value={dealer.email} />
            <InfoRow icon={Building2} label="Profile completion" value={dealer.profile_completion_percentage != null ? `${dealer.profile_completion_percentage}%` : null} />
            <InfoRow icon={FileText} label="Verified at" value={dealer.dealer_verified_at ? formatDateTime(dealer.dealer_verified_at) : null} />
            <InfoRow icon={FileText} label="Verification requested" value={dealer.dealer_verification_requested_at ? formatDateTime(dealer.dealer_verification_requested_at) : null} />
            {dealer.rejection_note && (
              <div className="mt-3 p-3 rounded-xl bg-rose-500/[0.07] border border-rose-500/20">
                <p className="text-[10px] uppercase tracking-wide text-rose-300 font-medium mb-1">Rejection note</p>
                <p className="text-sm text-white/70">{dealer.rejection_note}</p>
              </div>
            )}
          </GlassCard>

          {/* Verification signals */}
          <GlassCard>
            <SectionLabel>Verification signals</SectionLabel>
            {[
              { label: 'Email verified', value: dealer.email_verified },
              { label: 'Phone verified', value: dealer.phone_verified },
              { label: 'Dealer verified', value: dealer.dealer_verified },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
                <span className="text-sm text-white/60">{label}</span>
                {value
                  ? <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle size={12} /> Yes</span>
                  : <span className="inline-flex items-center gap-1 text-xs text-white/30"><XCircle size={12} /> No</span>
                }
              </div>
            ))}
            <div className="mt-3 pt-3 border-t border-white/[0.04]">
              <p className="text-xs text-white/30 mb-2">Documents submitted</p>
              {dealerDocs.length === 0 ? (
                <p className="text-sm text-white/30 italic">None submitted</p>
              ) : (
                dealerDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between py-1.5">
                    <span className="text-xs text-white/50">
                      {DOC_TYPES.find((t) => t.key === doc.document_type)?.label || doc.document_type}
                    </span>
                    <Badge className={docStatusClass(doc.status)}>{doc.status}</Badge>
                  </div>
                ))
              )}
            </div>
          </GlassCard>

          {/* Ad limit */}
          <GlassCard className="mt-5">
            <SectionLabel>Ad limit</SectionLabel>
            <p className="text-xs text-white/40 mb-3">
              Total active listings this dealer can post across cars, bikes, parts, and plates.
              Leave blank to use the platform default.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="10000"
                value={adLimitDraft}
                onChange={(e) => setAdLimitDraft(e.target.value)}
                placeholder="Default"
                className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                disabled={adLimitSaving}
              />
              <button
                type="button"
                onClick={handleSaveAdLimit}
                disabled={adLimitSaving}
                className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm transition disabled:opacity-50"
              >
                {adLimitSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {adLimitMessage && (
              <p className="mt-2 text-[12px] text-emerald-300/80">{adLimitMessage}</p>
            )}
            {dealer.dealer_listing_limit != null && (
              <p className="mt-2 text-[11px] text-white/40">
                Currently set to {dealer.dealer_listing_limit}. Takes effect on next post.
              </p>
            )}
          </GlassCard>

          {/* Info requests history */}
          {(infoRequests.length > 0 || infoRequestNotice) && (
            <GlassCard className="mt-5">
              <div className="flex items-center justify-between mb-3">
                <SectionLabel>Info requests</SectionLabel>
                <span className="text-[11px] text-white/30">{infoRequests.length} total</span>
              </div>
              {infoRequestNotice && (
                <p className="mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                  {infoRequestNotice}
                </p>
              )}
              <div className="space-y-3">
                {infoRequests.map((req) => {
                  const uploads = req.dealer_info_request_uploads || [];
                  const requestedCount = (req.requested_documents || []).length;
                  const tone = req.status === 'submitted'
                    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                    : req.status === 'pending'
                      ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                      : 'text-white/40 bg-white/[0.04] border-white/10';
                  return (
                    <div
                      key={req.id}
                      className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <p className="text-xs text-white/40 mb-0.5">
                            <Clock size={11} className="inline mr-1" />
                            Sent {req.created_at ? new Date(req.created_at).toLocaleString() : '—'}
                          </p>
                          <p className="text-white/70 text-xs">
                            {uploads.length} of {requestedCount} uploaded
                            {req.submitted_at ? ` · submitted ${new Date(req.submitted_at).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                        <span className={`text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border ${tone}`}>
                          {req.status}
                        </span>
                      </div>
                      <ul className="space-y-1 mb-2">
                        {(req.requested_documents || []).map((label) => {
                          const docUploads = uploads.filter((u) => u.document_label === label);
                          return (
                            <li key={label} className="flex items-start justify-between gap-2 text-xs">
                              <span className={`min-w-0 truncate ${docUploads.length ? 'text-white/65' : 'text-white/45'}`}>
                                {docUploads.length ? '• ' : '◦ '}{label}
                              </span>
                              {docUploads.length > 0 && docUploads[docUploads.length - 1].download_url && (
                                <a
                                  href={docUploads[docUploads.length - 1].download_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-emerald-300 hover:text-emerald-200 shrink-0"
                                >
                                  view
                                </a>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <div className="flex gap-2 mt-2">
                        {req.token && req.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => copyInfoRequestLink(req.token)}
                            className="text-[11px] text-white/55 hover:text-white border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 rounded-lg px-2.5 py-1 transition"
                          >
                            Copy link
                          </button>
                        )}
                        {req.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleCancelInfoRequest(req.id)}
                            disabled={cancellingRequestId === req.id}
                            className="text-[11px] text-rose-300 hover:text-rose-200 border border-rose-500/20 hover:border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 rounded-lg px-2.5 py-1 transition disabled:opacity-40"
                          >
                            {cancellingRequestId === req.id ? 'Cancelling…' : 'Cancel'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          )}
        </div>
      </motion.div>

      {/* Deny document modal */}
      {denyModalDoc && (
        <DenyModal
          doc={denyModalDoc}
          docLabel={DOC_TYPES.find((t) => t.key === denyModalDoc.document_type)?.label || denyModalDoc.document_type}
          onClose={() => setDenyModalDoc(null)}
          onConfirm={handleReviewDocument}
          busy={reviewingDocId === denyModalDoc?.id}
        />
      )}

      {/* Reject dealer modal */}
      <RejectModal
        show={showRejectModal}
        onClose={() => { setShowRejectModal(false); }}
        onConfirm={handleReject}
        busy={actionLoading}
      />

      {/* Request more info modal */}
      <RequestMoreInfoModal
        show={showInfoRequestModal}
        onClose={() => setShowInfoRequestModal(false)}
        onConfirm={handleCreateInfoRequest}
        busy={sendingInfoRequest}
      />
    </div>
  );
};

export default AdminDealerDetail;
