import React, { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import '../styles/AdminDashboard.css';

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
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <div className="header-content">
          <h1>Reports & Lead Intelligence</h1>
          <p>Track lead events, report conversion, and listing removal history.</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-content">
            <div className="stat-count">{totals.qualified_leads || 0}</div>
            <div className="stat-title">Qualified Leads (30d)</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-content">
            <div className="stat-count">{totals.call_click || 0}</div>
            <div className="stat-title">Call Clicks</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-content">
            <div className="stat-count">{totals.whatsapp_click || 0}</div>
            <div className="stat-title">WhatsApp Clicks</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-content">
            <div className="stat-count">{totals.vin_open || 0}</div>
            <div className="stat-title">VIN Opens</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-content">
            <div className="stat-count">{totals.reports_created || reports.length}</div>
            <div className="stat-title">Reports Created</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-content">
            <div className="stat-count">{totals.report_conversion_percent || 0}%</div>
            <div className="stat-title">Report Conversion</div>
          </div>
        </div>
      </div>

      <div className="quick-actions-section">
        <h2>Recent User Reports</h2>
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

      <div className="recent-activity-section">
        <h2>Listing Removal History</h2>
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
  );
};

export default AdminReports;
