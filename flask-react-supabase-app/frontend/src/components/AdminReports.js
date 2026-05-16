import React, { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { getEventActorLabel } from './admin/adminUtils';
import '../styles/AdminOps.css';

const AdminReports = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reports, setReports] = useState([]);
  const [leadMetrics, setLeadMetrics] = useState(null);
  const [history, setHistory] = useState([]);
  const [busyReportId, setBusyReportId] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [reportsRes, leadRes, historyRes] = await Promise.all([
          apiClient.get('/api/admin/reports').catch(() => []),
          apiClient.get('/api/admin/lead-metrics?days=30').catch(() => null),
          apiClient.get('/api/admin/listing-history?limit=100').catch(() => []),
        ]);
        setReports(Array.isArray(reportsRes) ? reportsRes : []);
        setLeadMetrics(leadRes || null);
        setHistory(Array.isArray(historyRes) ? historyRes : []);
      } catch (fetchError) {
        console.error('Failed to fetch admin reports data:', fetchError);
        setError('Failed to load reports dashboard');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const updateReportStatus = async (reportId, nextStatus) => {
    setBusyReportId(reportId);
    try {
      const updated = await apiClient.request(`/api/admin/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: { status: nextStatus },
      });
      setReports((prev) =>
        prev.map((report) => (report.id === reportId ? { ...report, ...updated } : report))
      );
    } catch (statusError) {
      console.error('Failed to update report status:', statusError);
      setError(statusError?.response?.data?.error || 'Failed to update report status');
    } finally {
      setBusyReportId(null);
    }
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <LoadingSpinner />
        <p>Loading reports and lead analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  const totals = leadMetrics?.totals || {
    call_click: 0,
    whatsapp_click: 0,
    vin_open: 0,
    qualified_leads: 0,
    reports_created: reports.length,
    report_conversion_percent: 0,
  };
  const recentEvents = leadMetrics?.recent_events || [];

  return (
    <div className="admin-ops admin-page">
      <div className="admin-page-header">
        <div>
          <div className="admin-label">Reports</div>
          <h1 className="admin-page-title">Lead intelligence and removal history</h1>
          <p className="admin-page-subtitle">Track lead conversions, report volume, and listing deletion history with quick access to the exact records behind the metrics.</p>
        </div>
        <div className="admin-actions">
          <span className="admin-status-pill tone-success">{totals.qualified_leads || 0} leads</span>
          <span className="admin-status-pill tone-warning">{totals.reports_created || reports.length} reports</span>
          <span className="admin-status-pill">{totals.report_conversion_percent || 0}% conversion</span>
        </div>
      </div>

      <div className="admin-kpi-grid">
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Qualified leads</div>
          <div className="admin-kpi-value">{totals.qualified_leads || 0}</div>
          <div className="admin-kpi-note">Calls + WhatsApp clicks for the period.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Call clicks</div>
          <div className="admin-kpi-value">{totals.call_click || 0}</div>
          <div className="admin-kpi-note">Direct phone intent captured in the DB.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">WhatsApp clicks</div>
          <div className="admin-kpi-value">{totals.whatsapp_click || 0}</div>
          <div className="admin-kpi-note">Messaging intent from listings.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">VIN opens</div>
          <div className="admin-kpi-value">{totals.vin_open || 0}</div>
          <div className="admin-kpi-note">Protected data reveal actions.</div>
        </div>
      </div>

      <div className="admin-section">
        <div className="admin-surface">
          <div className="admin-label">Recent lead activity</div>
          <h2 style={{ margin: '8px 0 16px' }}>Who opened what</h2>
          <div className="admin-table-card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Listing</th>
                  <th>Action</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="admin-muted">No lead events found.</td>
                  </tr>
                ) : recentEvents.slice(0, 15).map((event) => (
                  <tr key={event.id}>
                    <td>{getEventActorLabel(event)}</td>
                    <td>{event.listing_type} · {event.listing_id}</td>
                    <td>{event.action}</td>
                    <td>{event.created_at ? new Date(event.created_at).toLocaleString() : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="admin-columns admin-section">
          <div className="admin-surface">
          <div className="admin-label">Recent reports</div>
          <h2 style={{ margin: '8px 0 16px' }}>Open moderation items</h2>
          <div className="listings-grid">
          {reports.slice(0, 20).map((report) => (
              <div key={report.id} className="listing-card">
              <div className="listing-info">
                <h3>{report.listing_type?.toUpperCase()} · {report.reason}</h3>
                <p><strong>Listing:</strong> {report.listing_id}</p>
                <p><strong>Status:</strong> {report.status || 'pending'}</p>
                <p><strong>Details:</strong> {report.details || 'No details'}</p>
                <p><strong>Date:</strong> {report.created_at ? new Date(report.created_at).toLocaleString() : 'N/A'}</p>
                <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    className="admin-button admin-button-secondary"
                    type="button"
                    disabled={busyReportId === report.id || (report.status || 'pending') === 'resolved'}
                    onClick={() => updateReportStatus(report.id, 'resolved')}
                  >
                    {busyReportId === report.id ? 'Updating…' : 'Mark resolved'}
                  </button>
                  <button
                    className="admin-button"
                    type="button"
                    disabled={busyReportId === report.id || (report.status || 'pending') === 'dismissed'}
                    onClick={() => updateReportStatus(report.id, 'dismissed')}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
            ))}
          {reports.length === 0 && <p style={{ color: '#bfc9c4' }}>No reports found.</p>}
          </div>
        </div>
        <div className="admin-surface">
          <div className="admin-label">Removal history</div>
          <h2 style={{ margin: '8px 0 16px' }}>Latest deletions</h2>
          <div className="listings-grid">
          {history.slice(0, 20).map((entry) => (
              <div key={entry.id} className="listing-card">
              <div className="listing-info">
                <h3>{entry.listing_type?.toUpperCase()} · {entry.deleted_by_role}</h3>
                <p><strong>Listing:</strong> {entry.listing_id}</p>
                <p><strong>Reason:</strong> {entry.reason}</p>
                <p><strong>Date:</strong> {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'N/A'}</p>
              </div>
            </div>
            ))}
          {history.length === 0 && <p style={{ color: '#bfc9c4' }}>No deletion history found.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminReports;
