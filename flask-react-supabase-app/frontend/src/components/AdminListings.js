import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { LISTING_REJECTION_REASONS } from './admin/rejectionConstants';
import '../styles/AdminOps.css';

const ADMIN_DELETE_REASONS = [
  'Duplicate listing',
  'Fraud or suspicious activity',
  'Prohibited or inappropriate content',
  'Policy violation',
  'Incorrect information',
  'Spam',
  'Price manipulation',
];

const AdminListings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get('filter') || 'cars';
  const statusFilter = searchParams.get('status') || 'pending';
  const [listings, setListings] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedListing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectionNote, setRejectionNote] = useState('');
  const [selectedRejectIndex, setSelectedRejectIndex] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteReasonDetails, setDeleteReasonDetails] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastType, setToastType] = useState('success');
  const navigate = useNavigate();

  const showToast = (message, type = 'success') => {
    setSuccessMessage(message);
    setToastType(type);
    setToastVisible(true);
    setTimeout(() => {
      setToastVisible(false);
      setTimeout(() => setSuccessMessage(''), 300);
    }, 4000);
  };

  const fetchListings = useCallback(async () => {
    try {
      setLoading(true);

      if (statusFilter === 'deleted') {
        const params = new URLSearchParams({ limit: '100' });
        if (filter === 'cars') params.set('type', 'car');
        else if (filter === 'bikes') params.set('type', 'bike');
        else if (filter === 'parts') params.set('type', 'part');
        else if (filter === 'plates') params.set('type', 'plate');

        const response = await apiClient.get(`/api/admin/deleted-listings?${params}`);
        const events = Array.isArray(response?.events) ? response.events
          : Array.isArray(response) ? response : [];

        const mappedListings = events.map((evt) => ({
          id: evt.listing_id,
          listing_type: evt.listing_type,
          title: `${evt.listing_type} ${evt.listing_id ? evt.listing_id.slice(0, 8) : ''}`,
          status: 'deleted',
          deleted_reason: evt.reason,
          deleted_by_role: evt.deleted_by_role,
          deleted_at: evt.created_at,
          created_at: evt.created_at,
          user_email: evt.deleted_by || 'N/A',
        }));

        setListings(mappedListings);
        setStats({});
        return;
      }

      const [response, statsResponse] = await Promise.all([
        apiClient.get(`/api/admin/approve/${filter}?status=${statusFilter}`),
        apiClient.get('/api/admin/stats').catch(() => ({})),
      ]);
      setListings(Array.isArray(response) ? response : []);
      setStats(statsResponse || {});
    } catch (error) {
      console.error('Failed to fetch listings:', error);
      setListings([]);
      setStats({});
    } finally {
      setLoading(false);
    }
  }, [filter, statusFilter]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  useEffect(() => {
    const onFocus = () => fetchListings();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchListings]);

  const updateParams = (key, value) => {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
    setSearchParams(params);
  };

  const handleApprove = async (listingId) => {
    try {
      setActionLoading(true);
      await apiClient.post(`/api/admin/approve/${filter}/${listingId}/approve`);
      setListings(listings.filter(l => l.id !== listingId));
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
      const selected = selectedRejectIndex !== '' ? LISTING_REJECTION_REASONS[Number(selectedRejectIndex)] : null;
      await apiClient.post(`/api/admin/approve/${filter}/${selectedListing.id}/reject`, {
        rejection_note: selected
          ? `${selected.reason}${rejectionNote.trim() && rejectionNote.trim() !== selected.reason ? ` - ${rejectionNote.trim()}` : ''}`
          : rejectionNote,
        rejection_reason: selected?.reason || '',
        rejection_fix: selected?.fix || '',
      });
      setListings(listings.filter(l => l.id !== selectedListing.id));
      showToast('Listing rejected successfully', 'success');
      setShowRejectModal(false);
      setShowRejectConfirm(false);
      setRejectionNote('');
      setSelectedRejectIndex('');
    } catch (error) {
      console.error('Failed to reject listing:', error);
      showToast('Failed to reject listing. Please try again.', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const getDeleteType = (value) => {
    const map = {
      cars: 'car',
      bikes: 'bike',
      parts: 'part',
      plates: 'plate',
    };
    return map[value] || 'car';
  };

  const handleDeleteListing = async () => {
    if (!selectedListing) return;
    if (!deleteReason.trim()) {
      showToast('Please select a removal reason.', 'error');
      return;
    }
    try {
      setActionLoading(true);
      const finalReason = deleteReasonDetails.trim()
        ? `${deleteReason}: ${deleteReasonDetails.trim()}`
        : deleteReason;
      await apiClient.request(`/api/${getDeleteType(filter)}/${selectedListing.id}/delete`, {
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
    return `Listing #${listing.id ? listing.id.slice(0, 8) : 'Unknown'}`;
  };

  const getListingPrice = (listing) => {
    const price = listing.display_price ?? listing.price ?? listing.expected_selling_price;
    if (!price) return 'N/A';
    return `${Number(price).toLocaleString()} AED`;
  };

  const getListingImage = (listing, index = 0) => {
    if (!listing.images || listing.images.length === 0) return null;
    const img = listing.images[index];
    return img.display_url || img.image_url || img.url || null;
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: { background: 'rgba(255,193,7,0.15)', border: '1px solid rgba(255,193,7,0.3)', color: '#ffc107' },
      approved: { background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.3)', color: '#4caf50' },
      rejected: { background: 'rgba(244,67,54,0.15)', border: '1px solid rgba(244,67,54,0.3)', color: '#f44336' },
      deleted: { background: 'rgba(156,163,175,0.15)', border: '1px solid rgba(156,163,175,0.3)', color: '#9ca3af' },
    };
    const s = styles[status] || styles.pending;
    return (
      <span style={{ ...s, padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600, textTransform: 'capitalize' }}>
        {status}
      </span>
    );
  };

  const getListingVin = (listing) =>
    listing?.vin_number || listing?.chassis_number || listing?.vin || null;

  const getLeadMetrics = (listing) => {
    const metrics = listing?.lead_metrics || {};
    const callClick = Number(metrics.call_click || 0);
    const whatsappClick = Number(metrics.whatsapp_click || 0);
    const vinOpen = Number(metrics.vin_open || 0);
    const qualifiedLeads = Number(metrics.qualified_leads || (callClick + whatsappClick));
    return { callClick, whatsappClick, vinOpen, qualifiedLeads };
  };

  const listingSummary = useMemo(() => {
    const visible = listings.length;
    const statsKey = filter === 'plates' ? 'plates' : filter;
    const pendingOfType = Number(stats[`${statsKey}_pending`] || 0);
    const views = listings.reduce((sum, listing) => sum + Number(listing.view_count || 0), 0);
    const leads = listings.reduce((sum, listing) => {
      const metrics = getLeadMetrics(listing);
      return sum + metrics.qualifiedLeads;
    }, 0);
    return {
      visible,
      pendingOfType,
      views,
      leads,
    };
  }, [filter, listings, stats]);

  const ListingCard = ({ listing }) => (
    <div className="listing-card">
      <div className="listing-info">
        {getListingImage(listing) && (
          <img
            src={getListingImage(listing)}
            alt={getListingTitle(listing)}
            style={{ width: '100%', aspectRatio: 'var(--listing-image-frame-ratio, 16 / 10)', objectFit: 'cover', borderRadius: '8px', marginBottom: '12px' }}
            onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
          />
        )}
        <h3>{getListingTitle(listing)}</h3>
        <p><strong>Price:</strong> {getListingPrice(listing)}</p>
        <p><strong>Seller:</strong> {listing.user_email || listing.seller_email || 'N/A'}</p>
        <p><strong>VIN:</strong> {getListingVin(listing) || 'N/A'}</p>
        <p><strong>Leads:</strong> {getLeadMetrics(listing).qualifiedLeads}</p>
        <p><strong>Calls:</strong> {getLeadMetrics(listing).callClick} · <strong>WhatsApp:</strong> {getLeadMetrics(listing).whatsappClick}</p>
        <p><strong>VIN Opens:</strong> {getLeadMetrics(listing).vinOpen}</p>
        <p><strong>Status:</strong> {getStatusBadge(listing.status || statusFilter)}</p>
        <p><strong>Created:</strong> {listing.created_at ? new Date(listing.created_at).toLocaleDateString() : 'N/A'}</p>
      </div>
      <div className="listing-actions">
        <button
          onClick={() => {
            navigate(`/admin/listings/${filter}/${listing.id}`);
          }}
          className="action-button view-btn"
        >
          View Details
        </button>
        {(statusFilter === 'pending') && (
          <button
            onClick={() => handleApprove(listing.id)}
            className="action-button approve-btn"
            disabled={actionLoading}
          >
            Approve
          </button>
        )}
      </div>
    </div>
  );

  const DeletedListingCard = ({ listing }) => (
    <div className="listing-card">
      <div className="listing-info">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
          <span className="status-badge status-suspended" style={{ margin: 0 }}>
            Deleted
          </span>
          <span className="status-badge status-pending" style={{ margin: 0 }}>
            {listing.listing_type}
          </span>
        </div>
        <h3>{listing.title}</h3>
        <p><strong>Reason:</strong> {listing.deleted_reason}</p>
        <p><strong>Deleted by:</strong> {listing.deleted_by_role}</p>
        <p><strong>When:</strong> {listing.deleted_at ? new Date(listing.deleted_at).toLocaleString() : 'N/A'}</p>
        <p><strong>ID:</strong> <code style={{ fontSize: '12px', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '4px' }}>{listing.id}</code></p>
      </div>
      <div className="listing-actions">
        <button
          onClick={() => navigate(`/admin/listings/${filter}/${listing.id}`)}
          className="action-button view-btn"
        >
          View Details
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Loading {statusFilter} {filter}...</p>
      </div>
    );
  }

  const filterOptions = ['cars', 'parts', 'plates', 'bikes'];
  const statusOptions = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'deleted', label: 'Deleted' },
  ];

  return (
    <div className="admin-ops admin-page admin-listings">
      {/* Toast Notification */}
      <div
        style={{
          position: 'fixed',
          top: '24px',
          right: '24px',
          zIndex: 9999,
          transform: toastVisible ? 'translateX(0)' : 'translateX(calc(100% + 32px))',
          opacity: toastVisible ? 1 : 0,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          background: toastType === 'success'
            ? 'linear-gradient(135deg, rgba(16,185,129,0.95), rgba(5,120,80,0.98))'
            : 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(180,30,30,0.98))',
          border: toastType === 'success'
            ? '1px solid rgba(52,211,153,0.4)'
            : '1px solid rgba(248,113,113,0.4)',
          borderRadius: '14px',
          padding: '16px 24px',
          boxShadow: toastType === 'success'
            ? '0 20px 60px rgba(16,185,129,0.3)'
            : '0 20px 60px rgba(239,68,68,0.3)',
          maxWidth: '420px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          {toastType === 'success' ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          )}
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#fff' }}>{successMessage}</p>
        </div>
      </div>

      <div className="admin-page-header">
        <div>
          <div className="admin-label">Listings</div>
          <h1 className="admin-page-title">{statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)} {filter.charAt(0).toUpperCase() + filter.slice(1)}</h1>
          <p className="admin-page-subtitle">Review and manage listing approvals, drill into a listing record, and move into the specific detail page when you need the full history.</p>
        </div>
        <div className="admin-actions">
          <span className="admin-status-pill tone-warning">{listingSummary.visible} shown</span>
          <span className="admin-status-pill">{statusFilter}</span>
        </div>
      </div>

      {statusFilter !== 'deleted' && (
        <div className="admin-kpi-grid" style={{ marginBottom: '18px' }}>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Visible listings</div>
            <div className="admin-kpi-value">{listingSummary.visible}</div>
            <div className="admin-kpi-note">Listings currently shown for this status filter.</div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Pending</div>
            <div className="admin-kpi-value">{listingSummary.pendingOfType}</div>
            <div className="admin-kpi-note">Pending items across the selected listing type.</div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Views</div>
            <div className="admin-kpi-value">{listingSummary.views}</div>
            <div className="admin-kpi-note">Combined views across visible items.</div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Leads</div>
            <div className="admin-kpi-value">{listingSummary.leads}</div>
            <div className="admin-kpi-note">Call and WhatsApp actions for the current queue.</div>
          </div>
        </div>
      )}

      {statusFilter === 'deleted' && (
        <div className="admin-kpi-grid" style={{ marginBottom: '18px' }}>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Deleted listings</div>
            <div className="admin-kpi-value">{listingSummary.visible}</div>
            <div className="admin-kpi-note">Total deleted {filter} shown below.</div>
          </div>
          <div className="admin-kpi-card">
            <div className="admin-kpi-label">Removal types</div>
            <div className="admin-kpi-value">{new Set(listings.map(l => l.deleted_by_role)).size}</div>
            <div className="admin-kpi-note">Different deletion sources (admin, system, user).</div>
          </div>
        </div>
      )}

      <div className="filter-tabs" style={{ marginBottom: '12px' }}>
        {statusOptions.map(opt => (
          <button
            key={opt.key}
            onClick={() => updateParams('status', opt.key)}
            className={`filter-tab ${statusFilter === opt.key ? 'active' : ''}`}
          >
            {opt.label}
            {opt.key === 'deleted' && (
              <span style={{ marginLeft: '6px', opacity: 0.6, fontSize: '11px' }}>🗑</span>
            )}
          </button>
        ))}
      </div>

      <div className="filter-tabs">
        {filterOptions.map(option => (
          <button
            key={option}
            onClick={() => updateParams('filter', option)}
            className={`filter-tab ${filter === option ? 'active' : ''}`}
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>

      {listings.length === 0 ? (
        <div className="empty-state">
          <h2>No {statusFilter} {filter}</h2>
          <p>There are no {statusFilter} {filter} listings at this time.</p>
        </div>
      ) : statusFilter === 'deleted' ? (
        <div className="listings-grid">
          {listings.map(listing => (
            <DeletedListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      ) : (
        <div className="listings-grid">
          {listings.map(listing => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && selectedListing && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            {!showRejectConfirm ? (
              <>
                <div className="modal-header">
                  <h2>Reject Listing</h2>
                  <button onClick={() => { setShowRejectModal(false); setShowRejectConfirm(false); }} className="close-modal" type="button">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="modal-body">
                  <p><strong>{getListingTitle(selectedListing)}</strong> will be rejected and the seller will be notified.</p>
                  <label htmlFor="reject-reason"><strong>Rejection reason</strong></label>
                  <select
                    id="reject-reason"
                    value={selectedRejectIndex}
                    onChange={(event) => setSelectedRejectIndex(event.target.value)}
                  >
                    <option value="">Select a reason</option>
                    {LISTING_REJECTION_REASONS.map((reason, index) => (
                      <option key={index} value={index}>
                        {reason.reason}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="reject-note" style={{ marginTop: '12px' }}>
                    <strong>Additional notes (optional)</strong>
                  </label>
                  <textarea
                    id="reject-note"
                    value={rejectionNote}
                    onChange={(event) => setRejectionNote(event.target.value)}
                    placeholder="Optional notes for the seller..."
                    rows={3}
                  />
                </div>
                <div className="modal-footer">
                  <button
                    onClick={() => { setShowRejectModal(false); setShowRejectConfirm(false); }}
                    className="action-button secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => setShowRejectConfirm(true)}
                    className="action-button reject-btn"
                    disabled={!selectedRejectIndex && !rejectionNote.trim()}
                  >
                    Review Rejection
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-header" style={{ borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
                  <h2 style={{ color: '#f87171' }}>Confirm Rejection</h2>
                </div>
                <div className="modal-body" style={{ textAlign: 'center', padding: '32px' }}>
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 20px',
                  }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  </div>
                  <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.8)', marginBottom: '8px' }}>
                    Are you sure you want to reject this listing?
                  </p>
                  <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>
                    <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{getListingTitle(selectedListing)}</strong>
                    <br />The seller will be notified with the rejection reason.
                  </p>
                </div>
                <div className="modal-footer">
                  <button
                    onClick={() => setShowRejectConfirm(false)}
                    className="action-button secondary"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={handleReject}
                    className="action-button reject-btn"
                    disabled={actionLoading}
                    style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)' }}
                  >
                    {actionLoading ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                        Rejecting...
                      </span>
                    ) : 'Yes, Reject Listing'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && selectedListing && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            {!showDeleteConfirm ? (
              <>
                <div className="modal-header">
                  <h2>Remove Listing</h2>
                  <button onClick={() => { setShowDeleteModal(false); setShowDeleteConfirm(false); }} className="close-modal" type="button">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="modal-body">
                  <p><strong>{getListingTitle(selectedListing)}</strong> will be permanently removed from the marketplace.</p>
                  <div style={{
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.15)',
                    borderRadius: '10px',
                    padding: '12px 14px',
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: 'rgba(255,255,255,0.6)',
                  }}>
                    The listing owner will receive an email notification about this removal.
                  </div>
                  <label htmlFor="delete-reason"><strong>Removal reason</strong></label>
                  <select
                    id="delete-reason"
                    value={deleteReason}
                    onChange={(event) => setDeleteReason(event.target.value)}
                  >
                    <option value="">Select a reason</option>
                    {ADMIN_DELETE_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="delete-reason-details" style={{ marginTop: '12px' }}>
                    <strong>Additional details (optional)</strong>
                  </label>
                  <textarea
                    id="delete-reason-details"
                    value={deleteReasonDetails}
                    onChange={(event) => setDeleteReasonDetails(event.target.value)}
                    placeholder="Optional internal details for admin history..."
                    rows={3}
                  />
                </div>
                <div className="modal-footer">
                  <button
                    onClick={() => { setShowDeleteModal(false); setShowDeleteConfirm(false); }}
                    className="action-button secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!deleteReason.trim()) {
                        showToast('Please select a removal reason.', 'error');
                        return;
                      }
                      setShowDeleteConfirm(true);
                    }}
                    className="action-button reject-btn"
                    disabled={!deleteReason.trim()}
                  >
                    Review Removal
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-header" style={{ borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
                  <h2 style={{ color: '#f87171' }}>Confirm Permanent Removal</h2>
                </div>
                <div className="modal-body" style={{ textAlign: 'center', padding: '32px' }}>
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 20px',
                  }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </div>
                  <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.8)', marginBottom: '8px' }}>
                    This action cannot be undone.
                  </p>
                  <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>
                    <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{getListingTitle(selectedListing)}</strong>
                    <br />will be permanently deleted and the owner will be emailed.
                  </p>
                  <div style={{
                    marginTop: '16px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '10px',
                    padding: '12px',
                    textAlign: 'left',
                  }}>
                    <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Reason</p>
                    <p style={{ margin: 0, fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>{deleteReason}{deleteReasonDetails ? `: ${deleteReasonDetails}` : ''}</p>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="action-button secondary"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={handleDeleteListing}
                    className="action-button reject-btn"
                    disabled={actionLoading}
                    style={{ background: 'linear-gradient(135deg, #ef4444, #991b1b)' }}
                  >
                    {actionLoading ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="spinner" style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                        Removing...
                      </span>
                    ) : 'Yes, Delete Permanently'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default AdminListings;
