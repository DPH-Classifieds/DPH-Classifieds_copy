import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import { analyticsConfig } from '../utils/analytics';
import { swrGet, swrSet } from '../utils/swrCache';
import '../styles/AdminOps.css';

const CLARITY_DASHBOARD_URL = analyticsConfig.clarityProjectId
  ? `https://clarity.microsoft.com/projects/view/${analyticsConfig.clarityProjectId}/dashboard`
  : 'https://clarity.microsoft.com';
const GA4_DASHBOARD_URL = 'https://analytics.google.com/analytics/web/';

const EMPTY_ARRAY = [];

const clampNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCompact = (value) => new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(clampNumber(value));

const formatDateKey = (date) => date.toISOString().slice(0, 10);

const labelForDay = (date) =>
  date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const LAUNCH_DATE = new Date('2026-05-09T00:00:00');

const getDaysSinceLaunch = () => {
  const now = new Date();
  const diffMs = now.getTime() - LAUNCH_DATE.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

const TIME_RANGES = [
  { key: '24h', label: '24 Hours', days: 1 },
  { key: '7d', label: '7 Days', days: 7 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days', days: 90 },
  { key: 'all', label: 'All Time', days: null },
];

const AdminDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({});
  const [leadMetrics, setLeadMetrics] = useState(null);
  const [history, setHistory] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [reports, setReports] = useState([]);
  const [liveUsers, setLiveUsers] = useState(null);
  const [timeRange, setTimeRange] = useState('30d');

  useEffect(() => {
    const cacheKey = `admin-dashboard:${timeRange}`;
    // 1. Synchronously hydrate from cache so we paint instantly.
    const cached = swrGet(cacheKey);
    if (cached?.value) {
      const {
        stats: cStats,
        leadMetrics: cLeadMetrics,
        history: cHistory,
        dealers: cDealers,
        reports: cReports,
      } = cached.value;
      if (cStats) setStats(cStats);
      if (cLeadMetrics !== undefined) setLeadMetrics(cLeadMetrics);
      if (Array.isArray(cHistory)) setHistory(cHistory);
      if (Array.isArray(cDealers)) setDealers(cDealers);
      if (Array.isArray(cReports)) setReports(cReports);
      setLoading(false);
    }

    let active = true;

    (async () => {
      try {
        setError('');

        const selectedRange = TIME_RANGES.find((r) => r.key === timeRange);
        const daysParam = selectedRange?.days ? `?days=${selectedRange.days}` : '';

        const [statsRes, leadRes, historyRes, dealersRes, reportsRes] = await Promise.all([
          apiClient.get(`/api/admin/stats${daysParam}`).catch(() => ({})),
          apiClient.get(`/api/admin/lead-metrics?days=${selectedRange?.days || 365}`).catch(() => null),
          apiClient.get('/api/admin/listing-history?limit=12').catch(() => []),
          apiClient.get('/api/admin/dealers?pending=true').catch(() => []),
          apiClient.get('/api/admin/reports').catch(() => []),
        ]);

        if (!active) return;

        const merged = {
          stats: statsRes || {},
          leadMetrics: leadRes || null,
          history: Array.isArray(historyRes) ? historyRes : [],
          dealers: Array.isArray(dealersRes) ? dealersRes : [],
          reports: Array.isArray(reportsRes) ? reportsRes : [],
        };
        setStats(merged.stats);
        setLeadMetrics(merged.leadMetrics);
        setHistory(merged.history);
        setDealers(merged.dealers);
        setReports(merged.reports);
        swrSet(cacheKey, merged);
      } catch (loadError) {
        if (!active) return;
        console.error('Failed to load admin dashboard:', loadError);
        // Don't blow away cached values on error — only show error if there was no cache.
        if (!cached?.value) setError(loadError.message || 'Failed to load dashboard');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [timeRange]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    const loadLiveUsers = async () => {
      try {
        const res = await apiClient.request('/api/admin/live-users?window_seconds=300').catch(() => null);
        if (!cancelled) setLiveUsers(res);
      } catch (liveError) {
        if (!cancelled) setLiveUsers(null);
      }
    };

    const start = () => {
      if (!intervalId) intervalId = window.setInterval(loadLiveUsers, 15000);
    };
    const stop = () => {
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        loadLiveUsers();
        start();
      }
    };

    loadLiveUsers();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const totals = leadMetrics?.totals || {};
  const recentEvents = leadMetrics?.recent_events ?? EMPTY_ARRAY;
  const recentReports = leadMetrics?.recent_reports ?? EMPTY_ARRAY;

  const pendingApprovals = useMemo(() => {
    return (
      clampNumber(stats.cars_pending) +
      clampNumber(stats.bikes_pending) +
      clampNumber(stats.parts_pending) +
      clampNumber(stats.plates_pending)
    );
  }, [stats]);

  const totalViews = useMemo(() => {
    return (
      clampNumber(stats.cars_views) +
      clampNumber(stats.bikes_views) +
      clampNumber(stats.parts_views) +
      clampNumber(stats.plates_views)
    );
  }, [stats]);

  const totalUsers = clampNumber(stats.total_users);
  const totalReports = clampNumber(stats.total_reports || reports.length);
  const totalLeads = clampNumber(stats.total_leads || totals.qualified_leads || totals.call_click || 0);
  const totalCalls = clampNumber(stats.total_calls || totals.call_click || 0);
  const totalWhatsapp = clampNumber(stats.total_whatsapp || totals.whatsapp_click || 0);
  const totalDealers = clampNumber(stats.total_dealers || dealers.length);
  const siteVisitors = clampNumber(stats.unique_visitors);
  const dataHealth = stats.data_health || null;
  const platformEventsMissing = dataHealth?.platform_events === 'missing';
  const verifiedDealers = dealers.filter((dealer) => dealer.dealer_verified).length;
  const pendingDealers = dealers.filter((dealer) => !dealer.dealer_verified).length;
  const pendingReports = reports.filter((report) => (report.status || 'pending') === 'pending').length;
  const liveVisitorsCount = clampNumber(liveUsers?.live_visitors);
  const pendingByType = [
    { label: 'Cars', value: clampNumber(stats.cars_pending) },
    { label: 'Bikes', value: clampNumber(stats.bikes_pending) },
    { label: 'Parts', value: clampNumber(stats.parts_pending) },
    { label: 'Plates', value: clampNumber(stats.plates_pending) },
  ];

  const leadMix = [
    { label: 'Calls', value: clampNumber(totals.call_click || totalCalls) },
    { label: 'WhatsApp', value: clampNumber(totals.whatsapp_click || totalWhatsapp) },
    { label: 'VIN Opens', value: clampNumber(totals.vin_open) },
    { label: 'VIN Reveals', value: clampNumber(totals.vin_reveal) },
    { label: 'Reports', value: clampNumber(totals.reports_created || totalReports) },
  ];

  const weeklyActivity = useMemo(() => {
    const days = 7;
    const buckets = [];
    const map = new Map();
    for (let index = days - 1; index >= 0; index -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - index);
      const key = formatDateKey(date);
      map.set(key, {
        key,
        label: labelForDay(date),
        total: 0,
        call_click: 0,
        whatsapp_click: 0,
        vin_open: 0,
      });
    }

    recentEvents.forEach((event) => {
      const date = new Date(event.created_at);
      if (Number.isNaN(date.getTime())) return;
      const key = formatDateKey(date);
      const bucket = map.get(key);
      if (!bucket) return;
      const action = event.action || 'unknown';
      bucket.total += 1;
      if (action in bucket) {
        bucket[action] += 1;
      }
    });

    map.forEach((bucket) => buckets.push(bucket));
    return buckets;
  }, [recentEvents]);

  const chartMax = Math.max(
    1,
    ...leadMix.map((item) => item.value),
    ...weeklyActivity.map((item) => item.total),
    ...pendingByType.map((item) => item.value),
  );

  const topDealerRows = useMemo(() => {
    return dealers.slice(0, 6).map((dealer) => ({
      id: dealer.id,
      name: [dealer.first_name, dealer.last_name].filter(Boolean).join(' ') || dealer.email || 'Dealer',
      company: dealer.company_name || dealer.company_registration_number || 'No company name',
      status: dealer.dealer_verified ? 'Verified' : 'Pending',
      tone: dealer.dealer_verified ? 'success' : 'warning',
    }));
  }, [dealers]);

  const quickLinks = [
    { label: 'Review People', href: '/admin/users', description: 'Search users and drill into account health.' },
    { label: 'Review Listings', href: '/admin/listings', description: 'Inspect listing performance and moderation.' },
    { label: 'Review Dealers', href: '/admin/dealers', description: 'Check verification and dealer health.' },
    { label: 'Open Reports', href: '/admin/reports', description: 'Track reports, removals, and lead history.' },
    { label: 'Open Metrics', href: '/admin/metrics', description: 'Review retention, car demand, and plate analysis.' },
  ];

  if (loading) {
    return (
      <div className="admin-ops admin-page">
        <LoadingSpinner message="Loading operator dashboard..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-ops admin-page">
        <div className="admin-card">
          <h2>Dashboard unavailable</h2>
          <p className="admin-muted">{error}</p>
          <div className="admin-actions" style={{ marginTop: '16px' }}>
            <button className="admin-button admin-button-primary" type="button" onClick={() => window.location.reload()}>
              Retry
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
          <div className="admin-label">Operator console</div>
          <h1 className="admin-page-title">
            Live control center for {user?.display_name || user?.email || 'the marketplace'}
          </h1>
          <p className="admin-page-subtitle">
            Track leads, approvals, dealer verification, reports, removals, and traffic across the marketplace in one working surface.
          </p>
        </div>
        <div className="admin-actions">
          <div className="admin-time-range-selector">
            {TIME_RANGES.map((range) => (
              <button
                key={range.key}
                type="button"
                className={`admin-time-range-btn ${timeRange === range.key ? 'is-active' : ''}`}
                onClick={() => setTimeRange(range.key)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <span className="admin-status-pill tone-success">{formatCompact(totalLeads)} leads</span>
          <span className="admin-status-pill tone-warning">{formatCompact(pendingApprovals)} pending</span>
          <span className="admin-status-pill">{formatCompact(verifiedDealers)}/{formatCompact(totalDealers)} dealers verified</span>
          <Link className="admin-button admin-button-primary" to="/admin/metrics">
            Open Metrics
          </Link>
        </div>
      </div>

      <div className="admin-kpi-grid">
        <div className="admin-kpi-card admin-kpi-card-launch">
          <div className="admin-kpi-label">Days since launch</div>
          <div className="admin-kpi-value">{getDaysSinceLaunch()}</div>
          <div className="admin-kpi-note">Launched 9 May 2026. The journey continues.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total leads</div>
          <div className="admin-kpi-value">{formatCompact(totalLeads)}</div>
          <div className="admin-kpi-note">Call and WhatsApp actions across all listings.</div>
        </div>
        <div
          className="admin-kpi-card"
          title="Unique users who tapped WhatsApp in the selected window. Total raw events: total_whatsapp_events"
        >
          <div className="admin-kpi-label">WhatsApp clicks</div>
          <div className="admin-kpi-value">{formatCompact(totalWhatsapp)}</div>
          <div className="admin-kpi-note">Unique users who tapped WhatsApp in the selected window.</div>
        </div>
        <div
          className="admin-kpi-card"
          title="Unique users who tapped Call in the selected window. Total raw events: total_call_events"
        >
          <div className="admin-kpi-label">Phone clicks</div>
          <div className="admin-kpi-value">{formatCompact(totalCalls)}</div>
          <div className="admin-kpi-note">Unique users who tapped Call in the selected window.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Total views</div>
          <div className="admin-kpi-value">{formatCompact(totalViews)}</div>
          <div className="admin-kpi-note">Detail-page mounts in the selected window.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Site visitors</div>
          <div className="admin-kpi-value">{formatCompact(siteVisitors)}</div>
          <div className="admin-kpi-note">
            {platformEventsMissing
              ? 'Fallback (lead events + signups). Apply the platform_events migration for full tracking.'
              : 'Unique visitors in the selected window.'}
          </div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Pending approvals</div>
          <div className="admin-kpi-value">{formatCompact(pendingApprovals)}</div>
          <div className="admin-kpi-note">Listings waiting in the moderation queue.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Reports</div>
          <div className="admin-kpi-value">{formatCompact(totalReports)}</div>
          <div className="admin-kpi-note">Open and historical reports available to review.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Users</div>
          <div className="admin-kpi-value">{formatCompact(totalUsers)}</div>
          <div className="admin-kpi-note">Active accounts in the platform database.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Live users</div>
          <div className="admin-kpi-value">{formatCompact(liveVisitorsCount)}</div>
          <div className="admin-kpi-note">Distinct visitors active in the last 5 minutes.</div>
        </div>
        <div className="admin-kpi-card">
          <div className="admin-kpi-label">Dealer health</div>
          <div className="admin-kpi-value">{formatCompact(verifiedDealers)}</div>
          <div className="admin-kpi-note">{formatCompact(pendingDealers)} still need verification.</div>
        </div>
      </div>

      <div className="admin-dashboard-grid admin-section">
        <div className="admin-list">
          <div className="admin-surface">
            <div className="admin-chart-title">
              <div>
                <div className="admin-label">Lead mix</div>
                <h2 style={{ margin: '8px 0 0' }}>30 day signal profile</h2>
              </div>
              <span className="admin-status-pill">from lead_events</span>
            </div>
            <div className="admin-chart-bars">
              {leadMix.map((item) => {
                const width = Math.max(6, (item.value / chartMax) * 100);
                return (
                  <div key={item.label} className="admin-chart-row">
                    <div className="admin-muted">{item.label}</div>
                    <div className="admin-chart-track">
                      <div className="admin-chart-fill" style={{ width: `${width}%` }} />
                    </div>
                    <div className="admin-chart-value">{formatCompact(item.value)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="admin-surface">
            <div className="admin-chart-title">
              <div>
                <div className="admin-label">Activity trend</div>
                <h2 style={{ margin: '8px 0 0' }}>Seven day lead volume</h2>
              </div>
              <span className="admin-status-pill tone-success">Recent activity</span>
            </div>
            <div className="admin-chart-bars">
              {weeklyActivity.map((day) => {
                const width = Math.max(6, (day.total / chartMax) * 100);
                return (
                  <div key={day.key} className="admin-chart-row">
                    <div className="admin-muted">{day.label}</div>
                    <div className="admin-chart-track">
                      <div className="admin-chart-fill" style={{ width: `${width}%` }} />
                    </div>
                    <div className="admin-chart-value">{formatCompact(day.total)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="admin-columns">
            <div className="admin-surface">
              <div className="admin-label">Moderation queue</div>
              <h2 style={{ margin: '8px 0 16px' }}>Pending approvals by type</h2>
              <div className="admin-queue-list">
                {pendingByType.map((item) => (
                  <div key={item.label} className="admin-queue-item">
                    <div>
                      <strong>{item.label}</strong>
                      <small>Listings waiting for moderation</small>
                    </div>
                    <span className="admin-status-pill tone-warning">{formatCompact(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="admin-surface">
              <div className="admin-label">Dealers</div>
              <h2 style={{ margin: '8px 0 16px' }}>Verification backlog</h2>
              <div className="admin-queue-list">
                {topDealerRows.length === 0 ? (
                  <div className="admin-empty-state">
                    <h2>No pending dealers</h2>
                    <p>Dealer verification queue is clear.</p>
                  </div>
                ) : (
                  topDealerRows.map((dealerRow) => (
                    <div key={dealerRow.id} className="admin-queue-item">
                      <div>
                        <strong>{dealerRow.name}</strong>
                        <small>{dealerRow.company}</small>
                      </div>
                      <span className={`admin-status-pill tone-${dealerRow.tone}`}>{dealerRow.status}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="admin-list">
          <div className="admin-surface">
            <div className="admin-label">Quick actions</div>
            <h2 style={{ margin: '8px 0 16px' }}>Jump straight to the work</h2>
            <div className="admin-list">
              {quickLinks.map((item) => (
                <button key={item.href} type="button" className="admin-queue-item" onClick={() => navigate(item.href)}>
                  <div style={{ textAlign: 'left' }}>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </div>
                  <span className="admin-status-pill">Open</span>
                </button>
              ))}
            </div>
          </div>

          <div className="admin-surface">
            <div className="admin-label">Reports</div>
            <h2 style={{ margin: '8px 0 16px' }}>Open items and removals</h2>
            <div className="admin-queue-list">
              {recentReports.slice(0, 5).map((report) => (
                <Link key={report.id} to="/admin/reports" className="admin-queue-item" style={{ textDecoration: 'none' }}>
                  <div>
                    <strong>{(report.listing_type || 'listing').toUpperCase()} · {report.reason || 'Report'}</strong>
                    <small>{report.details || report.status || 'Pending review'}</small>
                  </div>
                  <span className="admin-status-pill tone-warning">{report.status || 'pending'}</span>
                </Link>
              ))}
              {recentReports.length === 0 && (
                <div className="admin-empty-state">
                  <h2>No recent reports</h2>
                  <p>Open reports will surface here when they arrive.</p>
                </div>
              )}
            </div>
          </div>

          <div className="admin-surface">
            <div className="admin-label">Removal history</div>
            <h2 style={{ margin: '8px 0 16px' }}>Latest listing actions</h2>
            <div className="admin-queue-list">
              {history.slice(0, 6).map((entry) => (
                <div key={entry.id} className="admin-queue-item">
                  <div>
                    <strong>{(entry.listing_type || 'listing').toUpperCase()} · {entry.deleted_by_role || 'admin'}</strong>
                    <small>{entry.reason || 'Removed with no reason recorded'}</small>
                  </div>
                  <span className="admin-status-pill tone-danger">Removed</span>
                </div>
              ))}
              {history.length === 0 && (
                <div className="admin-empty-state">
                  <h2>No removal history</h2>
                  <p>Listing deletion events will appear here.</p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      <div className="admin-columns admin-section">
        <div className="admin-table-card">
          <div style={{ padding: '20px 20px 0' }}>
            <div className="admin-label">Inventory signal</div>
            <h2 style={{ margin: '8px 0 16px' }}>Pending listings and queue health</h2>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Count</th>
                <th>Context</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Pending approvals</td>
                <td>{formatCompact(pendingApprovals)}</td>
                <td>Listings waiting for review.</td>
              </tr>
              <tr>
                <td>Open reports</td>
                <td>{formatCompact(pendingReports)}</td>
                <td>Reports not yet closed.</td>
              </tr>
              <tr>
                <td>Lead actions</td>
                <td>{formatCompact(totalLeads)}</td>
                <td>Calls and WhatsApp clicks.</td>
              </tr>
              <tr>
                <td>Dealers verified</td>
                <td>{formatCompact(verifiedDealers)}</td>
                <td>Verified dealer accounts.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="admin-table-card">
          <div style={{ padding: '20px 20px 0' }}>
            <div className="admin-label">Direct links</div>
            <h2 style={{ margin: '8px 0 16px' }}>Open the live pages</h2>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Surface</th>
                <th>Route</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>People</td>
                <td>/admin/users</td>
                <td><Link to="/admin/users">Open</Link></td>
              </tr>
              <tr>
                <td>Listings</td>
                <td>/admin/listings</td>
                <td><Link to="/admin/listings">Open</Link></td>
              </tr>
              <tr>
                <td>Dealers</td>
                <td>/admin/dealers</td>
                <td><Link to="/admin/dealers">Open</Link></td>
              </tr>
              <tr>
                <td>Reports</td>
                <td>/admin/reports</td>
                <td><Link to="/admin/reports">Open</Link></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="admin-card" style={{ marginTop: 24 }}>
          <h3>External Analytics</h3>
          <p className="admin-muted" style={{ marginTop: -4 }}>
            Hosted dashboards for traffic, conversions, heatmaps and session
            recordings. See <code>docs/ANALYTICS_SETUP.md</code> to provision
            the keys.
          </p>
          <div className="admin-actions" style={{ marginTop: 12, gap: 12, flexWrap: 'wrap' }}>
            {analyticsConfig.ga4Enabled ? (
              <a
                className="admin-button admin-button-primary"
                href={GA4_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open GA4 Dashboard ↗
              </a>
            ) : (
              <button
                className="admin-button"
                type="button"
                disabled
                title="Set REACT_APP_GA4_MEASUREMENT_ID in frontend/.env"
              >
                GA4 — add REACT_APP_GA4_MEASUREMENT_ID
              </button>
            )}
            {analyticsConfig.clarityEnabled ? (
              <a
                className="admin-button"
                href={CLARITY_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Clarity Dashboard ↗
              </a>
            ) : (
              <button
                className="admin-button"
                type="button"
                disabled
                title="Set REACT_APP_CLARITY_PROJECT_ID in frontend/.env"
              >
                Clarity — add REACT_APP_CLARITY_PROJECT_ID
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
