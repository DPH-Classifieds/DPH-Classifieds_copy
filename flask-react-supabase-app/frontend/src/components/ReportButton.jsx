import { API_BASE_URL as API_URL } from '../utils/apiBase';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Flag,
  Ban,
  ShieldAlert,
  AlertOctagon,
  FolderX,
  Copy,
  CheckCircle2,
  Info,
  MoreHorizontal,
  Loader2,
  X,
} from 'lucide-react';
import axios from 'axios';
import { getAccessToken } from '../utils/authService';
import { shellLine, shellSurfaceStrong } from '../lib/themeClasses';


const REASONS = [
  { value: 'spam',           label: 'Spam',             icon: Ban          },
  { value: 'fraud',          label: 'Fraud',            icon: ShieldAlert  },
  { value: 'inappropriate',  label: 'Inappropriate',    icon: AlertOctagon },
  { value: 'wrong_category', label: 'Wrong category',   icon: FolderX      },
  { value: 'duplicate',      label: 'Duplicate',        icon: Copy         },
  { value: 'sold',           label: 'Already sold',     icon: CheckCircle2 },
  { value: 'incorrect_info', label: 'Incorrect info',   icon: Info         },
  { value: 'other',          label: 'Other',            icon: MoreHorizontal },
];

const ReportButton = ({ listingId, listingType }) => {
  const [showModal, setShowModal]           = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [details, setDetails]               = useState('');
  const [submitting, setSubmitting]         = useState(false);
  const [success, setSuccess]               = useState(false);
  const [error, setError]                   = useState(null);

  const openModal = () => {
    setSelectedReason('');
    setDetails('');
    setError(null);
    setSuccess(false);
    setShowModal(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setShowModal(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!selectedReason) {
      setError('Please select a reason for reporting.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getAccessToken();

      if (!token) {
        setError('You must be logged in to report a listing');
        setSubmitting(false);
        return;
      }

      await axios.post(
        `${API_URL}/api/reports`,
        { listing_id: listingId, listing_type: listingType, reason: selectedReason, details },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      setSuccess(true);
      setTimeout(() => {
        setShowModal(false);
        setSuccess(false);
      }, 1800);
    } catch (err) {
      console.error('Error submitting report:', err);
      setError(err.response?.data?.error || 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1.5 text-[12px] text-white/40 hover:text-rose-300 transition cursor-pointer"
        title="Report this listing"
      >
        <Flag size={14} />
        Report listing
      </button>

      {/* Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            key="report-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeModal}
          >
            <motion.div
              key="report-card"
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.2 }}
              className={`${shellSurfaceStrong} border ${shellLine} rounded-2xl shadow-2xl max-w-md w-full p-6`}
              onClick={(e) => e.stopPropagation()}
            >
              {success ? (
                /* ── Success state ── */
                <div className="flex flex-col items-center justify-center py-8 gap-4">
                  <CheckCircle2 size={48} className="text-emerald-400" />
                  <div className="text-center">
                    <p className="text-lg font-semibold text-white">Thanks for the report</p>
                    <p className="text-sm text-white/50 mt-1">Our team will review it shortly.</p>
                  </div>
                </div>
              ) : (
                /* ── Form state ── */
                <form onSubmit={handleSubmit} noValidate>
                  {/* Header */}
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="text-xl font-semibold text-white">Report this listing</h3>
                    <button
                      type="button"
                      onClick={closeModal}
                      className="text-white/40 hover:text-white/70 transition -mt-0.5 -mr-1 p-1"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <p className="text-sm text-white/50 mb-5">
                    Help us keep the marketplace clean. Your report stays anonymous.
                  </p>

                  {/* Reason grid */}
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {REASONS.map(({ value, label, icon: Icon }) => {
                      const selected = selectedReason === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setSelectedReason(value)}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left text-sm font-medium transition-all ${
                            selected
                              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                              : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/[0.08]'
                          }`}
                        >
                          <Icon size={15} className="flex-shrink-0" />
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Details textarea */}
                  <textarea
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Add any extra context (optional)…"
                    maxLength={500}
                    className="bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 w-full min-h-[80px] resize-none mb-4"
                  />

                  {/* Error banner */}
                  {error && (
                    <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-rose-500/10 text-rose-300 border border-rose-500/20">
                      {error}
                    </div>
                  )}

                  {/* Buttons */}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={submitting}
                      className="px-4 py-2 rounded-full text-sm font-medium text-white/60 hover:text-white/90 border border-white/10 hover:border-white/20 transition disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting || !selectedReason}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-emerald-500 hover:bg-emerald-400 text-emerald-950 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {submitting ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          Submitting…
                        </>
                      ) : (
                        'Submit report'
                      )}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default ReportButton;
