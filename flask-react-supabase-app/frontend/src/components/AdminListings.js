import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Car,
  Eye,
  BarChart3,
  Inbox,
  CheckCircle2,
  XCircle,
  Trash2,
  Send,
  RefreshCw,
  Sliders,
  Calendar,
} from 'lucide-react';
import apiClient from '../utils/apiClient';
import { useAuth } from '../context/AuthContext';
import { GlassCard, EmptyState } from './ui/dashboard';
import { LISTING_REJECTION_REASONS } from './admin/rejectionConstants';

const ADMIN_DELETE_REASONS = [
  'Duplicate listing',
  'Fraud or suspicious activity',
  'Prohibited or inappropriate content',
  'Policy violation',
  'Incorrect information',
  'Spam',
  'Price manipulation',
];

const STATUS_SORT_ORDER = { pending: 0, pending_auto_review: 0, draft: 1, active: 2, approved: 2, expired: 3, suspended: 4, rejected: 5, sold: 6, deleted: 7, archived: 8, removed: 9 };
const statusRank = (l) => STATUS_SORT_ORDER[l._table_status || l.status] ?? 10;

const ALL_TYPES = ['all', 'cars', 'bikes', 'parts', 'plates', 'drafts', 'buying_requests'];
const ALL_STATUSES = ['all', 'pending', 'draft', 'approved', 'rejected', 'expired', 'deleted'];
const ALL_SOURCES = ['all', 'member', 'dealer', 'reddit'];
const SOURCE_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'member', label: 'Member' },
  { key: 'dealer', label: 'Dealer' },
  { key: 'reddit', label: 'Reddit' },
];
const STATUS_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'draft', label: 'Draft' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'expired', label: 'Expired' },
  { key: 'deleted', label: 'Deleted' },
];

const TYPE_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'cars', label: 'Cars' },
  { key: 'bikes', label: 'Bikes' },
  { key: 'plates', label: 'Plates' },
  { key: 'parts', label: 'Parts' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'buying_requests', label: 'Requests' },
];

const ADMIN_PAGE_SIZE = 25;

const parseParamList = (val, allowed) => {
  if (!val) return [];
  return val.split(',').map((s) => s.trim()).filter((s) => allowed.includes(s));
};

const relTime = (ts) => {
  if (!ts) return '';
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 2) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.round(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.round(diffHrs / 24);
  return `${diffDays}d ago`;
};

const TypeBadge = ({ type }) => {
  const t = String(type || '').toLowerCase();
  const map = {
    car: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    cars: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
    bike: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
    bikes: 'bg-orange-500/10 text-orange-300 border-orange-500/20',
    plate: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    plates: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    part: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    parts: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    buying_request: 'bg-white/5 text-white/60 border-white/10',
    buying_requests: 'bg-white/5 text-white/60 border-white/10',
    draft: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    drafts: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
  };
  const labelMap = {
    car: 'Car', cars: 'Car', bike: 'Bike', bikes: 'Bike',
    plate: 'Plate', plates: 'Plate', part: 'Part', parts: 'Part',
    draft: 'Draft', drafts: 'Draft',
    buying_request: 'Request', buying_requests: 'Request',
  };
  const cls = map[t] || 'bg-white/5 text-white/50 border-white/10';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.10em] border ${cls}`}>
      {labelMap[t] || type}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const s = String(status || '').toLowerCase();
  const map = {
    active: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    approved: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    pending: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    pending_auto_review: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    suspended: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    rejected: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    removed: 'bg-white/5 text-white/40 border-white/10',
    sold: 'bg-white/5 text-white/40 border-white/10',
    deleted: 'bg-white/5 text-white/40 border-white/10',
    expired: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  };
  const label = s === 'pending_auto_review' ? 'Auto Review' : status;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize border ${map[s] || 'bg-white/5 text-white/40 border-white/10'}`}>
      {label}
    </span>
  );
};

const SkeletonRow = () => (
  <tr className="border-b border-white/[0.04] animate-pulse">
    {[...Array(9)].map((_, i) => (
      <td key={i} className="px-4 py-3">
        <div className="h-3 bg-white/5 rounded-full w-full" />
      </td>
    ))}
  </tr>
);

const AdminListings = () => {
  const { isLoading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTypes = parseParamList(searchParams.get('types'), ALL_TYPES);
  const effectiveTypes = selectedTypes.includes('all')
    ? ['all']
    : selectedTypes.length > 0 ? selectedTypes : ['all'];
  const selectedStatuses = parseParamList(searchParams.get('statuses'), ALL_STATUSES);
  const effectiveStatuses = selectedStatuses.includes('all') ? ['all'] : (selectedStatuses.length > 0 ? selectedStatuses : ['all']);
  const selectedSources = parseParamList(searchParams.get('source'), ALL_SOURCES);
  const effectiveSources = selectedSources.includes('all') ? ['all'] : (selectedSources.length > 0 ? selectedSources : ['all']);
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(0);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedListing, setSelectedListing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [selectedRejectIndex, setSelectedRejectIndex] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteReasonDetails, setDeleteReasonDetails] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastType, setToastType] = useState('success');
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewReason, setRenewReason] = useState('');
  const [showBulkRenewModal, setShowBulkRenewModal] = useState(false);
  const [bulkRenewReason, setBulkRenewReason] = useState('');
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleteReason, setBulkDeleteReason] = useState('');
  const [bulkRestoring, setBulkRestoring] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [pendingStatusValue, setPendingStatusValue] = useState('');
  const [showExpiryModal, setShowExpiryModal] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [arRunning, setArRunning] = useState(false);
  const [arFeedback, setArFeedback] = useState('');
  const navigate = useNavigate();

  const showToast = (message, type = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
      setTimeout(() => setToastMessage(''), 300);
    }, 4000);
  };

  const fetchListings = useCallback(async () => {
    try {
      if (authLoading) {
        return;
      }

      setLoading(true);

      const typesToFetch = effectiveTypes.includes('all')
        ? ['cars', 'bikes', 'parts', 'plates', 'buying_requests']
        : effectiveTypes;
      const statusesToFetch = effectiveStatuses.includes('all') ? [] : effectiveStatuses;

      // listings-search natively supports status=deleted and status=expired
      // (see backend/app.py:_admin_listing_matches_status). We used to strip
      // 'deleted' here and then synthesize fake rows from /deleted-listings,
      // but those stubs had no owner email / title / nudge timestamp — which
      // broke the "Send renewal nudge" button and the detail page. Just ask
      // the search endpoint directly so each row is a real listing record.
      const sourcesToFetch = effectiveSources.includes('all') ? [] : effectiveSources;
      const sourceQuery = sourcesToFetch.length > 0 ? `&source=${sourcesToFetch.join(',')}` : '';
      const mainQuery = statusesToFetch.length > 0
        ? `/api/admin/listings-search?statuses=${statusesToFetch.join(',')}&types=${typesToFetch.join(',')}${sourceQuery}`
        : `/api/admin/listings-search?types=${typesToFetch.join(',')}${sourceQuery}`;

      const mainResponse = await apiClient.get(mainQuery).catch(() => {
        const fallbackPromises = [];
        const fallbackStatuses = statusesToFetch.length > 0
          ? statusesToFetch.filter((s) => s !== 'deleted')
          : ['pending', 'approved', 'rejected', 'expired'];
        for (const type of typesToFetch) {
          for (const status of fallbackStatuses) {
            fallbackPromises.push(
              apiClient.get(`/api/admin/approve/${type}?status=${status}`).catch(() => [])
            );
          }
        }
        return Promise.all(fallbackPromises).then((results) => results.flat());
      });

      const allListings = Array.isArray(mainResponse)
        ? mainResponse
        : (Array.isArray(mainResponse?.listings) ? mainResponse.listings : []);

      setPage(0);
      setListings(allListings);
    } catch (error) {
      console.error('Failed to fetch listings:', error);
      setListings([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, effectiveTypes.join(','), effectiveStatuses.join(','), effectiveSources.join(',')]);

  useEffect(() => {
    if (!authLoading) {
      fetchListings();
    }
  }, [authLoading, fetchListings]);

  useEffect(() => {
    const onFocus = () => {
      if (!authLoading) {
        fetchListings();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [authLoading, fetchListings]);

  const toggleParam = (key, value, allowed) => {
    const current = parseParamList(searchParams.get(key), allowed);
    let next;
    if (value === 'all') {
      next = ['all'];
    } else if (current.includes('all')) {
      next = [value];
    } else if (current.includes(value)) {
      next = current.filter((v) => v !== value);
    } else {
      next = [...current, value];
    }
    const params = new URLSearchParams(searchParams);
    if (next.length > 0) {
      params.set(key, next.join(','));
    } else {
      params.delete(key);
    }
    setSearchParams(params);
  };

  const handleApprove = async (listingId, listingType) => {
    try {
      setActionLoading(true);
      await apiClient.post(`/api/admin/approve/${listingType}/${listingId}/approve`);
      setListings(listings.filter((l) => l.id !== listingId));
      showToast('Listing approved successfully', 'success');
    } catch (error) {
      console.error('Failed to approve listing:', error);
      showToast('Failed to approve listing. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    try {
      setActionLoading(true);
      const listingType = selectedListing?.listing_type || 'cars';
      const selected = selectedRejectIndex !== '' ? LISTING_REJECTION_REASONS[Number(selectedRejectIndex)] : null;
      await apiClient.post(`/api/admin/approve/${listingType}/${selectedListing.id}/reject`, {
        rejection_note: selected
          ? `${selected.reason}${rejectionNote.trim() && rejectionNote.trim() !== selected.reason ? ` - ${rejectionNote.trim()}` : ''}`
          : rejectionNote,
        rejection_reason: selected?.reason || '',
        rejection_fix: selected?.fix || '',
      });
      setListings(listings.filter((l) => l.id !== selectedListing.id));
      showToast('Listing rejected successfully', 'success');
      setShowRejectModal(false);
      setShowRejectConfirm(false);
      setRejectionNote('');
      setSelectedRejectIndex('');
      setSelectedListing(null);
    } catch (error) {
      console.error('Failed to reject listing:', error);
      showToast('Failed to reject listing. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const getDeleteType = (listingType) => {
    const map = { cars: 'car', bikes: 'bike', parts: 'part', plates: 'plate', buying_requests: 'buying_request' };
    return map[listingType] || 'car';
  };

  const handleSendNudge = async (listing) => {
    if (!listing) return;
    const lt = listing.listing_type || 'cars';
    try {
      setActionLoading(true);
      const resp = await apiClient.post(
        `/api/admin/listings/${lt}/${listing.id}/send-renewal-nudge`
      );
      const ch = resp?.channels || {};
      const sent = ['email', 'sms', 'whatsapp'].filter((k) => ch[k]);
      if (sent.length === 0) {
        showToast('Nudge attempted, but no channel delivered. Check owner contact info.', 'error');
      } else {
        showToast(`Renewal nudge sent via ${sent.join(' + ')}.`, 'success');
      }
      setListings((prev) =>
        prev.map((l) =>
          l.id === listing.id
            ? { ...l, renewal_nudge_sent_at: resp?.renewal_nudge_sent_at || new Date().toISOString() }
            : l
        )
      );
    } catch (error) {
      const status = error?.response?.status || error?.status;
      const detail = error?.response?.data || error?.data;
      if (status === 429) {
        showToast('A nudge was already sent in the last 6 hours. Please wait before resending.', 'error');
      } else {
        console.error('Failed to send renewal nudge:', error);
        showToast(detail?.error || 'Failed to send renewal nudge. Please try again.', 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const isRenewable = (listing) => {
    // Admin can renew any listing that isn't already terminal — sold,
    // user-deleted, rejected, or auto-archived past retention. The previous
    // "within 7 days of expiry" gate was a UX guess that hid the button on
    // freshly posted listings, which surprised admins who expected to be
    // able to extend any active listing on demand.
    if (!listing) return false;
    const rawStatus = String(listing.status || '').toLowerCase();
    const terminal = ['sold', 'deleted', 'rejected', 'archived'];
    if (terminal.includes(rawStatus)) return false;
    if (listing.deleted_at || listing.is_archived) return false;
    return true;
  };

  const rowKey = (listing) => `${listing.listing_type || 'cars'}:${listing.id}`;

  const toggleRowSelected = (listing) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = rowKey(listing);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleRenewSingle = async () => {
    if (!selectedListing) return;
    const lt = selectedListing.listing_type || 'cars';
    try {
      setActionLoading(true);
      await apiClient.post(
        `/api/admin/listings/${lt}/${selectedListing.id}/renew`,
        { reason: renewReason.trim() || undefined }
      );
      showToast('Listing renewed successfully', 'success');
      setShowRenewModal(false);
      setRenewReason('');
      setSelectedListing(null);
      fetchListings();
    } catch (error) {
      console.error('Failed to renew listing:', error);
      const detail = error?.response?.data || error?.data;
      showToast(detail?.error || 'Failed to renew listing. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkRenew = async () => {
    const items = [];
    for (const key of selectedIds) {
      const [type, id] = key.split(':');
      if (type && id) items.push({ type, id });
    }
    if (items.length === 0) return;
    try {
      setActionLoading(true);
      const resp = await apiClient.post(
        '/api/admin/listings/renew-bulk',
        { items, reason: bulkRenewReason.trim() || undefined }
      );
      const total = Number(resp?.total ?? items.length);
      const succeeded = Number(resp?.succeeded ?? 0);
      const failed = Number(resp?.failed ?? Math.max(0, total - succeeded));
      const msg = `Renewed ${succeeded} of ${total}. ${failed} failed.`;
      showToast(msg, failed === 0 ? 'success' : 'error');
      setShowBulkRenewModal(false);
      setBulkRenewReason('');
      clearSelection();
      fetchListings();
    } catch (error) {
      console.error('Failed to bulk-renew listings:', error);
      const detail = error?.response?.data || error?.data;
      showToast(detail?.error || 'Bulk renew failed. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!bulkDeleteReason.trim()) {
      showToast('Please select a removal reason.', 'error');
      return;
    }
    const items = [];
    for (const key of selectedIds) {
      const [type, id] = key.split(':');
      if (type && id) items.push({ type, id });
    }
    if (!items.length) return;
    try {
      setActionLoading(true);
      const resp = await apiClient.post('/api/admin/listings/delete-bulk', {
        items,
        reason: bulkDeleteReason,
      });
      const total = Number(resp?.total ?? items.length);
      const succeeded = Number(resp?.succeeded ?? 0);
      const failed = Number(resp?.failed ?? Math.max(0, total - succeeded));
      showToast(`Deleted ${succeeded} of ${total}.${failed ? ` ${failed} failed.` : ''}`, failed === 0 ? 'success' : 'error');
      setShowBulkDeleteModal(false);
      setBulkDeleteReason('');
      clearSelection();
      fetchListings();
    } catch (error) {
      const detail = error?.response?.data || error?.data;
      showToast(detail?.error || 'Bulk delete failed. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkRestore = async () => {
    const items = [];
    for (const key of selectedIds) {
      const [type, id] = key.split(':');
      if (type && id) items.push({ type, id });
    }
    if (!items.length) return;
    try {
      setBulkRestoring(true);
      let succeeded = 0;
      for (const { type, id } of items) {
        try {
          await apiClient.post(`/api/admin/listings/${type}/${id}/set-status`, { status: 'approved' });
          succeeded++;
        } catch (_) {}
      }
      const failed = items.length - succeeded;
      showToast(`Restored ${succeeded} of ${items.length}.${failed ? ` ${failed} failed.` : ''}`, failed === 0 ? 'success' : 'error');
      clearSelection();
      fetchListings();
    } catch (error) {
      showToast('Bulk restore failed. Please try again.', 'error');
    } finally {
      setBulkRestoring(false);
    }
  };

  const handleBulkApprove = async () => {
    const items = [];
    for (const key of selectedIds) {
      const [type, id] = key.split(':');
      if (type && id) items.push({ type, id });
    }
    if (!items.length) return;
    try {
      setActionLoading(true);
      const resp = await apiClient.post('/api/admin/listings/approve-bulk', { items });
      const total = Number(resp?.total ?? items.length);
      const succeeded = Number(resp?.succeeded ?? 0);
      const failed = Number(resp?.failed ?? Math.max(0, total - succeeded));
      showToast(`Approved ${succeeded} of ${total}.${failed ? ` ${failed} failed.` : ''}`, failed === 0 ? 'success' : 'error');
      clearSelection();
      fetchListings();
    } catch (error) {
      const detail = error?.response?.data || error?.data;
      showToast(detail?.error || 'Bulk approve failed. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteListing = async () => {
    if (!selectedListing) return;
    if (!deleteReason.trim()) {
      showToast('Please select a removal reason.', 'error');
      return;
    }
    try {
      setActionLoading(true);
      const listingType = selectedListing?.listing_type || 'cars';
      const finalReason = deleteReasonDetails.trim()
        ? `${deleteReason}: ${deleteReasonDetails.trim()}`
        : deleteReason;
      await apiClient.request(`/api/${getDeleteType(listingType)}/${selectedListing.id}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: { reason: finalReason },
      });
      setListings(listings.filter((l) => l.id !== selectedListing.id));
      showToast('Listing removed successfully. Owner has been notified.', 'success');
      setShowDeleteModal(false);
      setShowDeleteConfirm(false);
      setDeleteReason('');
      setDeleteReasonDetails('');
      setSelectedListing(null);
    } catch (error) {
      console.error('Failed to delete listing:', error);
      showToast('Failed to delete listing. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunAutoReview = async () => {
    setArRunning(true);
    setArFeedback('');
    try {
      const res = await apiClient.post('/api/admin/auto-review/run');
      const count = res.processed ?? 0;
      setArFeedback(`${count} listing(s) processed`);
      if (count > 0) fetchListings();
    } catch (e) {
      setArFeedback(`Failed: ${e.message || 'error'}`);
    } finally {
      setArRunning(false);
    }
  };

  const STATUS_CHANGE_OPTIONS = {
    approved: [
      { value: 'rejected',       label: 'Rejected — notify seller' },
      { value: 'sold_on_dph',    label: 'Sold on DPH — remove from platform' },
      { value: 'sold_elsewhere', label: 'Sold elsewhere — remove from platform' },
      { value: 'deleted',        label: 'Deleted — remove permanently' },
    ],
    active: [
      { value: 'rejected',       label: 'Rejected — notify seller' },
      { value: 'sold_on_dph',    label: 'Sold on DPH — remove from platform' },
      { value: 'sold_elsewhere', label: 'Sold elsewhere — remove from platform' },
      { value: 'deleted',        label: 'Deleted — remove permanently' },
    ],
    rejected: [{ value: 'approved', label: 'Approved — restore live' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    expired:  [{ value: 'approved', label: 'Approved — restore live' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    deleted:  [{ value: 'approved', label: 'Approved — restore live' }],
    sold:     [{ value: 'approved', label: 'Approved — restore live' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    pending: [
      { value: 'rejected',       label: 'Rejected — notify seller' },
      { value: 'sold_on_dph',    label: 'Sold on DPH — remove from platform' },
      { value: 'sold_elsewhere', label: 'Sold elsewhere — remove from platform' },
      { value: 'deleted',        label: 'Deleted — remove permanently' },
    ],
  };

  const SOLD_LABELS = { sold_on_dph: 'Sold on DPH', sold_elsewhere: 'Sold elsewhere' };

  const getStatusOptions = (displayStatus) => {
    const ds = String(displayStatus || '').toLowerCase();
    return STATUS_CHANGE_OPTIONS[ds] || [{ value: 'approved', label: 'Approved — restore live' }, { value: 'rejected', label: 'Rejected — notify seller' }, { value: 'deleted', label: 'Deleted — remove permanently' }];
  };

  const handleSetStatus = async () => {
    if (!selectedListing || !pendingStatusValue) return;
    const lt = selectedListing.listing_type || 'cars';
    try {
      setActionLoading(true);
      await apiClient.post(
        `/api/admin/listings/${lt}/${selectedListing.id}/set-status`,
        { status: pendingStatusValue }
      );
      const label = SOLD_LABELS[pendingStatusValue]
        || (pendingStatusValue.charAt(0).toUpperCase() + pendingStatusValue.slice(1));
      showToast(`Listing marked as ${label} successfully`, 'success');
      setShowStatusModal(false);
      setPendingStatusValue('');
      setSelectedListing(null);
      fetchListings();
    } catch (error) {
      console.error('Failed to update listing status:', error);
      const detail = error?.response?.data || error?.data;
      showToast(detail?.error || 'Failed to update status. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetExpiry = async () => {
    if (!selectedListing || !expiryDate) return;
    const lt = selectedListing.listing_type || 'cars';
    try {
      setActionLoading(true);
      await apiClient.post(
        `/api/admin/listings/${lt}/${selectedListing.id}/set-expiry`,
        { expires_at: new Date(expiryDate + 'T23:59:59').toISOString() }
      );
      showToast('Expiry date updated successfully', 'success');
      setShowExpiryModal(false);
      setExpiryDate('');
      setSelectedListing(null);
      fetchListings();
    } catch (error) {
      console.error('Failed to update expiry:', error);
      const detail = error?.response?.data || error?.data;
      showToast(detail?.error || 'Failed to update expiry. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const getListingTitle = (listing) => {
    if (listing.display_title) return listing.display_title;
    if (listing.listing_title) return listing.listing_title;
    if (listing.title) return listing.title;
    if (listing.item_name) return listing.item_name;
    if (listing.draft_payload) {
      const payload = listing.draft_payload || {};
      return payload.listing_title || payload.title || payload.name || payload.item_name || `Draft #${listing.id ? listing.id.slice(0, 8) : 'Unknown'}`;
    }
    return `#${listing.id ? listing.id.slice(0, 8) : 'Unknown'}`;
  };

  const getListingImage = (listing) => {
    if (!listing.images || listing.images.length === 0) return null;
    const img = listing.images[0];
    if (typeof img === 'string') return img;
    return img.display_url || img.image_url || img.url || null;
  };

  const approveSelectedListing = async () => {
    if (!selectedListing) return;
    const lt = selectedListing.listing_type || 'cars';
    await handleApprove(selectedListing.id, lt);
    setShowApproveConfirm(false);
    setSelectedListing(null);
  };

  const listingSummary = useMemo(() => {
    const visible = listings.length;
    const pendingCount = listings.filter((l) => l.status === 'pending' || l._table_status === 'pending').length;
    const views = listings.reduce((sum, l) => sum + Number(l.view_count ?? l.views ?? 0), 0);
    return { visible, pendingCount, views };
  }, [listings]);

  const filtered = useMemo(() => {
    const base = searchText.trim()
      ? listings.filter((l) => {
          const title = getListingTitle(l).toLowerCase();
          const id = (l.id || '').toLowerCase();
          const q = searchText.toLowerCase();
          return title.includes(q) || id.includes(q);
        })
      : listings;
    return base.slice().sort((a, b) => statusRank(a) - statusRank(b)).slice(0, 100);
  }, [listings, searchText]);

  const totalPages = Math.ceil(filtered.length / ADMIN_PAGE_SIZE);
  const pagedListings = filtered.slice(page * ADMIN_PAGE_SIZE, (page + 1) * ADMIN_PAGE_SIZE);

  const selectedListings = listings.filter((l) => selectedIds.has(rowKey(l)));
  const bulkHasRenewable = selectedListings.some((l) => isRenewable(l));
  // Restorable = actually deleted/rejected — NOT expired (those use Renew, not Restore)
  const bulkHasRestorable = selectedListings.some((l) => {
    const ds = String(l.display_status || l.listing_state || l.status || '').toLowerCase();
    const rs = String(l.status || '').toLowerCase();
    return ds === 'deleted' || rs === 'deleted' || rs === 'rejected';
  });
  const bulkHasPending = selectedListings.some((l) =>
    String(l._table_status || l.status || '').toLowerCase() === 'pending'
  );

  const pageSelectableIds = pagedListings
    .filter((l) => {
      const lt = l.listing_type || l._type || 'cars';
      return !(lt === 'drafts' || String(l.status || '').toLowerCase() === 'draft');
    })
    .map((l) => rowKey(l));
  const allPageSelected = pageSelectableIds.length > 0 && pageSelectableIds.every((id) => selectedIds.has(id));
  const somePageSelected = !allPageSelected && pageSelectableIds.some((id) => selectedIds.has(id));
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageSelectableIds.forEach((id) => next.delete(id));
      } else {
        pageSelectableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const ChipFilter = ({ options, activeKeys, paramKey, allowed }) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isActive = activeKeys.includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => toggleParam(paramKey, opt.key, allowed)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
              isActive
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-white/[0.04] text-white/50 border-white/10 hover:text-white/70 hover:bg-white/[0.07]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen px-6 py-8 space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toastVisible && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-6 right-6 z-[9999] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
            style={{
              background: toastType === 'success'
                ? 'linear-gradient(135deg,rgba(16,185,129,0.95),rgba(5,120,80,0.98))'
                : 'linear-gradient(135deg,rgba(239,68,68,0.95),rgba(180,30,30,0.98))',
              border: toastType === 'success' ? '1px solid rgba(52,211,153,0.4)' : '1px solid rgba(248,113,113,0.4)',
            }}
          >
            {toastType === 'success' ? (
              <CheckCircle2 size={18} className="text-white flex-shrink-0" />
            ) : (
              <XCircle size={18} className="text-white flex-shrink-0" />
            )}
            <p className="text-sm font-semibold text-white">{toastMessage}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-white">Listings</h1>
          <p className="text-sm text-white/50 mt-1">Moderate cars, bikes, plates, and parts across the platform.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/[0.06] text-white/60 border border-white/10">
            {listingSummary.visible} shown
          </span>
          {listingSummary.pendingCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {listingSummary.pendingCount} pending
            </span>
          )}
          <button
            type="button"
            onClick={handleRunAutoReview}
            disabled={arRunning}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
          >
            {arRunning ? 'Running…' : 'Run Auto-Review'}
          </button>
          {arFeedback && <span className="text-xs text-emerald-400">{arFeedback}</span>}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Shown', value: listingSummary.visible },
          { label: 'Pending', value: listingSummary.pendingCount },
          { label: 'Views', value: listingSummary.views },
        ].map((kpi) => (
          <GlassCard key={kpi.label} className="flex flex-col gap-1">
            <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">{kpi.label}</p>
            <p className="text-2xl font-semibold text-white">{kpi.value.toLocaleString()}</p>
          </GlassCard>
        ))}
      </div>

      {/* Filters */}
      <GlassCard className="space-y-4">
        <input
          type="text"
          placeholder="Search by ID or title…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">Type</p>
          <ChipFilter
            options={TYPE_OPTIONS}
            activeKeys={effectiveTypes}
            paramKey="types"
            allowed={ALL_TYPES}
          />
        </div>
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">Status</p>
          <ChipFilter
            options={STATUS_OPTIONS}
            activeKeys={effectiveStatuses}
            paramKey="statuses"
            allowed={ALL_STATUSES}
          />
        </div>
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">Source</p>
          <ChipFilter
            options={SOURCE_OPTIONS}
            activeKeys={effectiveSources}
            paramKey="source"
            allowed={ALL_SOURCES}
          />
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(el) => { if (el) el.indeterminate = somePageSelected; }}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded accent-emerald-500 cursor-pointer"
                    title="Select all on this page"
                  />
                </th>
                {['Thumbnail', 'Listing', 'Type', 'Status', 'Seller', 'Views', 'Created', 'Actions'].map((h, idx) => (
                  <th key={`${h}-${idx}`} className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
                : filtered.length === 0
                  ? (
                    <tr>
                      <td colSpan={9} className="py-0">
                        <EmptyState icon={Inbox} title="No listings match your filters." />
                      </td>
                    </tr>
                  )
                  : pagedListings.map((listing, i) => {
                    const thumb = getListingImage(listing);
                    const title = getListingTitle(listing);
                    const seller = listing.source_kind === 'reddit'
                      ? 'DPH Classifieds'
                      : (listing.user_email || listing.seller_email || '—');
                    const views = Number(listing.view_count ?? listing.views ?? 0);
                    // Moderation truths (pending/draft/rejected/sold/deleted/suspended/archived)
                    // ALWAYS win over the lifecycle-derived display_status from the backend —
                    // which historically returned 'active' for any not-yet-expired listing
                    // regardless of approval. Only when moderation status is 'approved' do we
                    // fall through to display_status / listing_state for active/expired.
                    const rawStatus = String(listing.status || '').toLowerCase();
                    const overrideStatuses = ['pending', 'draft', 'rejected', 'sold', 'deleted', 'archived', 'suspended'];
                    const displayStatus = overrideStatuses.includes(rawStatus)
                      ? rawStatus
                      : (listing.display_status || listing.listing_state || rawStatus || 'pending');
                    const lt = listing.listing_type || 'cars';
                    const isDraftRow = lt === 'drafts' || String(listing.status || '').toLowerCase() === 'draft';
                    const isPending = (listing._table_status || listing.status) === 'pending';
                    const ds = String(displayStatus || '').toLowerCase();
                    const showNudge = ds === 'expired' || ds === 'deleted';
                    const lastNudgeAt = listing.renewal_nudge_sent_at;
                    const canRenew = isRenewable(listing);
                    const key = rowKey(listing);
                    const isSelected = selectedIds.has(key);

                    return (
                      <motion.tr
                        key={`${lt}-${listing.id}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        onClick={isDraftRow ? undefined : () => navigate(`/admin/listings/${lt}/${listing.id}`)}
                        className={`border-b border-white/[0.04] transition-colors group ${isDraftRow ? '' : 'hover:bg-white/[0.04] cursor-pointer'}`}
                      >
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {!isDraftRow ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRowSelected(listing)}
                              aria-label="Select listing"
                              className="w-4 h-4 rounded border-white/20 bg-white/[0.04] accent-emerald-500 cursor-pointer"
                            />
                          ) : (
                            <span className="inline-block w-4 h-4" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={title}
                              className="w-12 h-12 rounded-lg object-cover"
                              onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-white/[0.04] flex items-center justify-center">
                              <Car size={20} className="text-white/20" />
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          <p className="text-white/80 font-medium truncate text-sm">{title}</p>
                          <p className="text-white/30 text-xs font-mono mt-0.5">{(listing.id || '').slice(0, 8)}</p>
                        </td>
                        <td className="px-4 py-3"><TypeBadge type={lt} /></td>
                        <td className="px-4 py-3"><StatusBadge status={displayStatus} /></td>
                        <td className="px-4 py-3 max-w-[260px]">
                          <p
                            className="text-white/70 text-sm truncate leading-snug"
                            title={seller}
                          >
                            {seller}
                          </p>
                          {listing.source_kind === 'reddit' && (
                            <span className="mt-1 inline-block rounded-full border border-orange-500/30 bg-orange-500/15 px-2 py-0.5 text-[10px] font-medium text-orange-300">Reddit import</span>
                          )}
                          {listing.source_kind === 'dealer' && (
                            <span className="mt-1 inline-block rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">Dealer</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white/60 text-sm">{views.toLocaleString()}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white/40 text-xs whitespace-nowrap">{relTime(listing.created_at)}</p>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                            {!isDraftRow && (
                              <>
                                <button
                                  title="Open public listing in a new tab"
                                  aria-label="Open public listing in a new tab"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const typeMap = { cars: 'cars', bikes: 'bikes', parts: 'car-parts', plates: 'plates' };
                                    const pub = typeMap[lt] || lt;
                                    window.open(`/${pub}/${listing.id}`, '_blank', 'noopener');
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                                >
                                  <Eye size={15} />
                                </button>
                                <button
                                  title="Open admin detail view"
                                  aria-label="Open admin detail view"
                                  onClick={(e) => { e.stopPropagation(); navigate(`/admin/listings/${lt}/${listing.id}`); }}
                                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                                >
                                  <BarChart3 size={15} />
                                </button>
                                <button
                                  title="Change listing status"
                                  aria-label="Change listing status"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingStatusValue('');
                                    setSelectedListing(listing);
                                    setShowStatusModal(true);
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-indigo-500/20 text-white/50 hover:text-indigo-300 transition-colors"
                                  disabled={actionLoading}
                                >
                                  <Sliders size={15} />
                                </button>
                                <button
                                  title="Set expiry date"
                                  aria-label="Set expiry date"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const current = listing.expires_at
                                      ? new Date(listing.expires_at).toISOString().slice(0, 10)
                                      : '';
                                    setExpiryDate(current);
                                    setSelectedListing(listing);
                                    setShowExpiryModal(true);
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-sky-500/20 text-white/50 hover:text-sky-300 transition-colors"
                                  disabled={actionLoading}
                                >
                                  <Calendar size={15} />
                                </button>
                                {showNudge && (
                                <button
                                  title={lastNudgeAt
                                    ? `Send renewal nudge to owner (last sent ${relTime(lastNudgeAt)})`
                                    : 'Send renewal nudge to owner (email + SMS)'}
                                aria-label="Send renewal nudge to owner"
                                onClick={(e) => { e.stopPropagation(); handleSendNudge(listing); }}
                                className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-white/50 hover:text-emerald-300 transition-colors"
                                  disabled={actionLoading}
                                >
                                  <Send size={15} />
                                </button>
                                )}
                                {canRenew && (
                                <button
                                  title="Renew listing on behalf of owner"
                                  aria-label="Renew listing"
                                  onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedListing(listing);
                                  setRenewReason('');
                                  setShowRenewModal(true);
                                }}
                                className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-white/50 hover:text-emerald-300 transition-colors"
                                  disabled={actionLoading}
                                >
                                  <RefreshCw size={15} />
                                </button>
                                )}
                                {isPending && (
                                  <>
                                <button
                                  title="Approve listing"
                                  aria-label="Approve listing"
                                  onClick={(e) => { e.stopPropagation(); setSelectedListing(listing); setShowApproveConfirm(true); }}
                                  className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-white/50 hover:text-emerald-300 transition-colors"
                                  disabled={actionLoading}
                                >
                                  <CheckCircle2 size={15} />
                                </button>
                                <button
                                  title="Reject listing (notify seller)"
                                  aria-label="Reject listing"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedListing(listing);
                                    setRejectionNote('');
                                    setSelectedRejectIndex('');
                                    setShowRejectConfirm(false);
                                    setShowRejectModal(true);
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-white/50 hover:text-rose-300 transition-colors"
                                  disabled={actionLoading}
                                >
                                  <XCircle size={15} />
                                </button>
                                  </>
                                )}
                                <button
                                  title="Delete listing (notify seller)"
                                  aria-label="Delete listing"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedListing(listing);
                                    setDeleteReason('');
                                    setDeleteReasonDetails('');
                                    setShowDeleteConfirm(false);
                                    setShowDeleteModal(true);
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-white/50 hover:text-rose-300 transition-colors"
                                  disabled={actionLoading}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
        {!loading && totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 0', justifyContent: 'center' }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ padding: '6px 16px', borderRadius: '6px', border: '1px solid #ccc', cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}
            >
              ← Prev
            </button>
            <span style={{ fontSize: '14px', color: '#666' }}>
              Showing {page * ADMIN_PAGE_SIZE + 1}–{Math.min((page + 1) * ADMIN_PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{ padding: '6px 16px', borderRadius: '6px', border: '1px solid #ccc', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1 }}
            >
              Next →
            </button>
          </div>
        )}
      </GlassCard>

      {/* Modals */}
      <AnimatePresence>
        {/* Approve Modal */}
        {showApproveConfirm && selectedListing && (
          <motion.div
            key="approve-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-emerald-300">Confirm Approval</h2>
                <button onClick={() => { setShowApproveConfirm(false); setSelectedListing(null); }} className="text-white/40 hover:text-white/80 transition-colors">
                  <XCircle size={18} />
                </button>
              </div>
              <p className="text-sm text-white/70">
                Approve <strong className="text-white">{getListingTitle(selectedListing)}</strong> and publish it live?
              </p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowApproveConfirm(false); setSelectedListing(null); }} className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10">
                  Cancel
                </button>
                <button onClick={approveSelectedListing} disabled={actionLoading} className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm">
                  {actionLoading ? 'Approving…' : 'Yes, Approve'}
                </button>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Reject Modal */}
        {showRejectModal && selectedListing && (
          <motion.div
            key="reject-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              {!showRejectConfirm ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">Reject Listing</h2>
                    <button onClick={() => { setShowRejectModal(false); setSelectedListing(null); }} className="text-white/40 hover:text-white/80 transition-colors">
                      <XCircle size={18} />
                    </button>
                  </div>
                  <p className="text-sm text-white/70">
                    <strong className="text-white">{getListingTitle(selectedListing)}</strong> will be rejected and the seller notified.
                  </p>
                  <div className="space-y-3">
                    <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">Rejection reason</label>
                    <select
                      value={selectedRejectIndex}
                      onChange={(e) => setSelectedRejectIndex(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                      <option value="">Select a reason…</option>
                      {LISTING_REJECTION_REASONS.map((reason, index) => (
                        <option key={index} value={index}>{reason.reason}</option>
                      ))}
                    </select>
                    <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">Additional notes (optional)</label>
                    <textarea
                      value={rejectionNote}
                      onChange={(e) => setRejectionNote(e.target.value)}
                      placeholder="Optional notes for the seller…"
                      rows={3}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowRejectModal(false); setSelectedListing(null); }} className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10">
                      Cancel
                    </button>
                    <button
                      onClick={() => setShowRejectConfirm(true)}
                      disabled={!selectedRejectIndex && !rejectionNote.trim()}
                      className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-4 py-2 text-sm disabled:opacity-40"
                    >
                      Review Rejection
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-rose-300">Confirm Rejection</h2>
                  </div>
                  <p className="text-sm text-white/70">
                    Are you sure you want to reject <strong className="text-white">{getListingTitle(selectedListing)}</strong>?
                    The seller will be notified.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowRejectConfirm(false)} className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10">
                      Go Back
                    </button>
                    <button onClick={handleReject} disabled={actionLoading} className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-4 py-2 text-sm">
                      {actionLoading ? 'Rejecting…' : 'Yes, Reject'}
                    </button>
                  </div>
                </>
              )}
            </GlassCard>
          </motion.div>
        )}

        {/* Renew Modal (single) */}
        {showRenewModal && selectedListing && (
          <motion.div
            key="renew-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-emerald-300">Renew Listing</h2>
                <button onClick={() => { setShowRenewModal(false); setRenewReason(''); setSelectedListing(null); }} className="text-white/40 hover:text-white/80 transition-colors">
                  <XCircle size={18} />
                </button>
              </div>
              <p className="text-sm text-white/70">
                Renew <strong className="text-white">{getListingTitle(selectedListing)}</strong> on behalf of the owner?
              </p>
              <div className="space-y-3">
                <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">Reason (optional)</label>
                <textarea
                  value={renewReason}
                  onChange={(e) => setRenewReason(e.target.value)}
                  placeholder="Internal note for the audit log…"
                  rows={3}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowRenewModal(false); setRenewReason(''); setSelectedListing(null); }} className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10">
                  Cancel
                </button>
                <button onClick={handleRenewSingle} disabled={actionLoading} className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm">
                  {actionLoading ? 'Renewing…' : 'Confirm Renew'}
                </button>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Bulk Renew Modal */}
        {showBulkRenewModal && (
          <motion.div
            key="bulk-renew-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-emerald-300">Renew {selectedIds.size} Selected</h2>
                <button onClick={() => { setShowBulkRenewModal(false); setBulkRenewReason(''); }} className="text-white/40 hover:text-white/80 transition-colors">
                  <XCircle size={18} />
                </button>
              </div>
              <p className="text-sm text-white/70">
                Renew <strong className="text-white">{selectedIds.size}</strong> listing{selectedIds.size === 1 ? '' : 's'} on behalf of their owners?
              </p>
              <div className="space-y-3">
                <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">Reason (optional)</label>
                <textarea
                  value={bulkRenewReason}
                  onChange={(e) => setBulkRenewReason(e.target.value)}
                  placeholder="Internal note for the audit log…"
                  rows={3}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowBulkRenewModal(false); setBulkRenewReason(''); }} className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10">
                  Cancel
                </button>
                <button onClick={handleBulkRenew} disabled={actionLoading || selectedIds.size === 0} className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-2 text-sm disabled:opacity-50">
                  {actionLoading ? 'Renewing…' : `Confirm Renew (${selectedIds.size})`}
                </button>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Delete Modal */}
        {showDeleteModal && selectedListing && (
          <motion.div
            key="delete-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              {!showDeleteConfirm ? (
                <>
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">Remove Listing</h2>
                    <button onClick={() => { setShowDeleteModal(false); setSelectedListing(null); }} className="text-white/40 hover:text-white/80 transition-colors">
                      <XCircle size={18} />
                    </button>
                  </div>
                  <p className="text-sm text-white/70">
                    <strong className="text-white">{getListingTitle(selectedListing)}</strong> will be permanently removed. The owner will be emailed.
                  </p>
                  <div className="space-y-3">
                    <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">Removal reason</label>
                    <select
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    >
                      <option value="">Select a reason…</option>
                      {ADMIN_DELETE_REASONS.map((reason) => (
                        <option key={reason} value={reason}>{reason}</option>
                      ))}
                    </select>
                    <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">Additional details (optional)</label>
                    <textarea
                      value={deleteReasonDetails}
                      onChange={(e) => setDeleteReasonDetails(e.target.value)}
                      placeholder="Internal notes…"
                      rows={3}
                      className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => { setShowDeleteModal(false); setSelectedListing(null); }} className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10">
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!deleteReason.trim()) { showToast('Please select a removal reason.', 'error'); return; }
                        setShowDeleteConfirm(true);
                      }}
                      disabled={!deleteReason.trim()}
                      className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-4 py-2 text-sm disabled:opacity-40"
                    >
                      Review Removal
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-base font-semibold text-rose-300">Confirm Permanent Removal</h2>
                  <p className="text-sm text-white/70">
                    This cannot be undone. <strong className="text-white">{getListingTitle(selectedListing)}</strong> will be permanently deleted and the owner emailed.
                  </p>
                  <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
                    <p className="text-[10px] uppercase tracking-[0.10em] text-white/40 mb-1">Reason</p>
                    <p className="text-sm text-white/80">{deleteReason}{deleteReasonDetails ? `: ${deleteReasonDetails}` : ''}</p>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowDeleteConfirm(false)} className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10">
                      Go Back
                    </button>
                    <button onClick={handleDeleteListing} disabled={actionLoading} className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-4 py-2 text-sm">
                      {actionLoading ? 'Removing…' : 'Yes, Delete Permanently'}
                    </button>
                  </div>
                </>
              )}
            </GlassCard>
          </motion.div>
        )}

        {/* Expiry Modal */}
        {showExpiryModal && selectedListing && (
          <motion.div
            key="expiry-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-sky-300">Set Expiry Date</h2>
                <button
                  onClick={() => { setShowExpiryModal(false); setExpiryDate(''); setSelectedListing(null); }}
                  className="text-white/40 hover:text-white/80 transition-colors"
                >
                  <XCircle size={18} />
                </button>
              </div>
              <p className="text-sm text-white/70">
                <strong className="text-white">{getListingTitle(selectedListing)}</strong>
              </p>
              {selectedListing.expires_at && (
                <p className="text-xs text-white/40">
                  Current expiry: {new Date(selectedListing.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              )}
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">New expiry date</label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40 [color-scheme:dark]"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowExpiryModal(false); setExpiryDate(''); setSelectedListing(null); }}
                  className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSetExpiry}
                  disabled={!expiryDate || actionLoading}
                  className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-full px-4 py-2 text-sm disabled:opacity-40"
                >
                  {actionLoading ? 'Saving…' : 'Set Expiry'}
                </button>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Status Modal */}
        {showStatusModal && selectedListing && (
          <motion.div
            key="status-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-indigo-300">Change Listing Status</h2>
                <button
                  onClick={() => { setShowStatusModal(false); setPendingStatusValue(''); setSelectedListing(null); }}
                  className="text-white/40 hover:text-white/80 transition-colors"
                >
                  <XCircle size={18} />
                </button>
              </div>
              <p className="text-sm text-white/70">
                <strong className="text-white">{getListingTitle(selectedListing)}</strong> — current status:{' '}
                <span className="text-white/60 capitalize">
                  {String(selectedListing.display_status || selectedListing.listing_state || selectedListing.status || '').toLowerCase()}
                </span>
              </p>
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">New status</label>
                <select
                  value={pendingStatusValue}
                  onChange={(e) => setPendingStatusValue(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                >
                  <option value="">Select new status…</option>
                  {getStatusOptions(
                    String(selectedListing.display_status || selectedListing.listing_state || selectedListing.status || '').toLowerCase()
                  ).map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {pendingStatusValue === 'approved' && (
                <p className="text-xs text-emerald-300/80 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                  Listing will be restored live. If already expired, expiry will be extended by 60 days from now.
                </p>
              )}
              {pendingStatusValue === 'deleted' && (
                <p className="text-xs text-rose-300/80 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  This will permanently remove the listing. Use the dedicated Delete button to also notify the seller.
                </p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowStatusModal(false); setPendingStatusValue(''); setSelectedListing(null); }}
                  className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSetStatus}
                  disabled={!pendingStatusValue || actionLoading}
                  className="bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full px-4 py-2 text-sm disabled:opacity-40"
                >
                  {actionLoading ? 'Saving…' : 'Confirm Change'}
                </button>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating bulk-action bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            key="bulk-bar"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-5 py-3 rounded-2xl shadow-2xl bg-[rgba(10,15,20,0.97)] border border-white/20 backdrop-blur-md"
          >
            <span className="text-sm text-white/60 font-medium pr-1">
              {selectedIds.size} selected
            </span>
            {bulkHasPending && (
              <button
                onClick={handleBulkApprove}
                disabled={actionLoading || bulkRestoring}
                className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
              >
                <CheckCircle2 size={14} />
                Approve
              </button>
            )}
            {bulkHasRenewable && (
              <button
                onClick={() => setShowBulkRenewModal(true)}
                disabled={actionLoading || bulkRestoring}
                className="inline-flex items-center gap-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 font-semibold rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
              >
                <RefreshCw size={14} />
                Renew
              </button>
            )}
            {bulkHasRestorable && (
              <button
                onClick={handleBulkRestore}
                disabled={actionLoading || bulkRestoring}
                className="inline-flex items-center gap-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 font-semibold rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
              >
                <CheckCircle2 size={14} />
                {bulkRestoring ? 'Restoring…' : 'Restore Live'}
              </button>
            )}
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              disabled={actionLoading || bulkRestoring}
              className="inline-flex items-center gap-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-semibold rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
            >
              <Trash2 size={14} />
              Delete
            </button>
            <button
              onClick={clearSelection}
              className="bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-full px-3 py-1.5 text-sm border border-white/10"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk delete modal */}
      <AnimatePresence>
        {showBulkDeleteModal && (
          <motion.div
            key="bulk-delete-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <GlassCard className="w-full max-w-md space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-rose-300">Delete {selectedIds.size} Listings</h2>
                <button onClick={() => { setShowBulkDeleteModal(false); setBulkDeleteReason(''); }} className="text-white/40 hover:text-white/80 transition-colors">
                  <XCircle size={18} />
                </button>
              </div>
              <p className="text-sm text-white/70">
                Permanently remove <strong className="text-white">{selectedIds.size}</strong> listing{selectedIds.size === 1 ? '' : 's'}. This cannot be undone.
              </p>
              <div className="space-y-2">
                <label className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium block">Removal reason</label>
                <select
                  value={bulkDeleteReason}
                  onChange={(e) => setBulkDeleteReason(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                >
                  <option value="">Select a reason…</option>
                  {ADMIN_DELETE_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowBulkDeleteModal(false); setBulkDeleteReason(''); }} className="bg-white/5 hover:bg-white/10 text-white/70 hover:text-white rounded-full px-4 py-2 text-sm border border-white/10">
                  Cancel
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={!bulkDeleteReason.trim() || actionLoading}
                  className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-full px-4 py-2 text-sm disabled:opacity-40"
                >
                  {actionLoading ? 'Deleting…' : `Delete ${selectedIds.size}`}
                </button>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminListings;
