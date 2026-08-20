import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, Eye, Building2 } from 'lucide-react';
import apiClient from '../utils/apiClient';
import { GlassCard, EmptyState, SegmentedControl } from './ui/dashboard';
import { DEALER_REJECTION_REASONS } from './admin/rejectionConstants';

const TABS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
];

const SkeletonCard = () => (
  <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-5 space-y-4 animate-pulse">
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-white/5 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-white/5 rounded-full w-3/4" />
        <div className="h-2.5 bg-white/5 rounded-full w-1/2" />
      </div>
    </div>
    <div className="flex gap-2">
      {[1, 2, 3].map((k) => <div key={k} className="h-6 bg-white/5 rounded-full flex-1" />)}
    </div>
    <div className="flex gap-2">
      <div className="h-8 bg-white/5 rounded-full flex-1" />
      <div className="h-8 w-8 bg-white/5 rounded-full" />
      <div className="h-8 w-8 bg-white/5 rounded-full" />
    </div>
  </div>
);

// Mirrors the same readiness verdict the backend's verify/reject endpoints
// gate on (_evaluate_dealer_application in app.py), attached per-dealer by
// GET /api/admin/dealers as `readiness`. One status per required document
// type — driven by whatever the backend lists as required, not hardcoded.
const getDocChips = (dealer) => {
  const r = dealer.readiness;
  if (!r) return [];
  return (r.required_documents || []).map((docType) => {
    let status = 'missing';
    if (r.approved_documents?.includes(docType)) status = 'approved';
    else if (r.denied_documents?.includes(docType)) status = 'denied';
    else if (r.pending_documents?.includes(docType)) status = 'pending';
    return { docType, label: r.document_labels?.[docType] || docType, status };
  });
};

const DocChip = ({ label, status }) => {
  const map = {
    approved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    pending: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    denied: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    missing: 'bg-white/5 text-white/30 border-white/10',
  };
  const s = String(status || 'missing').toLowerCase();
  return (
    <div className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl border ${map[s] || map.missing}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] opacity-70">{label}</span>
      <span className="text-[10px] capitalize font-medium">{s}</span>
    </div>
  );
};

const AdminDealers = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [dealers, setDealers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectDealerId, setRejectDealerId] = useState(null);
  const [rejectReasonIndex, setRejectReasonIndex] = useState('');
  const [rejectNote, setRejectNote] = useState('');

  const rawTab = (searchParams.get('filter') || 'pending').toLowerCase();
  // Keep old deep links working while presenting the lifecycle language used
  // by the unified Dealerships hub.
  const tab = rawTab === 'verified' ? 'active' : rawTab;

  const loadDealers = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get('/api/admin/dealers');
      setDealers(Array.isArray(response) ? response : []);
    } catch (loadError) {
      console.error('Failed to fetch dealers:', loadError);
      setError('Failed to load dealer requests.');
      setDealers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDealers();
  }, []);

  const filteredDealers = useMemo(() => {
    if (tab === 'pending') return dealers.filter((d) => !d.dealer_verified);
    if (tab === 'active') return dealers.filter((d) => Boolean(d.dealer_verified));
    return dealers;
  }, [dealers, tab]);

  const dealerSummary = useMemo(() => {
    const verified = dealers.filter((d) => Boolean(d.dealer_verified)).length;
    const pending = dealers.filter((d) => !d.dealer_verified).length;
    return { total: dealers.length, verified, pending };
  }, [dealers]);

  const updateDealerStatus = async (dealerId, approved) => {
    setActionLoadingId(dealerId);
    setError('');
    const endpoint = approved
      ? `/api/admin/dealers/${dealerId}/verify`
      : `/api/admin/dealers/${dealerId}/reject`;
    try {
      await apiClient.post(endpoint, approved ? {} : { reason: 'Rejected by admin' });
      await loadDealers();
    } catch (actionError) {
      console.error('Failed to update dealer status:', actionError);
      setError(actionError.message || 'Failed to update dealer status.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectDealerId || rejectReasonIndex === '') return;
    setActionLoadingId(rejectDealerId);
    setError('');
    try {
      const selected = DEALER_REJECTION_REASONS[Number(rejectReasonIndex)];
      const note = selected
        ? `${selected.reason}${rejectNote.trim() ? ` - ${rejectNote.trim()}` : ''}`
        : rejectNote || 'Rejected by admin';
      await apiClient.post(`/api/admin/dealers/${rejectDealerId}/reject`, {
        rejection_note: note,
        rejection_reason: selected?.reason || '',
        rejection_fix: selected?.fix || '',
      });
      await loadDealers();
      setShowRejectModal(false);
      setRejectDealerId(null);
      setRejectReasonIndex('');
      setRejectNote('');
    } catch (actionError) {
      console.error('Failed to reject dealer:', actionError);
      setError(actionError.message || 'Failed to reject dealer.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') {
      params.delete('filter');
    } else {
      params.set('filter', next);
    }
    setSearchParams(params);
  };

  return (
    <div className="min-h-screen px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-white">Dealer verification</h1>
          <p className="text-sm text-white/50 mt-1">Review trade licenses and TRN certificates from pending dealer applicants.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
            {dealerSummary.verified} verified
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
            {dealerSummary.pending} pending
          </span>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: dealerSummary.total },
          { label: 'Verified', value: dealerSummary.verified },
          { label: 'Pending', value: dealerSummary.pending },
        ].map((kpi) => (
          <GlassCard key={kpi.label} className="flex flex-col gap-1">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">{kpi.label}</p>
            <p className="text-2xl font-semibold text-white">{kpi.value}</p>
          </GlassCard>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between gap-4">
        <SegmentedControl
          options={TABS}
          value={tab === 'all' ? 'all' : tab}
          onChange={setTab}
        />
        {error && (
          <p className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-1.5">
            {error}
          </p>
        )}
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filteredDealers.length === 0 ? (
        <GlassCard>
          <EmptyState icon={Building2} title={`No ${tab === 'all' ? '' : tab} dealer applicants.`} />
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredDealers.map((dealer, i) => {
            const name = `${dealer.first_name || ''} ${dealer.last_name || ''}`.trim() || 'Applicant';
            const companyName = dealer.company_name || name;
            const initial = companyName[0]?.toUpperCase() || 'D';
            const isVerified = Boolean(dealer.dealer_verified);
            const loadingForRow = actionLoadingId === dealer.id;
            const docChips = getDocChips(dealer);
            const readyToApprove = Boolean(dealer.readiness?.ready_to_approve);

            return (
              <motion.div
                key={dealer.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
              >
                <GlassCard className="space-y-4">
                  {/* Top: avatar + name */}
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-full bg-white/[0.07] flex items-center justify-center flex-shrink-0">
                      <span className="text-lg font-semibold text-white/60">{initial}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm truncate">{companyName}</p>
                      <p className="text-white/50 text-xs truncate">{dealer.email || '—'}</p>
                      {dealer.city || dealer.emirate ? (
                        <p className="text-white/30 text-xs mt-0.5">
                          {[dealer.city, dealer.emirate].filter(Boolean).join(', ')}
                        </p>
                      ) : null}
                    </div>
                    <div className="ml-auto flex-shrink-0">
                      {isVerified ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em] border bg-emerald-500/10 text-emerald-300 border-emerald-500/20">
                          Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em] border bg-amber-500/10 text-amber-300 border-amber-500/20">
                          Pending
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Doc chips */}
                  <div className="grid grid-cols-2 gap-2">
                    {docChips.map((c) => (
                      <DocChip key={c.docType} label={c.label} status={c.status} />
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/dealers/${dealer.id}`)}
                      disabled={loadingForRow}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm transition-colors disabled:opacity-40"
                    >
                      Review
                    </button>
                    {!isVerified && readyToApprove && (
                      <>
                        <button
                          type="button"
                          title="Approve dealer"
                          onClick={() => updateDealerStatus(dealer.id, true)}
                          disabled={loadingForRow}
                          className="p-2 rounded-full hover:bg-emerald-500/20 text-white/40 hover:text-emerald-300 transition-colors border border-white/10"
                        >
                          {loadingForRow ? (
                            <span className="w-4 h-4 block border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                          ) : (
                            <CheckCircle2 size={16} />
                          )}
                        </button>
                        <button
                          type="button"
                          title="Reject dealer"
                          onClick={() => { setRejectDealerId(dealer.id); setShowRejectModal(true); }}
                          disabled={loadingForRow}
                          className="p-2 rounded-full hover:bg-rose-500/20 text-white/40 hover:text-rose-300 transition-colors border border-white/10"
                        >
                          <XCircle size={16} />
                        </button>
                      </>
                    )}
                    {!isVerified && !readyToApprove && (
                      <button
                        type="button"
                        title="View details"
                        onClick={() => navigate(`/admin/dealers/${dealer.id}`)}
                        className="p-2 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors border border-white/10"
                      >
                        <Eye size={16} />
                      </button>
                    )}
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Reject Modal */}
      <AnimatePresence>
        {showRejectModal && (
          <motion.div
            key="reject-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">Reject Dealer</h2>
                <button
                  onClick={() => { setShowRejectModal(false); setRejectDealerId(null); setRejectReasonIndex(''); setRejectNote(''); }}
                  className="text-white/40 hover:text-white/80 transition-colors"
                >
                  <XCircle size={18} />
                </button>
              </div>
              <div className="space-y-3">
                <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">
                  Reason for rejection *
                </label>
                <select
                  value={rejectReasonIndex}
                  onChange={(e) => setRejectReasonIndex(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  <option value="">Select a reason…</option>
                  {DEALER_REJECTION_REASONS.map((item, idx) => (
                    <option key={idx} value={idx}>{item.reason}</option>
                  ))}
                </select>
                {rejectReasonIndex !== '' && (
                  <div className="p-3 rounded-xl bg-rose-500/[0.08] border border-rose-500/20">
                    <p className="text-[11px] font-semibold text-rose-300 uppercase tracking-[0.08em] mb-1">How to fix</p>
                    <p className="text-xs text-white/70 leading-relaxed">
                      {DEALER_REJECTION_REASONS[Number(rejectReasonIndex)].fix}
                    </p>
                  </div>
                )}
                <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">
                  Additional notes (optional)
                </label>
                <textarea
                  rows={3}
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Add any extra context…"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowRejectModal(false); setRejectDealerId(null); setRejectReasonIndex(''); setRejectNote(''); }}
                  className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectSubmit}
                  disabled={actionLoadingId || rejectReasonIndex === ''}
                  className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-4 py-2 text-sm disabled:opacity-40"
                >
                  {actionLoadingId ? 'Rejecting…' : 'Confirm Rejection'}
                </button>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminDealers;
