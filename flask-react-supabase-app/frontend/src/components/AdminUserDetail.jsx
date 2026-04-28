import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { formatCurrencyAED, formatDate, formatDateTime, formatNumber, getDisplayName, getEventActorLabel, getListingTitle, getStatusTone } from './admin/adminUtils';
import '../styles/AdminOps.css';

const defaultActionState = { status: 'active', reason: '' };

const AdminUserDetail = () => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [actionState, setActionState] = useState(defaultActionState);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await apiClient.get(`/api/admin/users/${userId}/overview`);
        setData(response || null);
        setActionState((current) => ({
          ...current,
          status: response?.user?.account_status || 'active',
        }));
      } catch (fetchError) {
        console.error('Failed to load user overview:', fetchError);
        setError(fetchError.message || 'Failed to load user overview');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [userId]);

  const summary = data?.summary || {};
  const user = data?.user || {};
  const recentListings = data?.recent_listings || [];
  const recentEvents = data?.recent_events || [];
  const recentReports = data?.recent_reports || [];

  const statusTone = getStatusTone(user.account_status);
  const verifiedTone = user.email_verified && user.phone_verified ? 'success' : 'warning';

  const handleStatusSave = async () => {
    try {
      setActionLoading(true);
      setMessage('');
      await apiClient.patch(`/api/admin/users/${userId}/status`, {
        status: actionState.status,
        reason: actionState.reason,
      });
      setMessage(`User updated to ${actionState.status}.`);
      const response = await apiClient.get(`/api/admin/users/${userId}/overview`);
      setData(response || null);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update user status');
    } finally {
      setActionLoading(false);
    }
  };

  const listingTypeCounts = useMemo(() => {
    return Object.entries(data?.listing_summary || {}).map(([type, bucket]) => ({
      type,
      count: bucket.count || 0,
      views: bucket.views || 0,
      approved: bucket.approved || 0,
      pending: bucket.pending || 0,
      rejected: bucket.rejected || 0,
    }));
  }, [data]);

  if (loading) {
    return (
      <div className="admin-ops admin-page">
        <LoadingSpinner message="Loading user intelligence..." />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="admin-ops admin-page">
        <div className="admin-card">
          <h2>User not available</h2>
          <p className="admin-muted">{error}</p>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            <button className="admin-button admin-button-secondary" type="button" onClick={() => navigate('/admin/users')}>
              Back to users
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
          <Link to="/admin/users" className="admin-back-link">Back to people</Link>
          <h1 className="admin-page-title">{getDisplayName(user)}</h1>
          <p className="admin-page-subtitle">
            Full operator view for account health, verification, listing performance, and moderation history.
          </p>
        </div>
        <div className="admin-actions">
          <span className={`admin-status-pill tone-${statusTone}`}>{user.account_status || 'active'}</span>
          <span className={`admin-status-pill tone-${verifiedTone}`}>
            {user.email_verified ? 'Email verified' : 'Email unverified'}
          </span>
          <span className={`admin-status-pill ${user.phone_verified ? 'tone-success' : 'tone-warning'}`}>
            {user.phone_verified ? 'Phone verified' : 'Phone unverified'}
          </span>
        </div>
      </div>

      {message ? <div className="admin-card" style={{ marginBottom: '16px' }}>{message}</div> : null}

      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total Listings</div>
          <div className="admin-kpi-value">{formatNumber(summary.total_listings)}</div>
          <div className="admin-kpi-note">Across cars, bikes, parts, and plates.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total Views</div>
          <div className="admin-kpi-value">{formatNumber(summary.total_views)}</div>
          <div className="admin-kpi-note">Combined view count from owned inventory.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Qualified Leads</div>
          <div className="admin-kpi-value">{formatNumber(summary.qualified_leads)}</div>
          <div className="admin-kpi-note">Call and WhatsApp actions on owned listings.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Reports</div>
          <div className="admin-kpi-value">{formatNumber(summary.report_count)}</div>
          <div className="admin-kpi-note">Reports filed against or by this user.</div>
        </div>
      </div>

      <div className="admin-columns admin-section">
        <div className="admin-surface">
          <div className="admin-hero-row">
            <div>
              <div className="admin-label">Profile</div>
              <h2 style={{ margin: '8px 0' }}>{getDisplayName(user)}</h2>
              <div className="admin-muted">{user.email || 'No email available'}</div>
            </div>
            <div className="admin-actions">
              <span className="admin-chip">{user.is_admin ? 'Admin' : 'User'}</span>
              <span className="admin-chip">{user.is_dealer ? 'Dealer' : 'Personal account'}</span>
              <span className="admin-chip">{user.profile_completion_percentage ?? 0}% profile</span>
            </div>
          </div>

          <div className="admin-divider" />

          <div className="admin-grid-2">
            <div className="admin-card">
              <div className="admin-label">Contact</div>
              <p className="admin-muted">Phone: {user.phone || 'Not set'}</p>
              <p className="admin-muted">WhatsApp: {user.whatsapp_number || 'Not set'}</p>
              <p className="admin-muted">Location: {[user.city, user.emirate].filter(Boolean).join(', ') || 'Not set'}</p>
              <p className="admin-muted">Joined: {formatDateTime(user.created_at)}</p>
              <p className="admin-muted">Last login: {formatDateTime(user.last_login_at)}</p>
            </div>
            <div className="admin-card">
              <div className="admin-label">Verification</div>
              <p className="admin-muted">Email verified: {user.email_verified ? 'Yes' : 'No'}</p>
              <p className="admin-muted">Phone verified: {user.phone_verified ? 'Yes' : 'No'}</p>
              <p className="admin-muted">Dealer verified: {user.dealer_verified ? 'Yes' : 'No'}</p>
              <p className="admin-muted">Company: {user.company_name || 'Not set'}</p>
              <p className="admin-muted">Trade license: {user.trade_license_number || 'Not set'}</p>
              {user.rejection_note ? <p className="admin-muted">Internal note: {user.rejection_note}</p> : null}
            </div>
          </div>
        </div>

        <div className="admin-surface">
          <div className="admin-label">Moderation</div>
          <h3>Account status</h3>
          <div className="admin-field">
            <label htmlFor="user-status">Status</label>
            <select
              id="user-status"
              className="admin-select"
              value={actionState.status}
              onChange={(event) => setActionState((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="banned">Banned</option>
            </select>
          </div>
          <div className="admin-field" style={{ marginTop: '12px' }}>
            <label htmlFor="user-reason">Reason</label>
            <textarea
              id="user-reason"
              className="admin-textarea"
              value={actionState.reason}
              onChange={(event) => setActionState((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Add the reason for this action..."
            />
          </div>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            <button className="admin-button admin-button-primary" type="button" disabled={actionLoading} onClick={handleStatusSave}>
              {actionLoading ? 'Saving...' : 'Save status'}
            </button>
            <button className="admin-button admin-button-secondary" type="button" onClick={() => navigate('/admin/listings')}>
              Review listings
            </button>
          </div>
        </div>
      </div>

      <div className="admin-section">
        <h2>Listing breakdown</h2>
        <div className="admin-three-up">
          {listingTypeCounts.map((bucket) => (
            <div key={bucket.type} className="admin-kpi-card">
              <div className="admin-kpi-label">{bucket.type}</div>
              <div className="admin-kpi-value">{formatNumber(bucket.count)}</div>
              <div className="admin-kpi-note">
                {formatNumber(bucket.views)} views, {formatNumber(bucket.approved)} approved, {formatNumber(bucket.pending)} pending
              </div>
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
                <th>Price</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {recentListings.length === 0 ? (
                <tr>
                  <td colSpan="6" className="admin-muted">No listings found.</td>
                </tr>
              ) : recentListings.map((listing) => (
                <tr key={`${listing.type}-${listing.id}`}>
                  <td>
                    <Link to={`/admin/listings/${listing.type}/${listing.id}`}>{getListingTitle(listing)}</Link>
                  </td>
                  <td>{listing.type}</td>
                  <td><span className={`admin-status-pill tone-${getStatusTone(listing.status)}`}>{listing.status}</span></td>
                  <td>{formatNumber(listing.view_count)}</td>
                  <td>{formatCurrencyAED(listing.price)}</td>
                  <td>{formatDate(listing.created_at)}</td>
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
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.length === 0 ? (
                <tr><td colSpan="4" className="admin-muted">No recent activity found.</td></tr>
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
                <th>Recent reports</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentReports.length === 0 ? (
                <tr><td colSpan="3" className="admin-muted">No reports found.</td></tr>
              ) : recentReports.slice(0, 12).map((report) => (
                <tr key={report.id}>
                  <td>{report.listing_type} · {report.listing_id}</td>
                  <td>{report.reason || 'N/A'}</td>
                  <td>{report.status || 'pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminUserDetail;
