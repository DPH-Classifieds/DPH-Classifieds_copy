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
} from 'lucide-react';
import apiClient from '../utils/apiClient';
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

const ALL_TYPES = ['all', 'cars', 'bikes', 'parts', 'plates', 'buying_requests'];
const ALL_STATUSES = ['all', 'pending', 'approved', 'rejected', 'expired'];
const STATUS_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
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
  { key: 'buying_requests', label: 'Requests' },
];

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
  };
  const labelMap = {
    car: 'Car', cars: 'Car', bike: 'Bike', bikes: 'Bike',
    plate: 'Plate', plates: 'Plate', part: 'Part', parts: 'Part',
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
    suspended: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    rejected: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    removed: 'bg-white/5 text-white/40 border-white/10',
    sold: 'bg-white/5 text-white/40 border-white/10',
    deleted: 'bg-white/5 text-white/40 border-white/10',
    expired: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize border ${map[s] || 'bg-white/5 text-white/40 border-white/10'}`}>
      {status}
    </span>
  );
};

const SkeletonRow = () => (
  <tr className="border-b border-white/[0.04] animate-pulse">
    {[...Array(8)].map((_, i) => (
      <td key={i} className="px-4 py-3">
        <div className="h-3 bg-white/5 rounded-full w-full" />
      </td>
    ))}
  </tr>
);

const AdminListings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTypes = parseParamList(searchParams.get('types'), ALL_TYPES);
  const effectiveTypes = selectedTypes.includes('all')
    ? ['all']
    : selectedTypes.length > 0 ? selectedTypes : ['all'];
  const selectedStatuses = parseParamList(searchParams.get('statuses'), ALL_STATUSES);
  const effectiveStatuses = selectedStatuses.includes('all') ? ['all'] : (selectedStatuses.length > 0 ? selectedStatuses : ['all']);
  const hasDeleted = searchParams.get('statuses')?.includes('deleted');
  const [searchText, setSearchText] = useState('');
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
      setLoading(true);

      const typesToFetch = effectiveTypes.includes('all')
        ? ['cars', 'bikes', 'parts', 'plates', 'buying_requests']
        : effectiveTypes;
      const statusesToFetch = effectiveStatuses.includes('all') ? [] : effectiveStatuses;

      const promises = [];
      const nonDeletedStatuses = statusesToFetch.filter((s) => s !== 'deleted');
      const mainQuery = nonDeletedStatuses.length > 0
        ? `/api/admin/listings-search?statuses=${nonDeletedStatuses.join(',')}&types=${typesToFetch.join(',')}`
        : `/api/admin/listings-search?types=${typesToFetch.join(',')}`;

      promises.push(
        apiClient.get(mainQuery).catch(() => {
          const fallbackPromises = [];
          const fallbackStatuses = nonDeletedStatuses.length > 0
            ? nonDeletedStatuses
            : ['pending', 'approved', 'rejected', 'expired'];
          for (const type of typesToFetch) {
            for (const status of fallbackStatuses) {
              fallbackPromises.push(
                apiClient.get(`/api/admin/approve/${type}?status=${status}`).catch(() => [])
              );
            }
          }
          return Promise.all(fallbackPromises).then((results) => results.flat());
        })
      );

      if (hasDeleted || statusesToFetch.includes('deleted')) {
        const deletedPromises = typesToFetch.map((type) => {
          const typeSingular = { cars: 'car', bikes: 'bike', parts: 'part', plates: 'plate', buying_requests: 'buying_request' }[type] || 'car';
          return apiClient.get(`/api/admin/deleted-listings?type=${typeSingular}&limit=100`).catch(() => ({ events: [] }));
        });
        promises.push(Promise.all(deletedPromises));
      } else {
        promises.push(Promise.resolve([]));
      }

      promises.push(Promise.resolve([]));

      const [mainResponse, deletedResponses] = await Promise.all(promises);

      let allListings = Array.isArray(mainResponse)
        ? mainResponse
        : (Array.isArray(mainResponse?.listings) ? mainResponse.listings : []);

      const deletedArrays = Array.isArray(deletedResponses) ? deletedResponses : [deletedResponses];
      for (const resp of deletedArrays) {
        const events = Array.isArray(resp?.events) ? resp.events : Array.isArray(resp) ? resp : [];
        for (const evt of events) {
          allListings.push({
            id: evt.listing_id,
            listing_type: evt.listing_type,
            title: `${evt.listing_type} ${evt.listing_id ? evt.listing_id.slice(0, 8) : ''}`,
            status: 'deleted',
            deleted_reason: evt.reason,
            deleted_by_role: evt.deleted_by_role,
            deleted_at: evt.created_at,
            created_at: evt.created_at,
            user_email: evt.deleted_by || 'N/A',
          });
        }
      }

      setListings(allListings);
    } catch (error) {
      console.error('Failed to fetch listings:', error);
      setListings([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTypes.join(','), effectiveStatuses.join(','), hasDeleted]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  useEffect(() => {
    const onFocus = () => fetchListings();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchListings]);

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

  const getListingTitle = (listing) => {
    if (listing.display_title) return listing.display_title;
    if (listing.listing_title) return listing.listing_title;
    if (listing.title) return listing.title;
    if (listing.item_name) return listing.item_name;
    return `#${listing.id ? listing.id.slice(0, 8) : 'Unknown'}`;
  };

  const getListingImage = (listing) => {
    if (!listing.images || listing.images.length === 0) return null;
    const img = listing.images[0];
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
    if (!searchText.trim()) return listings.slice(0, 100);
    const q = searchText.toLowerCase();
    return listings.filter((l) => {
      const title = getListingTitle(l).toLowerCase();
      const id = (l.id || '').toLowerCase();
      return title.includes(q) || id.includes(q);
    }).slice(0, 100);
  }, [listings, searchText]);

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
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-white/[0.06] text-white/60 border border-white/10">
            {listingSummary.visible} shown
          </span>
          {listingSummary.pendingCount > 0 && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
              {listingSummary.pendingCount} pending
            </span>
          )}
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
            activeKeys={effectiveStatuses.concat(hasDeleted ? ['deleted'] : [])}
            paramKey="statuses"
            allowed={ALL_STATUSES.concat(['deleted'])}
          />
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Thumbnail', 'Listing', 'Type', 'Status', 'Seller', 'Views', 'Created', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium whitespace-nowrap">
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
                      <td colSpan={8} className="py-0">
                        <EmptyState icon={Inbox} title="No listings match your filters." />
                      </td>
                    </tr>
                  )
                  : filtered.map((listing, i) => {
                    const thumb = getListingImage(listing);
                    const title = getListingTitle(listing);
                    const seller = listing.user_email || listing.seller_email || '—';
                    const views = Number(listing.view_count ?? listing.views ?? 0);
                    const displayStatus = listing.display_status || listing.listing_state || listing.status || 'pending';
                    const lt = listing.listing_type || 'cars';
                    const isPending = (listing._table_status || listing.status) === 'pending';

                    return (
                      <motion.tr
                        key={`${lt}-${listing.id}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors group"
                      >
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
                        <td className="px-4 py-3 max-w-[160px]">
                          <p className="text-white/60 text-sm truncate">{seller}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white/60 text-sm">{views.toLocaleString()}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-white/40 text-xs whitespace-nowrap">{relTime(listing.created_at)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                            <button
                              title="Public detail page"
                              onClick={() => {
                                const typeMap = { cars: 'cars', bikes: 'bikes', parts: 'car-parts', plates: 'plates' };
                                const pub = typeMap[lt] || lt;
                                window.open(`/${pub}/${listing.id}`, '_blank', 'noopener');
                              }}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              title="Admin detail"
                              onClick={() => navigate(`/admin/listings/${lt}/${listing.id}`)}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                            >
                              <BarChart3 size={15} />
                            </button>
                            {isPending && (
                              <>
                                <button
                                  title="Approve"
                                  onClick={() => { setSelectedListing(listing); setShowApproveConfirm(true); }}
                                  className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-white/50 hover:text-emerald-300 transition-colors"
                                  disabled={actionLoading}
                                >
                                  <CheckCircle2 size={15} />
                                </button>
                                <button
                                  title="Reject"
                                  onClick={() => {
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
                                <button
                                  title="Delete"
                                  onClick={() => {
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
        {!loading && listings.length > 100 && (
          <div className="px-4 py-3 border-t border-white/[0.06]">
            <p className="text-xs text-white/30">Showing 100 of {listings.length} listings</p>
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
      </AnimatePresence>
    </div>
  );
};

export default AdminListings;
