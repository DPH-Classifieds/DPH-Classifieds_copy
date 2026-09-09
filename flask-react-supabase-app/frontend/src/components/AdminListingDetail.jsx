import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  Car,
  Bike,
  Eye,
  Phone,
  Flag,
  Clock,
  ExternalLink,
  Trash2,
  RotateCcw,
  X,
  Image as ImageIcon,
  CheckCircle,
  XCircle,
  ShieldCheck,
  Send,
} from 'lucide-react';
import apiClient from '../utils/apiClient';
import { GlassCard, KpiTile, EmptyState } from './ui/dashboard';
import { LISTING_REJECTION_REASONS } from './admin/rejectionConstants';
import {
  formatCurrencyAED,
  formatDateTime,
  formatNumber,
  getDisplayName,
  getEventActorLabel,
  getListingTitle,
  getListingTypeLabel,
  getStatusTone,
} from './admin/adminUtils';

/* ── helpers ─────────────────────────────────────────────────────────────── */

const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

const listingRouteType = (value) => {
  const n = String(value || '').toLowerCase();
  if (n === 'cars' || n === 'car') return 'car';
  if (n === 'bikes' || n === 'bike') return 'bike';
  if (n === 'parts' || n === 'part' || n === 'car-parts') return 'part';
  if (n === 'plates' || n === 'plate') return 'plate';
  if (n === 'buying_requests' || n === 'buying_request') return 'buying_request';
  return 'car';
};

const listingExtrasFromRecord = (listing) => {
  if (Array.isArray(listing?.extras) && listing.extras.length > 0) return listing.extras;
  const map = {
    keyless_entry: 'Keyless Entry', dvd_player: 'DVD Player',
    climate_control: 'Climate Control', navigation_system: 'Navigation System',
    premium_sound_system: 'Premium Sound System', cooled_seats: 'Cooled Seats',
    front_wheel_drive: 'Front Wheel Drive', leather_seats: 'Leather Seats',
    parking_sensors: 'Parking Sensors', rear_view_camera: 'Rear View Camera',
  };
  return Object.entries(map).filter(([k]) => Boolean(listing?.[k])).map(([, l]) => l);
};

const formatFieldValue = (value, format) => {
  if (format === 'currency') return formatCurrencyAED(value);
  if (format === 'date') return formatDateTime(value);
  if (format === 'number') return formatNumber(value);
  if (format === 'chips') {
    if (!Array.isArray(value) || value.length === 0) return 'None';
    return value;
  }
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined || value === '') return 'Not set';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

const buildField = (label, value, format) => ({ label, value, format });

/* ── badge helper ─────────────────────────────────────────────────────────── */
const statusBadgeClass = (status) => {
  const t = getStatusTone(status);
  if (t === 'success') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (t === 'danger') return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
  return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
};

const Badge = ({ children, className = '' }) => (
  <span className={`text-[10px] font-semibold rounded-full border px-2.5 py-1 ${className}`}>
    {children}
  </span>
);

/* ── auto-review explanation helpers ─────────────────────────────────────── */
export const AUTO_REVIEW_REASONS = {
  no_trust_tier: {
    label: 'Account not yet verified',
    detail: 'Seller must have both email and phone number verified to be auto-approved. Verify manually or ask the seller to complete verification.',
  },
  missing_required_fields: {
    label: 'Required listing fields are missing',
    detail: 'The automated check found one or more required fields missing. Complete the missing information or verify it manually before approving.',
  },
  vin_missing: {
    label: 'No VIN provided',
    detail: 'The seller did not enter a VIN. Confirm this is a real vehicle and request the VIN if possible.',
  },
  vin_format_invalid: {
    label: 'VIN format invalid',
    detail: 'The submitted VIN did not match the expected format. Compare it with the registration document and ask the seller to correct it before approving.',
  },
  vin_invalid: {
    label: 'VIN failed checksum',
    detail: 'The VIN number did not pass validation. Check the VIN against the mulkiya or a VIN-check service.',
  },
  vin_checksum_invalid: {
    label: 'VIN checksum failed',
    detail: 'The VIN checksum did not validate. Compare every character with the registration document; do not treat this as an automatic rejection by itself.',
  },
  vin_decoded_mismatch: {
    label: 'VIN decoded mismatch',
    detail: 'The VIN decoder returned vehicle details that conflict with one or more submitted fields. A mismatch is a review signal, not proof of fraud.',
  },
  vin_make_mismatch: {
    label: 'VIN make mismatch',
    detail: 'The VIN decodes to a different manufacturer than what was listed. Verify which is correct.',
  },
  vin_model_mismatch: {
    label: 'VIN model mismatch',
    detail: 'The VIN decodes to a different model than listed. Cross-check with the registration document.',
  },
  vin_year_mismatch: {
    label: 'VIN year mismatch',
    detail: 'The VIN decodes to a different model year. Confirm the correct year from the mulkiya.',
  },
  vin_decoder_unavailable: {
    label: 'VIN decoder unavailable',
    detail: 'The VIN could not be checked automatically. Verify it manually using the mulkiya or a VIN lookup tool.',
  },
  vision_unavailable: {
    label: 'Image safety check unavailable',
    detail: 'The image safety service did not return a result. Inspect the photos manually before approving.',
  },
  face_detected_in_image: {
    label: 'Possible face in a photo',
    detail: 'A photo may contain an identifiable face. Review the image and remove or crop it if it exposes personal information.',
  },
  face_detected: {
    label: 'Face detected in photos',
    detail: 'One or more photos may contain an identifiable face. Review the images before approving.',
  },
  plate_detected: {
    label: 'License plate visible in photos',
    detail: 'A vehicle plate number is visible in the images. This may expose private information — blur or crop before approving.',
  },
  profanity_detected: {
    label: 'Profanity in description',
    detail: 'The listing description contains flagged language. Review and edit the description before approving.',
  },
  contact_info_in_image: {
    label: 'Contact information in a photo',
    detail: 'A photo contains possible contact information. Review the image and remove it if it bypasses the platform contact flow.',
  },
  nsfw_image: {
    label: 'Explicit content in a photo',
    detail: 'A safety check found explicit content. Review the flagged image and keep the listing rejected unless the result is demonstrably incorrect.',
  },
  duplicate_listing: {
    label: 'Possible duplicate listing',
    detail: 'The listing appears to duplicate another inventory item. Compare the records and ownership before approving.',
  },
  duplicate_vin: {
    label: 'VIN appears on another listing',
    detail: 'The VIN may already be associated with another listing. Compare ownership and listing history before approving.',
  },
  price_outlier: {
    label: 'Price is outside the expected range',
    detail: 'The submitted price is an outlier against comparable listings. Verify the vehicle details and price with the seller.',
  },
  user_under_review: {
    label: 'Seller account flagged',
    detail: 'This seller account is under review. Resolve the account issue before approving their listings.',
  },
};

const AUTO_REVIEW_STATUS = {
  awaiting: {
    title: 'Awaiting auto-review',
    badge: 'Queued',
    summary: 'The listing is waiting for the auto-review worker; no automated decision has been recorded yet.',
    nextAction: 'Run auto-review now or wait for the worker. Do not treat the queue state as approval.',
    tone: 'amber',
    canRun: true,
  },
  needs_review: {
    title: 'Needs manual review',
    badge: 'Auto-review queued',
    summary: 'Auto-review ran but could not approve this listing. It remains pending for a human reviewer.',
    nextAction: 'Review each finding below, verify the listing evidence, then use the moderation controls to approve or reject.',
    tone: 'amber',
    canRun: true,
  },
  auto_approved: {
    title: 'Auto-approved',
    badge: 'Automated decision',
    summary: 'The automated checks passed and the listing was approved. This is an automated approval, not a manual reviewer decision.',
    nextAction: 'No manual action is required unless you want to audit the listing or its history.',
    tone: 'emerald',
    canRun: false,
  },
  auto_rejected: {
    title: 'Auto-rejected',
    badge: 'Automated decision',
    summary: 'A safety gate rejected this listing automatically. This is distinct from a rejection made by an admin.',
    nextAction: 'Review the flagged evidence and rejection note before considering any restore; restoring remains a manual moderation decision.',
    tone: 'rose',
    canRun: false,
  },
  manual_review: {
    title: 'Manual review pending',
    badge: 'Manual queue',
    summary: 'This listing is pending for a human reviewer. No auto-review decision is recorded for it.',
    nextAction: 'Complete the manual evidence review, then use the moderation controls to approve or reject.',
    tone: 'sky',
    canRun: false,
  },
  manual_approved: {
    title: 'Approved manually',
    badge: 'Manual decision',
    summary: 'This listing was approved without an auto-review state being recorded.',
    nextAction: 'No auto-review action is pending. Review the history if you need to confirm who approved it.',
    tone: 'sky',
    canRun: false,
  },
  manual_rejected: {
    title: 'Rejected manually',
    badge: 'Manual decision',
    summary: 'This listing was rejected by an admin, not by the auto-review worker.',
    nextAction: 'Keep the rejection unless you have reviewed the seller evidence and intentionally choose to restore it.',
    tone: 'sky',
    canRun: false,
  },
};

const normalizedReviewValue = (value) => String(value ?? '').trim();

const reviewFieldValue = (value) => {
  const normalized = normalizedReviewValue(value);
  return normalized || 'Not available';
};

const reviewFieldValues = (listing) => ({
  make: listing?.car_manufacturer || listing?.make || listing?.bike_brand || listing?.manufacturer,
  model: listing?.car_model || listing?.model || listing?.bike_model,
  year: listing?.make_year || listing?.model_year || listing?.year,
});

const decodedFieldValues = (listing, verificationScan) => {
  const candidates = [
    listing?.auto_review_signals?.raw?.vin?.decoded,
    listing?.auto_review_signals?.vin?.decoded,
    listing?.auto_review_decision?.signals?.raw?.vin?.decoded,
    listing?.vin_validation?.decoded,
    verificationScan?.vin_validation?.decoded,
    verificationScan?.decoded,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === 'object' && Object.keys(candidate).length > 0) || {};
};

const mismatchDetails = (listing) => {
  const reasonDetails = listing?.auto_review_reason_details || listing?.auto_review_details;
  return reasonDetails?.vin_decoded_mismatch || reasonDetails?.vinDecodedMismatch || {};
};

const valuesConflict = (field, submitted, decoded) => {
  if (!normalizedReviewValue(submitted) || !normalizedReviewValue(decoded)) return false;
  if (field === 'year') {
    const submittedYear = Number(submitted);
    const decodedYear = Number(decoded);
    return Number.isFinite(submittedYear) && Number.isFinite(decodedYear)
      && Math.abs(submittedYear - decodedYear) > 1;
  }
  const submittedText = normalizedReviewValue(submitted).toLowerCase().replace(/[^a-z0-9]/g, '');
  const decodedText = normalizedReviewValue(decoded).toLowerCase().replace(/[^a-z0-9]/g, '');
  return Boolean(submittedText && decodedText)
    && !submittedText.includes(decodedText)
    && !decodedText.includes(submittedText);
};

const mismatchFieldsFrom = (listing, verificationScan) => {
  const submitted = reviewFieldValues(listing);
  const decoded = decodedFieldValues(listing, verificationScan);
  const details = mismatchDetails(listing);
  const scanMismatches = verificationScan?.vin_validation?.mismatches;
  const mismatchNames = Array.isArray(scanMismatches)
    ? scanMismatches.map((field) => String(field).toLowerCase())
    : [];

  return ['make', 'model', 'year'].reduce((fields, field) => {
    const fieldDetails = details?.[field] || {};
    const decodedValue = fieldDetails.decoded ?? decoded[field] ?? (field === 'year' ? decoded.model_year : undefined);
    const submittedValue = fieldDetails.submitted ?? submitted[field];
    const hasExplicitMismatch = Object.keys(fieldDetails).length > 0 || mismatchNames.includes(field);
    if (hasExplicitMismatch || valuesConflict(field, submittedValue, decodedValue)) {
      fields.push({
        key: field,
        label: field === 'make' ? 'Make' : field === 'model' ? 'Model' : 'Year',
        submitted: reviewFieldValue(submittedValue),
        decoded: reviewFieldValue(decodedValue),
      });
    }
    return fields;
  }, []);
};

export const getAutoReviewStatusKey = (listing) => {
  const state = normalizedReviewValue(listing?.auto_review_state).toLowerCase();
  const status = normalizedReviewValue(listing?.status || listing?._table_status).toLowerCase();
  if (state === 'auto_approved') return 'auto_approved';
  if (state === 'auto_queued') return 'needs_review';
  if (state === 'auto_rejected') return 'auto_rejected';
  if (status === 'pending_auto_review') return 'awaiting';
  if (status === 'pending') return 'manual_review';
  if (status === 'approved' || status === 'active') return 'manual_approved';
  if (status === 'rejected') return 'manual_rejected';
  return null;
};

export const getAutoReviewViewModel = (listing, verificationScan) => {
  const statusKey = getAutoReviewStatusKey(listing);
  if (!statusKey) return null;

  const status = AUTO_REVIEW_STATUS[statusKey];
  const rawReasons = Array.isArray(listing?.auto_review_reasons) ? listing.auto_review_reasons : [];
  const reasons = rawReasons
    .map((reason) => (typeof reason === 'string' ? reason : reason?.label || reason?.reason))
    .filter(Boolean);

  return {
    statusKey,
    ...status,
    reasons,
    mismatchFields: reasons.includes('vin_decoded_mismatch') ? mismatchFieldsFrom(listing, verificationScan) : [],
  };
};

const toneClasses = {
  amber: 'border-amber-500/25 bg-amber-500/[0.05] text-amber-300',
  emerald: 'border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-300',
  rose: 'border-rose-500/25 bg-rose-500/[0.05] text-rose-300',
  sky: 'border-sky-500/25 bg-sky-500/[0.05] text-sky-300',
};

const AutoReviewPanel = ({ listing, verificationScan, onRun, runLoading, runFeedback }) => {
  const model = getAutoReviewViewModel(listing, verificationScan);
  if (!model) return null;

  const reasonList = model.reasons;
  const decidedAt = listing?.auto_review_decided_at;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.08 }}>
      <div className={`rounded-2xl border p-5 space-y-3 ${toneClasses[model.tone]}`} data-testid="auto-review-panel">
        <div className="flex items-center gap-2.5">
          <div className="w-2 h-2 rounded-full bg-current shrink-0" />
          <div>
            <p className="text-sm font-semibold">{model.title}</p>
            <p className="text-xs text-[color:var(--ex-shell-text-muted)] mt-1">{model.summary}</p>
          </div>
          <Badge className="ml-auto text-current bg-current/10 border-current/20">{model.badge}</Badge>
          {decidedAt && (
            <span className="ml-2 text-[11px] text-[color:var(--ex-shell-text-muted)]">{new Date(decidedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>

        {reasonList.length > 0 && (
          <div className="space-y-2">
            {reasonList.map((reason) => {
              const info = AUTO_REVIEW_REASONS[reason] || { label: reason, detail: 'Review this item manually.' };
              return (
                <div key={reason} className="flex gap-3 bg-[color:var(--ex-shell-surface)] rounded-xl px-3 py-2.5 border border-[color:var(--ex-shell-line)]">
                  <div className="w-1.5 h-1.5 rounded-full bg-current/70 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold">{info.label}</p>
                    <p className="text-[11px] text-[color:var(--ex-shell-text-muted)] mt-0.5">{info.detail}</p>
                    {reason === 'vin_decoded_mismatch' && (
                      <div className="mt-2 rounded-lg border border-[color:var(--ex-shell-line)] overflow-hidden" aria-label="VIN mismatch details">
                        <div className="grid grid-cols-3 gap-2 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-[color:var(--ex-shell-text-muted)] bg-[color:var(--ex-shell-surface-strong)]">
                          <span>Field</span><span>Submitted</span><span>VIN decoded</span>
                        </div>
                        {model.mismatchFields.length > 0 ? model.mismatchFields.map((field) => (
                          <div key={field.key} className="grid grid-cols-3 gap-2 px-2.5 py-1.5 text-[11px] border-t border-[color:var(--ex-shell-line)]">
                            <span className="font-medium">{field.label}</span>
                            <span className="break-words">{field.submitted}</span>
                            <span className="break-words">{field.decoded}</span>
                          </div>
                        )) : (
                          <p className="px-2.5 py-2 text-[11px] text-[color:var(--ex-shell-text-muted)] border-t border-[color:var(--ex-shell-line)]">
                            Field-level decoded values were not included in this response. Compare the submitted make, model, and year with the VIN and registration document.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-xs text-[color:var(--ex-shell-text-muted)]"><span className="font-semibold text-[color:var(--ex-shell-text)]">Next action:</span> {model.nextAction}</p>

        {onRun && model.canRun && (
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onRun}
              disabled={runLoading}
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold rounded-full px-4 py-1.5 text-xs transition-colors"
            >
              {runLoading ? 'Running…' : 'Run Auto-Review Now'}
            </button>
            {runFeedback && <span className="text-xs text-[color:var(--ex-shell-text-muted)]">{runFeedback}</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
};

/* ── section label ────────────────────────────────────────────────────────── */
const SectionLabel = ({ children }) => (
  <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-3">{children}</p>
);

/* ── field row ────────────────────────────────────────────────────────────── */
const FieldRow = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 py-2 border-b border-[color:var(--ex-shell-line)] last:border-0">
    <span className="text-xs text-[color:var(--ex-shell-text-muted)] shrink-0">{label}</span>
    <span className="text-sm text-[color:var(--ex-shell-text-muted)] text-right break-all">{value}</span>
  </div>
);

/* ── loading skeleton ─────────────────────────────────────────────────────── */
const Skeleton = () => (
  <div className="text-[color:var(--ex-shell-text)] space-y-5 animate-pulse">
    <div className="h-4 w-32 bg-[color:var(--ex-shell-surface-strong)] rounded-lg" />
    <div className="h-9 w-64 bg-[color:var(--ex-shell-surface-strong)] rounded-xl" />
    <div className="grid grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-2xl p-5 h-28" />
      ))}
    </div>
    <div className="bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-2xl p-5 h-64" />
  </div>
);

/* ── modal overlay ────────────────────────────────────────────────────────── */
const Modal = ({ show, onClose, title, children }) => (
  <AnimatePresence>
    {show && (
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
          className="bg-[#0f1117] border border-[color:var(--ex-shell-line)] rounded-2xl p-7 max-w-lg w-full shadow-2xl"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-[color:var(--ex-shell-text)]">{title}</h2>
            <button onClick={onClose} className="text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] transition p-1">
              <X size={18} />
            </button>
          </div>
          {children}
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

const TABS = ['Details', 'Engagement', 'History'];

/* ═══════════════════════════════════════════════════════════════════════════ */

const AdminListingDetail = () => {
  const { itemType, itemId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [soldSubType, setSoldSubType] = useState('sold_on_dph');
  const [moderationNote, setModerationNote] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [rejectReasonIndex, setRejectReasonIndex] = useState('');
  const [activeTab, setActiveTab] = useState('Details');
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [arRunning, setArRunning] = useState(false);
  const [arFeedback, setArFeedback] = useState('');
  const [nudgeFeedback, setNudgeFeedback] = useState('');
  const [expiryEditDate, setExpiryEditDate] = useState('');
  const [expiryFeedback, setExpiryFeedback] = useState('');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
        setData(response || null);
      } catch (fetchError) {
        console.error('Failed to load listing overview:', fetchError);
        setError(fetchError.message || 'Failed to load listing overview');
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [itemId, itemType]);

  const listing = data?.listing ?? EMPTY_OBJECT;
  const owner = data?.owner ?? EMPTY_OBJECT;
  const summary = data?.summary || {};
  const images = data?.images ?? EMPTY_ARRAY;
  const leadEvents = data?.lead_events ?? EMPTY_ARRAY;
  const reports = data?.reports ?? EMPTY_ARRAY;
  const deletionEvents = data?.deletion_events ?? EMPTY_ARRAY;
  const latestVerificationScan = data?.latest_verification_scan ?? listing?.latest_verification_scan ?? EMPTY_OBJECT;
  const verificationStatus = data?.verification_status ?? listing?.verification_status ?? EMPTY_OBJECT;

  const primaryRouteType = listingRouteType(itemType);
  const approvalRouteType = primaryRouteType === 'part' ? 'parts'
    : primaryRouteType === 'buying_request' ? 'buying_requests'
    : `${primaryRouteType}s`;
  const listingTypeLabel = getListingTypeLabel(itemType);

  const handleSendRenewalNudge = async (force = false) => {
    try {
      setActionLoading(true);
      setNudgeFeedback('');
      const resp = await apiClient.post(
        `/api/admin/listings/${itemType}/${itemId}/send-renewal-nudge`,
        force ? { force: true } : undefined
      );
      const ch = resp?.channels || {};
      const sent = ['email', 'sms', 'whatsapp'].filter((k) => ch[k]);
      const stamped = resp?.renewal_nudge_sent_at;
      if (sent.length === 0) {
        setNudgeFeedback('Nudge attempted, but no channel delivered. Check owner email/phone on file.');
      } else {
        setNudgeFeedback(`Renewal nudge sent via ${sent.join(' + ')}.`);
      }
      if (stamped && data?.listing) {
        setData({ ...data, listing: { ...data.listing, renewal_nudge_sent_at: stamped } });
      }
    } catch (sendError) {
      const status = sendError?.response?.status || sendError?.status;
      const detail = sendError?.response?.data || sendError?.data;
      if (status === 429) {
        setNudgeFeedback('Nudged within the last 6 hours — open the action again to force-resend.');
      } else {
        setNudgeFeedback(detail?.error || sendError?.message || 'Failed to send renewal nudge.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetExpiry = async () => {
    if (!expiryEditDate) return;
    try {
      setActionLoading(true);
      setExpiryFeedback('');
      await apiClient.post(
        `/api/admin/listings/${itemType}/${itemId}/set-expiry`,
        { expires_at: new Date(expiryEditDate + 'T23:59:59').toISOString() }
      );
      setExpiryFeedback('Expiry date updated.');
      setData((prev) => prev
        ? { ...prev, listing: { ...prev.listing, expires_at: new Date(expiryEditDate + 'T23:59:59').toISOString(), expired_at: null } }
        : prev
      );
    } catch (err) {
      const detail = err?.response?.data || err?.data;
      setExpiryFeedback(detail?.error || 'Failed to update expiry.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleModerationAction = async (action, extraPayload) => {
    try {
      setActionLoading(true);
      const endpoint = action === 'delete'
        ? `/api/${primaryRouteType}/${itemId}/delete`
        : `/api/${approvalRouteType}/${itemId}/${action}`;
      let payload = {};
      if (action === 'reject') {
        const selected = rejectReasonIndex !== '' ? LISTING_REJECTION_REASONS[Number(rejectReasonIndex)] : null;
        payload = {
          rejection_note: selected
            ? `${selected.reason}${moderationNote.trim() ? ` - ${moderationNote.trim()}` : ''}`
            : moderationNote || 'Rejected by admin',
          rejection_reason: selected?.reason || '',
          rejection_fix: selected?.fix || '',
          ...extraPayload,
        };
      } else if (action === 'delete') {
        payload = { reason: removeReason || moderationNote || 'Removed by admin' };
      }
      await apiClient.request(endpoint, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      navigate(`/admin/listings?filter=${approvalRouteType}&status=pending`);
    } catch (saveError) {
      setError(saveError.message || `Failed to ${action} listing`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkAsSold = async () => {
    try {
      setActionLoading(true);
      await apiClient.post(
        `/api/admin/listings/${itemType}/${itemId}/set-status`,
        { status: soldSubType }
      );
      navigate(`/admin/listings?filter=${approvalRouteType}&status=approved`);
    } catch (soldError) {
      setError(soldError.message || 'Failed to mark listing as sold');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunAutoReview = async () => {
    setArRunning(true);
    setArFeedback('');
    try {
      const res = await apiClient.post('/api/admin/auto-review/run', { listing_id: itemId, listing_type: approvalRouteType });
      setArFeedback(`Done — ${res.processed ?? 0} listing(s) processed.`);
      // Reload listing data so the panel reflects the new decision
      const refreshed = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
      setData(refreshed || null);
    } catch (e) {
      setArFeedback(`Failed: ${e.message || 'unknown error'}`);
    } finally {
      setArRunning(false);
    }
  };

  const leadTotals = useMemo(() => leadEvents.reduce(
    (acc, event) => { acc[event.action] = (acc[event.action] || 0) + 1; return acc; },
    { call_click: 0, whatsapp_click: 0, vin_open: 0, vin_reveal: 0 }
  ), [leadEvents]);

  const detailSections = useMemo(() => {
    const titleValue = getListingTitle(listing);
    const priceValue = listing.display_price ?? listing.price ?? listing.expected_selling_price;
    const extras = listingExtrasFromRecord(listing);

    const sourceLabel = listing.source_platform === 'reddit'
      ? 'Reddit import'
      : (listing.is_dealer ? 'Dealer' : (listing.source_platform || 'Member'));
    const identitySection = {
      title: 'Core Listing',
      fields: [
        buildField('Source', sourceLabel),
        buildField('Original post', listing.source_url, 'link'),
        buildField('Posted by', listing.source_author ? `u/${listing.source_author}` : null),
        buildField('Title', titleValue),
        buildField('Status', listing.status || 'pending'),
        buildField('Listing type', listingTypeLabel),
        buildField('Listing ID', listing.id),
        buildField('Type key', listing.type || primaryRouteType),
        buildField('Created at', listing.created_at, 'date'),
        buildField('Updated at', listing.updated_at, 'date'),
        buildField('Price', priceValue, 'currency'),
      ],
    };

    const ownerSection = {
      title: 'Owner & Contact',
      fields: [
        buildField('Owner name', getDisplayName(owner)),
        buildField('Owner email', owner.email || listing.user_email),
        buildField('Owner phone', owner.phone || owner.whatsapp_number || listing.car_owner_phone_number),
        buildField('Seller name', listing.seller_name),
        buildField('Seller email', listing.seller_email),
        buildField('Contact preference', listing.contact_preference),
      ],
    };

    const locationSection = {
      title: 'Location & Media',
      fields: [
        buildField('City', listing.city || listing.car_city || listing.location || listing.emirate),
        buildField('Emirate', listing.emirate),
        buildField('Area', listing.area),
        buildField('Car location', listing.car_location),
        buildField('Latitude', listing.latitude),
        buildField('Longitude', listing.longitude),
        buildField('Image count', images.length, 'number'),
        buildField('Listing URL', listing.tour_url),
      ],
    };

    const lifecycleSection = {
      title: 'Lifecycle & Moderation',
      fields: [
        buildField('Approved', listing.is_approved),
        buildField('Expires at', listing.expires_at, 'date'),
        buildField('Expired at', listing.expired_at, 'date'),
        buildField('Retention expires at', listing.retention_expires_at, 'date'),
        buildField('Archived', listing.is_archived),
        buildField('Rejection note', listing.rejection_note),
      ],
    };

    if (primaryRouteType === 'bike') {
      return [identitySection, {
        title: 'Bike Specifications',
        fields: [
          buildField('Make year', listing.make_year, 'number'),
          buildField('Make', listing.make || listing.bike_brand),
          buildField('Model', listing.model || listing.bike_model),
          buildField('Bike type', listing.bike_type || listing.type || listing.bike_category),
          buildField('Engine size', listing.engine_size || listing.engine_capacity),
          buildField('Mileage', listing.mileage || listing.kilometer_driven, 'number'),
          buildField('Fuel type', listing.fuel_type),
          buildField('Transmission', listing.transmission_type),
          buildField('Ownership', listing.ownership_status),
          buildField('Extras', listingExtrasFromRecord(listing), 'chips'),
          buildField('Description', listing.description || listing.car_description),
        ],
      }, ownerSection, locationSection, lifecycleSection];
    }

    if (primaryRouteType === 'plate') {
      return [identitySection, {
        title: 'Plate Details',
        fields: [
          buildField('City', listing.city), buildField('Code', listing.code),
          buildField('Number', listing.number), buildField('Digits', listing.digits, 'number'),
          buildField('Format', listing.plate_format), buildField('Plate type', listing.plate_type),
          buildField('Reserved', listing.is_reserved), buildField('Description', listing.description),
        ],
      }, ownerSection, locationSection, lifecycleSection];
    }

    if (primaryRouteType === 'part') {
      return [identitySection, {
        title: 'Part Details',
        fields: [
          buildField('Part name', listing.name || listing.part_name),
          buildField('Brand', listing.brand),
          buildField('Category', listing.category || listing.part_type),
          buildField('Compatibility', listing.compatible_makes || listing.compatible_models),
          buildField('Condition', listing.condition),
          buildField('Price', listing.price, 'currency'),
          buildField('Description', listing.description),
        ],
      }, ownerSection, locationSection, lifecycleSection];
    }

    if (primaryRouteType === 'buying_request') {
      return [identitySection, {
        title: 'Buying Request Details',
        fields: [
          buildField('Item type', listing.item_type),
          buildField('Item name', listing.item_name),
          buildField('Mileage preference', listing.mileage_preference),
          buildField('Regional spec', listing.regional_spec),
          buildField('Description / features', listing.reference_notes),
          buildField('Budget', listing.budget, 'currency'),
          buildField('Make', listing.car_manufacturer),
          buildField('Model', listing.car_model),
          buildField('Trim', listing.trim),
        ],
      }, ownerSection, locationSection, lifecycleSection];
    }

    return [identitySection, {
      title: 'Car Identity',
      fields: [
        buildField('Make year', listing.make_year, 'number'),
        buildField('Manufacturer', listing.car_manufacturer || listing.make),
        buildField('Model', listing.car_model || listing.model),
        buildField('Trim', listing.trim || listing.car_variant),
        buildField('Body type', listing.body_type),
        buildField('Regional spec', listing.regional_spec),
        buildField('Vehicle type', listing.vehicle_type),
        buildField('Ownership status', listing.ownership_status),
        buildField('Dealer listing', listing.is_dealer),
        buildField('Featured listing', listing.featured_listing),
      ],
    }, {
      title: 'Specs & Condition',
      fields: [
        buildField('Mileage', listing.kilometer_driven || listing.kilometer || listing.mileage, 'number'),
        buildField('Fuel type', listing.fuel_type),
        buildField('Transmission', listing.transmission_type),
        buildField('Steering side', listing.steering_side),
        buildField('Seating capacity', listing.seating_capacity),
        buildField('Horsepower', listing.horsepower),
        buildField('Engine capacity', listing.engine_capacity),
        buildField('Cylinders', listing.cylinders),
        buildField('Doors', listing.doors),
        buildField('Color', listing.color),
        buildField('Interior color', listing.interior_color),
        buildField('Drivetrain', listing.drivetrain),
        buildField('Fuel efficiency', listing.fuel_efficiency),
        buildField('Top speed', listing.top_speed),
        buildField('0-100', listing.zero_to_hundred),
        buildField('Torque', listing.torque),
        buildField('Insured', listing.is_insured),
        buildField('Warranty', listing.warranty),
        buildField('Service history', listing.service_history),
        buildField('Lady driven', listing.lady_driven),
      ],
    }, ownerSection, locationSection, {
      title: 'Description & Extras',
      fields: [
        buildField('Listing title', listing.listing_title),
        buildField('Car description', listing.car_description),
        buildField('VIN', listing.vin_number || listing.vin),
        buildField('WhatsApp number', listing.whatsapp_number),
        buildField('Country code', listing.country_code),
        buildField('WhatsApp country code', listing.whatsapp_country_code),
        buildField('WhatsApp pre-text', listing.whatsapp_prefill_text),
        buildField('Extras', extras, 'chips'),
      ],
    }, {
      title: 'Lifecycle & Moderation',
      fields: [
        buildField('Approved', listing.is_approved),
        buildField('Expires at', listing.expires_at, 'date'),
        buildField('Expired at', listing.expired_at, 'date'),
        buildField('Retention expires at', listing.retention_expires_at, 'date'),
        buildField('Last extended at', listing.last_extended_at, 'date'),
        buildField('Extension count', listing.extension_count, 'number'),
        buildField('Archived', listing.is_archived),
        buildField('Rejection note', listing.rejection_note),
      ],
    }];
  }, [images.length, listing, listingTypeLabel, owner, primaryRouteType]);

  /* ── computed display values ──────────────────────────────────────────── */
  const titleText = getListingTitle(listing);
  const priceText = formatCurrencyAED(listing.display_price ?? listing.price ?? listing.expected_selling_price);
  const previewImages = images.slice(0, 3);
  const daysListed = listing.created_at
    ? Math.floor((Date.now() - new Date(listing.created_at)) / 86400000)
    : 0;
  const isSold = listing.status === 'sold';
  const isActive = listing.status === 'approved' || listing.status === 'active';

  /* ── loading / error ──────────────────────────────────────────────────── */
  if (loading) return <Skeleton />;

  if (error && !data) {
    return (
      <div className="text-[color:var(--ex-shell-text)] flex flex-col items-center justify-center py-24 gap-4">
        <XCircle size={48} className="text-rose-400/50" />
        <p className="text-lg font-semibold text-[color:var(--ex-shell-text-muted)]">Listing not available</p>
        <p className="text-sm text-[color:var(--ex-shell-text-muted)]">{error}</p>
        <button
          onClick={() => navigate('/admin/listings')}
          className="inline-flex items-center gap-2 text-sm text-[color:var(--ex-shell-text-muted)] hover:text-emerald-400 transition-colors mt-2"
        >
          <ArrowLeft size={14} /> Back to listings
        </button>
      </div>
    );
  }

  /* ── render ───────────────────────────────────────────────────────────── */
  return (
    <div className="text-[color:var(--ex-shell-text)] space-y-5">

      {/* Breadcrumb */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <Link
          to="/admin/listings"
          className="inline-flex items-center gap-1.5 text-sm text-[color:var(--ex-shell-text-muted)] hover:text-emerald-400 transition-colors"
        >
          <ArrowLeft size={14} /> Back to listings
        </Link>
      </motion.div>

      {/* Title row */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-semibold text-[color:var(--ex-shell-text)]">{titleText}</h1>
            <Badge className={statusBadgeClass(listing.status)}>{listing.status || 'pending'}</Badge>
            <Badge className="text-sky-300 bg-sky-500/10 border-sky-500/20">{listingTypeLabel}</Badge>
          </div>
          <p className="text-sm text-[color:var(--ex-shell-text-muted)] mt-1">
            {listing.city || listing.car_city || listing.emirate || 'UAE'} · Owner: {getDisplayName(owner)}
          </p>
        </div>
        <p className="text-2xl font-semibold text-emerald-300 tabular-nums">{priceText}</p>
      </motion.div>

      {/* KPI tiles */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <KpiTile label="Views" value={summary.view_count ?? 0} icon={Eye} />
        <KpiTile label="Qualified Leads" value={summary.qualified_leads ?? 0} icon={Phone} />
        <KpiTile label="Days Listed" value={daysListed} icon={Clock} />
        <KpiTile label="Reports" value={summary.report_count ?? 0} icon={Flag} />
      </motion.div>

      {/* Auto-review failure panel */}
      <AutoReviewPanel
        listing={listing}
        verificationScan={latestVerificationScan}
        onRun={handleRunAutoReview}
        runLoading={arRunning}
        runFeedback={arFeedback}
      />

      {/* Hero card: gallery + meta */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <GlassCard>
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Gallery */}
            <div className="flex-1 min-w-0">
              <SectionLabel>Gallery</SectionLabel>
              {previewImages.length === 0 ? (
                <div className="flex items-center justify-center h-48 rounded-xl bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)]">
                  {primaryRouteType === 'bike'
                    ? <Bike size={48} className="text-[color:var(--ex-shell-text-muted)]" />
                    : <Car size={48} className="text-[color:var(--ex-shell-text-muted)]" />}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {previewImages.map((img) => (
                    <button
                      key={img.id || img.image_url}
                      type="button"
                      onClick={() => setLightboxUrl(img.display_url || img.image_url || img.url)}
                      className="relative overflow-hidden rounded-xl border border-[color:var(--ex-shell-line)] hover:border-emerald-500/30 transition-all"
                    >
                      <img
                        src={img.display_url || img.image_url || img.url}
                        alt={titleText}
                        className="w-full object-cover"
                        style={{ height: '200px' }}
                        onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                      />
                      {img.is_primary && (
                        <span className="absolute top-1.5 left-1.5 text-[9px] font-bold bg-emerald-500/90 text-emerald-950 rounded px-1.5 py-0.5">
                          PRIMARY
                        </span>
                      )}
                    </button>
                  ))}
                  {images.length > 3 && (
                    <div className="flex items-center justify-center rounded-xl bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)]" style={{ height: '200px' }}>
                      <div className="text-center">
                        <ImageIcon size={24} className="text-[color:var(--ex-shell-text-muted)] mx-auto mb-1" />
                        <p className="text-xs text-[color:var(--ex-shell-text-muted)]">+{images.length - 3} more</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Meta sidebar */}
            <div className="lg:w-72 space-y-4">
              <div>
                <SectionLabel>Quick info</SectionLabel>
                <div className="space-y-1">
                  <FieldRow label="Owner" value={getDisplayName(owner)} />
                  <FieldRow label="Email" value={owner.email || listing.user_email || 'N/A'} />
                  <FieldRow label="Phone" value={owner.phone || owner.whatsapp_number || 'N/A'} />
                  <FieldRow label="VIN" value={listing.vin_number || listing.vin || 'N/A'} />
                  <FieldRow
                    label="Mileage"
                    value={
                      listing.kilometer_driven || listing.kilometer || listing.mileage
                        ? `${formatNumber(listing.kilometer_driven || listing.kilometer || listing.mileage)} km`
                        : 'N/A'
                    }
                  />
                  <FieldRow label="Created" value={formatDateTime(listing.created_at)} />
                  <FieldRow label="Updated" value={formatDateTime(listing.updated_at)} />
                </div>
              </div>

              {/* Mulkiya */}
              {listing.registration_document_signed_url && (
                <div>
                  <SectionLabel>Mulkiya (Reg. doc)</SectionLabel>
                  <a href={listing.registration_document_signed_url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={listing.registration_document_signed_url}
                      alt="Registration document"
                      className="w-full rounded-xl border border-emerald-500/20 hover:border-emerald-500/40 transition cursor-zoom-in"
                      style={{ maxHeight: '180px', objectFit: 'cover' }}
                      onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                    />
                  </a>
                  <p className="text-[10px] text-amber-400 mt-1.5">
                    Auto-deleted after approval.
                  </p>
                </div>
              )}

              {/* Plate ownership proof document */}
              {listing.proof_document_signed_url && (
                <div>
                  <SectionLabel>Ownership Proof (Plate)</SectionLabel>
                  <a href={listing.proof_document_signed_url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={listing.proof_document_signed_url}
                      alt="Plate ownership proof"
                      className="w-full rounded-xl border border-purple-500/20 hover:border-purple-500/40 transition cursor-zoom-in"
                      style={{ maxHeight: '180px', objectFit: 'cover' }}
                      onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                    />
                  </a>
                  <p className="text-[10px] text-amber-400 mt-1.5">
                    Verify plate ownership before approving.
                  </p>
                </div>
              )}

              {/* Bike / Plate registration doc */}
              {listing.registration_doc_signed_url && (
                <div>
                  <SectionLabel>Reg. doc (Bike/Plate)</SectionLabel>
                  <a href={listing.registration_doc_signed_url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={listing.registration_doc_signed_url}
                      alt="Registration document"
                      className="w-full rounded-xl border border-emerald-500/20 hover:border-emerald-500/40 transition cursor-zoom-in"
                      style={{ maxHeight: '180px', objectFit: 'cover' }}
                      onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                    />
                  </a>
                  <p className="text-[10px] text-amber-400 mt-1.5">Admin-only. Verify before approving.</p>
                </div>
              )}
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* Main content: tabbed + right sidebar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-5"
      >
        {/* Left: tabs */}
        <div className="lg:col-span-2 space-y-4">
          {/* Tab switcher */}
          <div className="flex gap-1 bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-xl p-1 w-fit">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab
                    ? 'bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text)]'
                    : 'text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text-muted)]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Details tab */}
          {activeTab === 'Details' && (
            <div className="space-y-4">
              {/* Verification scan */}
              <GlassCard>
                <SectionLabel>Verification Scan</SectionLabel>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <FieldRow label="Needs review" value={verificationStatus.needs_review ? 'Yes' : 'No'} />
                    <FieldRow label="VIN valid" value={verificationStatus.vin_valid ? 'Yes' : 'No'} />
                    <FieldRow label="OCR confidence" value={`${Math.round(Number(verificationStatus.confidence || 0) * 100)}%`} />
                    <FieldRow label="Extracted make" value={verificationStatus.fields?.make || 'Not set'} />
                    <FieldRow label="Extracted model" value={verificationStatus.fields?.model || 'Not set'} />
                    <FieldRow label="Extracted year" value={verificationStatus.fields?.year || 'Not set'} />
                    <FieldRow label="Extracted VIN" value={verificationStatus.fields?.vin || 'Not set'} />
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium mb-2">Raw OCR text</p>
                    <pre className="text-xs text-[color:var(--ex-shell-text-muted)] whitespace-pre-wrap bg-[color:var(--ex-shell-surface)] rounded-lg p-3 border border-[color:var(--ex-shell-line)]">
                      {latestVerificationScan.raw_text || 'No scan captured'}
                    </pre>
                  </div>
                </div>
              </GlassCard>

              {/* Full schema sections */}
              <div className="flex items-center justify-end mb-2">
                <button
                  type="button"
                  onClick={() => setHideEmpty((v) => !v)}
                  className="px-3 py-1 rounded-full text-xs font-medium border border-[color:var(--ex-shell-line)] bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)]/90"
                >
                  {hideEmpty ? 'Show empty fields' : 'Hide empty fields'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {detailSections
                  .map((section) => ({
                    ...section,
                    fields: hideEmpty
                      ? section.fields.filter((f) => {
                          const r = formatFieldValue(f.value, f.format);
                          return !(r === 'Not set' || r === 'None');
                        })
                      : section.fields,
                  }))
                  .filter((section) => section.fields.length > 0)
                  .map((section) => (
                  <GlassCard key={section.title}>
                    <SectionLabel>{section.title}</SectionLabel>
                    {section.fields.map((field) => {
                      const rendered = formatFieldValue(field.value, field.format);
                      if (field.format === 'link' && field.value) {
                        return (
                          <div key={field.label} className="flex items-start justify-between gap-3 py-2 border-b border-[color:var(--ex-shell-line)] last:border-0">
                            <span className="text-xs text-[color:var(--ex-shell-text-muted)] shrink-0">{field.label}</span>
                            <a href={String(field.value)} target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-300 hover:text-emerald-200 text-right break-all">
                              Open ↗
                            </a>
                          </div>
                        );
                      }
                      if (field.format === 'chips' && Array.isArray(rendered)) {
                        return (
                          <div key={field.label} className="py-2 border-b border-[color:var(--ex-shell-line)] last:border-0">
                            <span className="text-xs text-[color:var(--ex-shell-text-muted)] block mb-1">{field.label}</span>
                            {rendered.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {rendered.map((chip) => (
                                  <span key={chip} className="text-[10px] px-2 py-0.5 rounded-full bg-[color:var(--ex-shell-surface-strong)] border border-[color:var(--ex-shell-line)] text-[color:var(--ex-shell-text-muted)]">
                                    {chip}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-[color:var(--ex-shell-text-muted)]">None</span>
                            )}
                          </div>
                        );
                      }
                      return <FieldRow key={field.label} label={field.label} value={rendered} />;
                    })}
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* Engagement tab */}
          {activeTab === 'Engagement' && (
            <GlassCard>
              <SectionLabel>Lead Events (last 20)</SectionLabel>
              {leadEvents.length === 0 ? (
                <EmptyState
                  icon={Phone}
                  title="No lead events"
                  description="No call or WhatsApp events recorded for this listing yet."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[color:var(--ex-shell-line)]">
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Actor</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Action</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Source</th>
                        <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leadEvents.slice(0, 20).map((event) => (
                        <tr key={event.id} className="border-b border-[color:var(--ex-shell-line)] last:border-0">
                          <td className="py-2.5 text-[color:var(--ex-shell-text-muted)]">{getEventActorLabel(event)}</td>
                          <td className="py-2.5">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                              {event.action}
                            </span>
                          </td>
                          <td className="py-2.5 text-[color:var(--ex-shell-text-muted)]">{event.listing_type}</td>
                          <td className="py-2.5 text-[color:var(--ex-shell-text-muted)] text-xs">{formatDateTime(event.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </GlassCard>
          )}

          {/* History tab */}
          {activeTab === 'History' && (
            <div className="space-y-4">
              <GlassCard>
                <SectionLabel>Reports</SectionLabel>
                {reports.length === 0 ? (
                  <EmptyState
                    icon={Flag}
                    title="No reports"
                    description="No reports have been filed against this listing."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[color:var(--ex-shell-line)]">
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Listing</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Reason</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.slice(0, 15).map((report) => (
                          <tr key={report.id} className="border-b border-[color:var(--ex-shell-line)] last:border-0">
                            <td className="py-2.5 text-[color:var(--ex-shell-text-muted)]">{report.listing_type} · {report.listing_id}</td>
                            <td className="py-2.5 text-[color:var(--ex-shell-text-muted)]">{report.reason || 'N/A'}</td>
                            <td className="py-2.5">
                              <Badge className={statusBadgeClass(report.status)}>{report.status || 'pending'}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassCard>

              <GlassCard>
                <SectionLabel>Deletion History</SectionLabel>
                {deletionEvents.length === 0 ? (
                  <EmptyState
                    icon={Trash2}
                    title="No deletion history"
                    description="No deletion or removal events found for this listing."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[color:var(--ex-shell-line)]">
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Reason</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">Deleted by</th>
                          <th className="text-left text-[11px] uppercase tracking-[0.14em] text-[color:var(--ex-shell-text-muted)] font-medium pb-2">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deletionEvents.map((event) => (
                          <tr key={event.id} className="border-b border-[color:var(--ex-shell-line)] last:border-0">
                            <td className="py-2.5 text-[color:var(--ex-shell-text-muted)]">{event.reason}</td>
                            <td className="py-2.5 text-[color:var(--ex-shell-text-muted)]">{event.deleted_by_role}</td>
                            <td className="py-2.5 text-[color:var(--ex-shell-text-muted)] text-xs">{formatDateTime(event.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </GlassCard>
            </div>
          )}
        </div>

        {/* Right: admin actions */}
        <div className="space-y-4">
          <GlassCard>
            <SectionLabel>Admin Actions</SectionLabel>
            <div className="space-y-2.5">
              {/* View public page */}
              <a
                href={listing.tour_url || `/${approvalRouteType}/${itemId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center gap-2.5 bg-[color:var(--ex-shell-surface)] hover:bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] rounded-xl px-4 py-3 text-sm border border-[color:var(--ex-shell-line)] transition"
              >
                <ExternalLink size={15} className="text-[color:var(--ex-shell-text-muted)] flex-shrink-0" />
                <span>View public page</span>
              </a>

              {/* Open owner */}
              <button
                type="button"
                onClick={() => navigate(`/admin/users/${listing.user_id}`)}
                className="w-full inline-flex items-center gap-2.5 bg-[color:var(--ex-shell-surface)] hover:bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] rounded-xl px-4 py-3 text-sm border border-[color:var(--ex-shell-line)] transition text-left"
              >
                <Eye size={15} className="text-[color:var(--ex-shell-text-muted)] flex-shrink-0" />
                <span>Open owner profile</span>
              </button>

              <div className="border-t border-[color:var(--ex-shell-line)] my-1" />

              {/* Approve / Reject */}
              {listing.status !== 'approved' && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleModerationAction('approve')}
                  className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-xl px-4 py-3 text-sm transition disabled:opacity-50"
                >
                  <CheckCircle size={15} />
                  {actionLoading ? 'Working…' : 'Approve listing'}
                </button>
              )}

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setShowRejectModal(true)}
                className="w-full inline-flex items-center justify-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl px-4 py-3 text-sm transition font-semibold disabled:opacity-50"
              >
                <XCircle size={15} />
                Reject listing
              </button>

              {/* VIN Unlock */}
              <button
                type="button"
                disabled={actionLoading}
                onClick={async () => {
                  try {
                    setActionLoading(true);
                    await apiClient.post(`/api/admin/listings/${itemType}/${itemId}/vin-unlock`, {});
                    const response = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
                    setData(response || null);
                  } catch (unlockError) {
                    setError(unlockError.message || 'Failed to unlock VIN');
                  } finally {
                    setActionLoading(false);
                  }
                }}
                className="w-full inline-flex items-center justify-center gap-2 bg-[color:var(--ex-shell-surface)] hover:bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] border border-[color:var(--ex-shell-line)] rounded-xl px-4 py-3 text-sm transition font-medium disabled:opacity-50"
              >
                <ShieldCheck size={15} />
                VIN Unlock
              </button>

              <div className="border-t border-[color:var(--ex-shell-line)] my-1" />

              {/* Mark as Sold */}
              {isActive && (
                <>
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--ex-shell-text-muted)] font-medium">Mark as sold</p>
                    <select
                      value={soldSubType}
                      onChange={(e) => setSoldSubType(e.target.value)}
                      className="w-full bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-xl px-3 py-2 text-sm text-[color:var(--ex-shell-text)] focus:outline-none focus:border-sky-500/40 transition [color-scheme:dark]"
                    >
                      <option value="sold_on_dph">Sold on DPH</option>
                      <option value="sold_elsewhere">Sold elsewhere</option>
                    </select>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={handleMarkAsSold}
                      className="w-full inline-flex items-center justify-center gap-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-xl px-4 py-2.5 text-sm transition font-semibold disabled:opacity-50"
                    >
                      {actionLoading ? 'Marking…' : 'Confirm sold'}
                    </button>
                  </div>
                  <div className="border-t border-[color:var(--ex-shell-line)] my-1" />
                </>
              )}

              {/* Status flip */}
              {isActive ? (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full inline-flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl px-4 py-3 text-sm transition font-semibold disabled:opacity-50"
                >
                  <RotateCcw size={15} />
                  Mark removed
                </button>
              ) : !isSold && (
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleModerationAction('approve')}
                  className="w-full inline-flex items-center justify-center gap-2 bg-[color:var(--ex-shell-surface)] hover:bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] border border-[color:var(--ex-shell-line)] rounded-xl px-4 py-3 text-sm transition font-medium disabled:opacity-50"
                >
                  <RotateCcw size={15} />
                  Restore listing
                </button>
              )}

              {/* Expiry date editor */}
              <div className="space-y-2 pt-1">
                <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--ex-shell-text-muted)] font-medium">Set expiry date</p>
                {listing.expires_at && (
                  <p className="text-xs text-[color:var(--ex-shell-text-muted)]">
                    Current: {new Date(listing.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                )}
                <input
                  type="date"
                  value={expiryEditDate}
                  onChange={(e) => { setExpiryEditDate(e.target.value); setExpiryFeedback(''); }}
                  min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  className="w-full bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-xl px-3 py-2 text-sm text-[color:var(--ex-shell-text)] focus:outline-none focus:border-sky-500/40 transition [color-scheme:dark]"
                />
                <button
                  type="button"
                  disabled={!expiryEditDate || actionLoading}
                  onClick={handleSetExpiry}
                  className="w-full inline-flex items-center justify-center gap-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-xl px-4 py-2.5 text-sm transition font-medium disabled:opacity-50"
                >
                  {actionLoading ? 'Saving…' : 'Update Expiry'}
                </button>
                {expiryFeedback && (
                  <p className="text-xs text-center text-sky-300/80">{expiryFeedback}</p>
                )}
              </div>

              {/* Renewal nudge (expired or deleted listings) */}
              {(['expired', 'deleted'].includes(String(listing.status || '').toLowerCase())
                || listing.expired_at
                || listing.auto_removed_at) && (
                <div className="space-y-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleSendRenewalNudge(false)}
                    className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-xl px-4 py-3 text-sm transition font-semibold disabled:opacity-50"
                  >
                    <Send size={15} />
                    {actionLoading ? 'Sending…' : 'Send renewal nudge to owner'}
                  </button>
                  {listing.renewal_nudge_sent_at && (
                    <p className="text-[11px] text-[color:var(--ex-shell-text-muted)] text-center">
                      Last sent {new Date(listing.renewal_nudge_sent_at).toLocaleString()}
                      {' · '}
                      <button
                        type="button"
                        onClick={() => handleSendRenewalNudge(true)}
                        disabled={actionLoading}
                        className="underline hover:text-[color:var(--ex-shell-text-muted)]"
                      >
                        Resend now
                      </button>
                    </p>
                  )}
                  {nudgeFeedback && (
                    <p className="text-[12px] text-emerald-300/80 text-center">{nudgeFeedback}</p>
                  )}
                </div>
              )}

              {/* Delete permanently */}
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full inline-flex items-center justify-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl px-4 py-3 text-sm transition font-semibold disabled:opacity-50"
              >
                <Trash2 size={15} />
                Delete permanently
              </button>
            </div>

            {/* Moderation note */}
            <div className="mt-4 pt-4 border-t border-[color:var(--ex-shell-line)]">
              <SectionLabel>Moderation note</SectionLabel>
              <textarea
                className="w-full bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-xl px-3 py-2 text-sm text-[color:var(--ex-shell-text-muted)] placeholder:text-[color:var(--ex-shell-text-muted)] resize-none focus:outline-none focus:border-emerald-500/40 transition"
                rows={3}
                value={moderationNote}
                onChange={(e) => setModerationNote(e.target.value)}
                placeholder="Internal note or rejection reason…"
              />
              <input
                className="w-full mt-2 bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-xl px-3 py-2 text-sm text-[color:var(--ex-shell-text-muted)] placeholder:text-[color:var(--ex-shell-text-muted)] focus:outline-none focus:border-emerald-500/40 transition"
                value={removeReason}
                onChange={(e) => setRemoveReason(e.target.value)}
                placeholder="Removal reason (for delete)"
              />
            </div>

            {error && (
              <p className="mt-3 text-xs text-rose-300">{error}</p>
            )}
          </GlassCard>

          {/* Lead summary card */}
          <GlassCard>
            <SectionLabel>Lead Summary</SectionLabel>
            <FieldRow label="Call clicks" value={formatNumber(summary.call_clicks || leadTotals.call_click)} />
            <FieldRow label="WhatsApp clicks" value={formatNumber(summary.whatsapp_clicks || leadTotals.whatsapp_click)} />
            <FieldRow label="VIN opens" value={formatNumber(leadTotals.vin_open)} />
            <FieldRow label="VIN reveals" value={formatNumber(leadTotals.vin_reveal)} />
            <FieldRow label="Total events" value={formatNumber(leadEvents.length)} />
          </GlassCard>
        </div>
      </motion.div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[2000] p-4"
            onClick={() => setLightboxUrl(null)}
          >
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={lightboxUrl}
              alt="Full size"
              className="max-w-full max-h-full rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-6 right-6 text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] bg-[color:var(--ex-shell-surface-strong)] rounded-full p-2 transition"
            >
              <X size={20} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject modal */}
      <Modal
        show={showRejectModal}
        onClose={() => { setShowRejectModal(false); setRejectReasonIndex(''); setModerationNote(''); }}
        title="Reject Listing"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-[color:var(--ex-shell-text-muted)] mb-1.5">Reason for rejection *</label>
            <select
              value={rejectReasonIndex}
              onChange={(e) => setRejectReasonIndex(e.target.value)}
              className="w-full bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-xl px-3 py-2.5 text-sm text-[color:var(--ex-shell-text)] focus:outline-none focus:border-amber-500/40"
            >
              <option value="">Select a reason…</option>
              {LISTING_REJECTION_REASONS.map((item, idx) => (
                <option key={idx} value={idx}>{item.reason}</option>
              ))}
            </select>
          </div>
          {rejectReasonIndex !== '' && (
            <div className="p-3 rounded-xl bg-rose-500/[0.08] border border-rose-500/20">
              <p className="text-[11px] text-rose-300 font-semibold uppercase tracking-wide mb-1">How to fix:</p>
              <p className="text-sm text-[color:var(--ex-shell-text-muted)]">{LISTING_REJECTION_REASONS[Number(rejectReasonIndex)].fix}</p>
            </div>
          )}
          <div>
            <label className="block text-xs text-[color:var(--ex-shell-text-muted)] mb-1.5">Additional notes (optional)</label>
            <textarea
              rows={3}
              value={moderationNote}
              onChange={(e) => setModerationNote(e.target.value)}
              placeholder="Add any extra context…"
              className="w-full bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-xl px-3 py-2.5 text-sm text-[color:var(--ex-shell-text)] placeholder:text-[color:var(--ex-shell-text-muted)] resize-none focus:outline-none focus:border-amber-500/40"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowRejectModal(false); setRejectReasonIndex(''); setModerationNote(''); }}
              className="px-4 py-2 rounded-xl text-sm text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] border border-[color:var(--ex-shell-line)] bg-[color:var(--ex-shell-surface)] hover:bg-[color:var(--ex-shell-surface-strong)] transition"
            >
              Cancel
            </button>
            <button
              onClick={() => handleModerationAction('reject')}
              disabled={actionLoading || rejectReasonIndex === ''}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-500 hover:bg-rose-400 text-[color:var(--ex-shell-text)] transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionLoading ? 'Rejecting…' : 'Confirm Rejection'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        show={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Confirm Permanent Removal"
      >
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <div className="w-14 h-14 rounded-full bg-rose-500/10 border-2 border-rose-500/30 flex items-center justify-center">
              <Trash2 size={24} className="text-rose-400" />
            </div>
            <p className="text-sm text-[color:var(--ex-shell-text-muted)]">This action cannot be undone.</p>
            <p className="text-sm text-[color:var(--ex-shell-text-muted)]">
              <span className="text-[color:var(--ex-shell-text)] font-medium">{titleText}</span>
              <br />will be permanently deleted and the owner will be emailed.
            </p>
          </div>
          <div className="bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--ex-shell-text-muted)] mb-1">Reason</p>
            <p className="text-sm text-[color:var(--ex-shell-text-muted)]">{removeReason || moderationNote || 'Removed by admin'}</p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-4 py-2 rounded-xl text-sm text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text)] border border-[color:var(--ex-shell-line)] bg-[color:var(--ex-shell-surface)] hover:bg-[color:var(--ex-shell-surface-strong)] transition"
            >
              Go Back
            </button>
            <button
              onClick={async () => {
                try {
                  await handleModerationAction('delete');
                  setShowDeleteConfirm(false);
                } catch (_) {
                  // handleModerationAction surfaces the error
                }
              }}
              disabled={actionLoading}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-rose-500 hover:bg-rose-400 text-[color:var(--ex-shell-text)] transition disabled:opacity-40"
            >
              {actionLoading ? 'Removing…' : 'Yes, Delete Permanently'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdminListingDetail;
