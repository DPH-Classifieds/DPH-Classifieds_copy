import React, { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminOps.css';

const AdminReports = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reports, setReports] = useState([]);
  const [leadMetrics, setLeadMetrics] = useState(null);
  const [history, setHistory] = useState([]);

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
