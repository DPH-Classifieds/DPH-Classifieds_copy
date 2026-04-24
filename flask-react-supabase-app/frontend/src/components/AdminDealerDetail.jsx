import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { formatDateTime, formatNumber, getDisplayName, getStatusTone } from './admin/adminUtils';
import '../styles/AdminOps.css';

const AdminDealerDetail = () => {
  const { dealerId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [reason, setReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

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
      await apiClient.post(`/api/admin/dealers/${dealerId}/reject`, {
        rejection_note: reason || 'Rejected by admin',
      });
      await refreshData();
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
          <div className="admin-field">
            <label htmlFor="dealer-reason">Rejection reason</label>
            <textarea
              id="dealer-reason"
              className="admin-textarea"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Add a rejection reason or internal note..."
            />
          </div>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            {!dealer.dealer_verified ? (
              <button className="admin-button admin-button-primary" type="button" disabled={actionLoading} onClick={handleVerify}>
                Verify dealer
              </button>
            ) : null}
            <button className="admin-button" type="button" disabled={actionLoading} onClick={handleReject}>
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
                <th>Recent activity</th>
                <th>Action</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.length === 0 ? (
                <tr><td colSpan="3" className="admin-muted">No events found.</td></tr>
              ) : recentEvents.slice(0, 12).map((event) => (
                <tr key={event.id}>
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
                <td>{dealer.verification_documents_submitted ? 'Submitted' : 'Not submitted'}</td>
              </tr>
              <tr>
                <td>Profile completeness</td>
                <td>{dealer.profile_completion_percentage ?? 0}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminDealerDetail;
