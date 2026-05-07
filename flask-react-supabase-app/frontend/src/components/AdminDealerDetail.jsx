import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { DEALER_REJECTION_REASONS } from './admin/rejectionConstants';
import { formatDateTime, formatNumber, getDisplayName, getEventActorLabel, getStatusTone } from './admin/adminUtils';
import '../styles/AdminOps.css';

const AdminDealerDetail = () => {
  const { dealerId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReasonIndex, setRejectReasonIndex] = useState('');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        setLoading(true);
        const response = await apiClient.get(`/api/admin/dealers/${dealerId}/overview`);
        setData(response || null);
      } catch (fetchError) {
        console.error('Failed to load dealer overview:', fetchError);
        setError(fetchError.message || 'Failed to load dealer overview');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [dealerId]);

  const dealer = data?.dealer || {};
  const summary = data?.summary || {};
  const recentListings = data?.recent_listings || [];
  const recentEvents = data?.recent_events || [];
  const statusTone = dealer.dealer_verified ? 'success' : 'warning';
  const accountTone = getStatusTone(dealer.account_status || 'active');

  const listingTotals = useMemo(() => Object.entries(data?.listing_summary || {}), [data]);

  const refreshData = async () => {
    const response = await apiClient.get(`/api/admin/dealers/${dealerId}/overview`);
    setData(response || null);
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

  const handleReject = async () => {
    try {
      setActionLoading(true);
      const selected = rejectReasonIndex !== '' ? DEALER_REJECTION_REASONS[Number(rejectReasonIndex)] : null;
      const note = selected
        ? `${selected.reason}${reason.trim() ? ` - ${reason.trim()}` : ''}`
        : reason || 'Rejected by admin';
      await apiClient.post(`/api/admin/dealers/${dealerId}/reject`, {
        rejection_note: note,
        rejection_reason: selected?.reason || '',
        rejection_fix: selected?.fix || '',
      });
      await refreshData();
      setShowRejectModal(false);
      setRejectReasonIndex('');
      setReason('');
    } catch (actionError) {
      setError(actionError.message || 'Failed to reject dealer');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-ops admin-page">
        <LoadingSpinner message="Loading dealer intelligence..." />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="admin-ops admin-page">
        <div className="admin-card">
          <h2>Dealer not available</h2>
          <p className="admin-muted">{error}</p>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            <button className="admin-button admin-button-secondary" type="button" onClick={() => navigate('/admin/dealers')}>
              Back to dealers
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-ops admin-page">
      <div className="admin-page-header">
        <div>
          <Link to="/admin/dealers" className="admin-back-link">Back to dealers</Link>
          <h1 className="admin-page-title">{getDisplayName(dealer)}</h1>
          <p className="admin-page-subtitle">
            Dealer verification and performance view with listings, leads, and recent moderation context.
          </p>
        </div>
        <div className="admin-actions">
          <span className={`admin-status-pill tone-${statusTone}`}>{dealer.dealer_verified ? 'Verified' : 'Pending'}</span>
          <span className={`admin-status-pill tone-${accountTone}`}>{dealer.account_status || 'active'}</span>
          <span className="admin-status-pill">{dealer.profile_completion_percentage ?? 0}% profile</span>
        </div>
      </div>

      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total Listings</div>
          <div className="admin-kpi-value">{formatNumber(summary.total_listings)}</div>
          <div className="admin-kpi-note">Dealer-owned inventory across all categories.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total Views</div>
          <div className="admin-kpi-value">{formatNumber(summary.total_views)}</div>
          <div className="admin-kpi-note">Aggregated listing attention.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Qualified Leads</div>
          <div className="admin-kpi-value">{formatNumber(summary.qualified_leads)}</div>
          <div className="admin-kpi-note">Calls and WhatsApp actions.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Reports</div>
          <div className="admin-kpi-value">{formatNumber(summary.recent_reports)}</div>
          <div className="admin-kpi-note">Reported activity for this dealer.</div>
        </div>
      </div>

      <div className="admin-columns admin-section">
        <div className="admin-surface">
          <div className="admin-hero-row">
            <div>
              <div className="admin-label">Dealer profile</div>
              <h2 style={{ margin: '8px 0' }}>{getDisplayName(dealer)}</h2>
              <div className="admin-muted">{dealer.email || 'No email available'}</div>
              <div className="admin-muted">{dealer.company_name || 'No company name'}</div>
            </div>
            <div className="admin-actions">
              <span className="admin-chip">{dealer.is_dealer ? 'Dealer' : 'User'}</span>
              <span className="admin-chip">Phone: {dealer.phone || 'N/A'}</span>
              <span className="admin-chip">Joined: {formatDateTime(dealer.created_at)}</span>
            </div>
          </div>

          <div className="admin-divider" />

          <div className="admin-grid-2">
            <div className="admin-card">
              <div className="admin-label">Company</div>
              <p className="admin-muted">Registration: {dealer.company_registration_number || 'Not set'}</p>
              <p className="admin-muted">Trade license: {dealer.trade_license_number || 'Not set'}</p>
              <p className="admin-muted">Phone verified: {dealer.phone_verified ? 'Yes' : 'No'}</p>
              <p className="admin-muted">Email verified: {dealer.email_verified ? 'Yes' : 'No'}</p>
              <p className="admin-muted">Verification requested: {formatDateTime(dealer.dealer_verification_requested_at)}</p>
              <p className="admin-muted">Verified at: {formatDateTime(dealer.dealer_verified_at)}</p>
              {dealer.company_documents && dealer.company_documents.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <p className="admin-muted" style={{ marginBottom: 4 }}>Uploaded documents:</p>
                  {dealer.company_documents.map((doc, idx) => (
                    <a
                      key={doc.storage_path || idx}
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', fontSize: 12, color: '#8bd6b4', textDecoration: 'underline', marginBottom: 2 }}
                    >
                      {doc.filename || `Document ${idx + 1}`}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <div className="admin-card">
              <div className="admin-label">Location</div>
              <p className="admin-muted">City: {dealer.city || 'Not set'}</p>
              <p className="admin-muted">Emirate: {dealer.emirate || 'Not set'}</p>
              <p className="admin-muted">Country: {dealer.country || 'Not set'}</p>
              <p className="admin-muted">Profile completion: {dealer.profile_completion_percentage ?? 0}%</p>
              <p className="admin-muted">Status note: {dealer.rejection_note || 'None'}</p>
            </div>
          </div>
        </div>

        <div className="admin-surface">
          <div className="admin-label">Verification</div>
          <h3>Approve or reject dealer status</h3>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            {!dealer.dealer_verified ? (
              <button className="admin-button admin-button-primary" type="button" disabled={actionLoading} onClick={handleVerify}>
                Verify dealer
              </button>
            ) : null}
            <button className="admin-button" type="button" disabled={actionLoading} onClick={() => setShowRejectModal(true)}>
              Reject
            </button>
            <button className="admin-button admin-button-secondary" type="button" onClick={() => navigate(`/admin/users/${dealerId}`)}>
              Open user profile
            </button>
          </div>
        </div>
      </div>

      <div className="admin-section">
        <h2>Listing mix</h2>
        <div className="admin-three-up">
          {listingTotals.map(([type, bucket]) => (
            <div key={type} className="admin-kpi-card">
              <div className="admin-kpi-label">{type}</div>
              <div className="admin-kpi-value">{formatNumber(bucket.count || 0)}</div>
              <div className="admin-kpi-note">{formatNumber(bucket.views || 0)} views · {formatNumber(bucket.approved || 0)} approved</div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-section">
        <h2>Recent listings</h2>
        <div className="admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Listing</th>
                <th>Type</th>
                <th>Status</th>
                <th>Views</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {recentListings.length === 0 ? (
                <tr><td colSpan="5" className="admin-muted">No listings found.</td></tr>
              ) : recentListings.map((listing) => (
                <tr key={`${listing.type}-${listing.id}`}>
                  <td>
                    <Link to={`/admin/listings/${listing.type}/${listing.id}`}>{listing.title}</Link>
                  </td>
                  <td>{listing.type}</td>
                  <td>{listing.status}</td>
                  <td>{formatNumber(listing.view_count)}</td>
                  <td>{formatDateTime(listing.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-columns admin-section">
        <div className="admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Actor</th>
                <th>Recent activity</th>
                <th>Action</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.length === 0 ? (
                <tr><td colSpan="4" className="admin-muted">No events found.</td></tr>
              ) : recentEvents.slice(0, 12).map((event) => (
                <tr key={event.id}>
                  <td>{getEventActorLabel(event)}</td>
                  <td>{event.listing_type} · {event.listing_id}</td>
                  <td>{event.action}</td>
                  <td>{formatDateTime(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Verification signals</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Email verified</td>
                <td>{dealer.email_verified ? 'Yes' : 'No'}</td>
              </tr>
              <tr>
                <td>Phone verified</td>
                <td>{dealer.phone_verified ? 'Yes' : 'No'}</td>
              </tr>
              <tr>
                <td>Dealer verified</td>
                <td>{dealer.dealer_verified ? 'Yes' : 'No'}</td>
              </tr>
              <tr>
                <td>Company documents</td>
                <td>
                  {dealer.company_documents && dealer.company_documents.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {dealer.company_documents.map((doc, idx) => (
                        <a
                          key={doc.storage_path || idx}
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#8bd6b4', fontSize: 13, textDecoration: 'underline' }}
                        >
                          {doc.filename || `Document ${idx + 1}`}
                        </a>
                      ))}
                    </div>
                  ) : dealer.verification_documents_submitted ? (
                    'Submitted'
                  ) : (
                    'Not submitted'
                  )}
                </td>
              </tr>
              <tr>
                <td>Profile completeness</td>
                <td>{dealer.profile_completion_percentage ?? 0}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {showRejectModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="modal-content" style={{ background: '#1a1a2e', borderRadius: 16, padding: 28, maxWidth: 500, width: '90%', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h2 style={{ margin: 0, color: '#fff', fontSize: 18 }}>Reject Dealer</h2>
              <button onClick={() => { setShowRejectModal(false); setRejectReasonIndex(''); setReason(''); }} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 20 }}>×</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="dealer-reject-reason" style={{ display: 'block', color: '#aaa', fontSize: 13, marginBottom: 4 }}>Reason for rejection *</label>
              <select
                id="dealer-reject-reason"
                value={rejectReasonIndex}
                onChange={(e) => setRejectReasonIndex(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14 }}
              >
                <option value="">Select a reason...</option>
                {DEALER_REJECTION_REASONS.map((item, idx) => (
                  <option key={idx} value={idx}>{item.reason}</option>
                ))}
              </select>
            </div>
            {rejectReasonIndex !== '' && (
              <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 4, fontWeight: 600 }}>How to fix:</div>
                <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.5 }}>{DEALER_REJECTION_REASONS[Number(rejectReasonIndex)].fix}</div>
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="dealer-reject-note" style={{ display: 'block', color: '#aaa', fontSize: 13, marginBottom: 4 }}>Additional notes (optional)</label>
              <textarea
                id="dealer-reject-note"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Add any extra context..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 14, resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowRejectModal(false); setRejectReasonIndex(''); setReason(''); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#aaa', cursor: 'pointer' }}>Cancel</button>
              <button
                onClick={handleReject}
                disabled={actionLoading || rejectReasonIndex === ''}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: rejectReasonIndex === '' ? '#555' : '#ef4444', color: '#fff', cursor: rejectReasonIndex === '' ? 'not-allowed' : 'pointer', fontWeight: 600 }}
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDealerDetail;
