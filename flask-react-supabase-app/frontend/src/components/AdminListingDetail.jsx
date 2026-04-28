import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { formatCurrencyAED, formatDateTime, formatNumber, getDisplayName, getEventActorLabel, getListingTitle, getListingTypeLabel, getStatusTone } from './admin/adminUtils';
import '../styles/AdminOps.css';

const EMPTY_ARRAY = [];

const listingRouteType = (value) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'cars' || normalized === 'car') return 'car';
  if (normalized === 'bikes' || normalized === 'bike') return 'bike';
  if (normalized === 'parts' || normalized === 'part' || normalized === 'car-parts') return 'part';
  if (normalized === 'plates' || normalized === 'plate') return 'plate';
  return 'car';
};

const AdminListingDetail = () => {
  const { itemType, itemId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [moderationNote, setModerationNote] = useState('');
  const [removeReason, setRemoveReason] = useState('');

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

  const listing = data?.listing || {};
  const owner = data?.owner || {};
  const summary = data?.summary || {};
  const images = data?.images ?? EMPTY_ARRAY;
  const leadEvents = data?.lead_events ?? EMPTY_ARRAY;
  const reports = data?.reports ?? EMPTY_ARRAY;
  const deletionEvents = data?.deletion_events ?? EMPTY_ARRAY;

  const primaryRouteType = listingRouteType(itemType);
  const approvalRouteType = primaryRouteType === 'part' ? 'parts' : `${primaryRouteType}s`;
  const listingTypeLabel = getListingTypeLabel(itemType);
  const statusTone = getStatusTone(listing.status);

  const handleModerationAction = async (action) => {
    try {
      setActionLoading(true);
      const endpoint = action === 'delete'
        ? `/api/${primaryRouteType}/${itemId}/delete`
        : `/api/${approvalRouteType}/${itemId}/${action}`;
      const payload =
        action === 'reject'
          ? { rejection_note: moderationNote }
          : action === 'delete'
            ? { reason: removeReason || moderationNote || 'Removed by admin' }
            : {};
      await apiClient.request(endpoint, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      const response = await apiClient.get(`/api/admin/listings/${itemType}/${itemId}/overview`);
      setData(response || null);
    } catch (saveError) {
      setError(saveError.message || `Failed to ${action} listing`);
    } finally {
      setActionLoading(false);
    }
  };

  const leadTotals = useMemo(() => {
    return leadEvents.reduce(
      (acc, event) => {
        acc[event.action] = (acc[event.action] || 0) + 1;
        return acc;
      },
      { call_click: 0, whatsapp_click: 0, vin_open: 0, vin_reveal: 0 }
    );
  }, [leadEvents]);

  if (loading) {
    return (
      <div className="admin-ops admin-page">
        <LoadingSpinner message="Loading listing intelligence..." />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="admin-ops admin-page">
        <div className="admin-card">
          <h2>Listing not available</h2>
          <p className="admin-muted">{error}</p>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            <button className="admin-button admin-button-secondary" type="button" onClick={() => navigate('/admin/listings')}>
              Back to listings
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
          <Link to="/admin/listings" className="admin-back-link">Back to listings</Link>
          <h1 className="admin-page-title">{getListingTitle(listing)}</h1>
          <p className="admin-page-subtitle">
            Drilldown for {listingTypeLabel.toLowerCase()} performance, moderation history, owner context, and lead activity.
          </p>
        </div>
        <div className="admin-actions">
          <span className={`admin-status-pill tone-${statusTone}`}>{listing.status || 'pending'}</span>
          <span className="admin-status-pill">{listingTypeLabel}</span>
          <span className="admin-status-pill">{formatNumber(summary.view_count)} views</span>
        </div>
      </div>

      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Qualified Leads</div>
          <div className="admin-kpi-value">{formatNumber(summary.qualified_leads)}</div>
          <div className="admin-kpi-note">Call and WhatsApp interactions.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Call Clicks</div>
          <div className="admin-kpi-value">{formatNumber(summary.call_clicks || leadTotals.call_click)}</div>
          <div className="admin-kpi-note">Phone intent on this listing.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">WhatsApp Clicks</div>
          <div className="admin-kpi-value">{formatNumber(summary.whatsapp_clicks || leadTotals.whatsapp_click)}</div>
          <div className="admin-kpi-note">Messaging intent on this listing.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Reports</div>
          <div className="admin-kpi-value">{formatNumber(summary.report_count)}</div>
          <div className="admin-kpi-note">Reports and moderation actions.</div>
        </div>
      </div>

      <div className="admin-columns admin-section">
        <div className="admin-surface">
          <div className="admin-hero-row">
            <div>
              <div className="admin-label">Listing</div>
              <h2 style={{ margin: '8px 0' }}>{getListingTitle(listing)}</h2>
              <div className="admin-muted">{formatCurrencyAED(listing.display_price ?? listing.price ?? listing.expected_selling_price)}</div>
              <div className="admin-muted">{listing.city || listing.car_city || listing.location || 'UAE'}</div>
            </div>
            <div className="admin-actions">
              <span className="admin-chip">Owner: {getDisplayName(owner)}</span>
              <span className="admin-chip">Created: {formatDateTime(listing.created_at)}</span>
              <span className="admin-chip">Updated: {formatDateTime(listing.updated_at)}</span>
            </div>
          </div>

          <div className="admin-divider" />

          <div className="admin-grid-2">
            <div className="admin-card">
              <div className="admin-label">Listing data</div>
              <p className="admin-muted">Status: {listing.status || 'pending'}</p>
              <p className="admin-muted">Type: {listingTypeLabel}</p>
              <p className="admin-muted">Owner email: {owner.email || listing.user_email || 'Not set'}</p>
              <p className="admin-muted">Owner phone: {owner.phone || owner.whatsapp_number || 'Not set'}</p>
              <p className="admin-muted">VIN: {listing.vin_number || listing.vin || 'Not set'}</p>
              <p className="admin-muted">Mileage: {listing.kilometer_driven || listing.kilometer || listing.mileage ? formatNumber(listing.kilometer_driven || listing.kilometer || listing.mileage) : 'N/A'} km</p>
              <p className="admin-muted">Rejection note: {listing.rejection_note || 'None'}</p>
            </div>
            <div className="admin-card">
              <div className="admin-label">Media</div>
              <p className="admin-muted">Image count: {formatNumber(images.length)}</p>
              <p className="admin-muted">Lead events: {formatNumber(leadEvents.length)}</p>
              <p className="admin-muted">Reports: {formatNumber(reports.length)}</p>
              <p className="admin-muted">Deletion events: {formatNumber(deletionEvents.length)}</p>
              <div className="admin-actions" style={{ marginTop: '12px' }}>
                <button className="admin-button admin-button-primary" type="button" onClick={() => navigate(`/admin/users/${listing.user_id}`)}>
                  Open owner profile
                </button>
                <button className="admin-button admin-button-secondary" type="button" onClick={() => navigate(`/admin/${primaryRouteType}s`)}>
                  Back to {primaryRouteType}s
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="admin-surface">
          <div className="admin-label">Moderation</div>
          <h3>Approve, reject, or remove</h3>
          <div className="admin-field">
            <label htmlFor="moderation-note">Note</label>
            <textarea
              id="moderation-note"
              className="admin-textarea"
              value={moderationNote}
              onChange={(event) => setModerationNote(event.target.value)}
              placeholder="Add an internal note or rejection reason..."
            />
          </div>
          <div className="admin-field" style={{ marginTop: '12px' }}>
            <label htmlFor="delete-reason">Removal reason</label>
            <input
              id="delete-reason"
              className="admin-input"
              value={removeReason}
              onChange={(event) => setRemoveReason(event.target.value)}
              placeholder="Reason for deletion"
            />
          </div>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            {listing.status !== 'approved' ? (
              <button className="admin-button admin-button-primary" type="button" disabled={actionLoading} onClick={() => handleModerationAction('approve')}>
                Approve
              </button>
            ) : null}
            <button className="admin-button" type="button" disabled={actionLoading} onClick={() => handleModerationAction('reject')}>
              Reject
            </button>
            <button className="admin-button admin-button-danger" type="button" disabled={actionLoading} onClick={() => handleModerationAction('delete')}>
              Remove listing
            </button>
          </div>
        </div>
      </div>

      <div className="admin-section">
        <h2>Images</h2>
        <div className="admin-three-up">
          {images.length === 0 ? (
            <div className="admin-card">No images available.</div>
          ) : images.map((image) => (
            <div key={image.id || image.image_url} className="admin-card">
              <img
                src={image.display_url || image.image_url || image.url}
                alt={getListingTitle(listing)}
                style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: '16px' }}
              />
              <p className="admin-muted" style={{ marginTop: '10px' }}>
                Primary: {image.is_primary ? 'Yes' : 'No'} · Uploaded: {formatDateTime(image.uploaded_at)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-columns admin-section">
        <div className="admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Actor</th>
                <th>Lead event</th>
                <th>Action</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {leadEvents.length === 0 ? (
                <tr><td colSpan="4" className="admin-muted">No lead events found.</td></tr>
              ) : leadEvents.slice(0, 15).map((event) => (
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
                <th>Reports</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr><td colSpan="3" className="admin-muted">No reports found.</td></tr>
              ) : reports.slice(0, 15).map((report) => (
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

      <div className="admin-section">
        <h2>Deletion history</h2>
        <div className="admin-table-card">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Deleted by</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {deletionEvents.length === 0 ? (
                <tr><td colSpan="3" className="admin-muted">No deletion history found.</td></tr>
              ) : deletionEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.reason}</td>
                  <td>{event.deleted_by_role}</td>
                  <td>{formatDateTime(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminListingDetail;
