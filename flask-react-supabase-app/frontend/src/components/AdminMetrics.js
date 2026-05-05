import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import LoadingSpinner from './LoadingSpinner';
import {
  formatNumber,
} from './admin/adminUtils';
import '../styles/AdminOps.css';

const WINDOW_OPTIONS = [7, 30, 90];

const formatPercent = (value) => {
  const numeric = Number(value ?? 0);
  return `${Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00'}%`;
};

const formatDecimal = (value, digits = 2) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : `0.${'0'.repeat(digits)}`;
};

const formatMoney = (value) =>
  new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

const Section = ({ label, title, subtitle, children }) => (
  <section className="admin-section">
    <div className="admin-surface admin-metrics-surface">
      <div className="admin-label">{label}</div>
      <h2 className="admin-metrics-title">{title}</h2>
      {subtitle && <p className="admin-page-subtitle">{subtitle}</p>}
      {children}
    </div>
  </section>
);

const StatCard = ({ label, value, note, tone = '' }) => (
  <div className={`admin-kpi-card ${tone ? `tone-${tone}` : ''}`}>
    <div className="admin-kpi-label">{label}</div>
    <div className="admin-kpi-value">{value}</div>
    {note ? <div className="admin-kpi-note">{note}</div> : null}
  </div>
);

const ListBars = ({ items, valueKey = 'views', labelKey = 'segment', emptyLabel = 'No data yet' }) => {
  const maxValue = Math.max(1, ...(items || []).map((item) => Number(item?.[valueKey] || 0)));
  if (!items || items.length === 0) {
    return <p className="admin-muted">{emptyLabel}</p>;
  }

  return (
    <div className="admin-chart-bars">
      {items.map((item) => (
        <div key={`${item[labelKey]}-${item[valueKey]}`} className="admin-chart-row">
          <div className="admin-chart-label">{item[labelKey]}</div>
          <div className="admin-chart-track">
            <div
              className="admin-chart-fill"
              style={{ width: `${Math.max(4, (Number(item[valueKey] || 0) / maxValue) * 100)}%` }}
            />
          </div>
          <div className="admin-chart-value">{formatNumber(item[valueKey])}</div>
        </div>
      ))}
    </div>
  );
};

const KeyValueList = ({ items, emptyLabel = 'No data yet' }) => {
  if (!items || items.length === 0) {
    return <p className="admin-muted">{emptyLabel}</p>;
  }

  return (
    <div className="admin-queue-list">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="admin-queue-item">
          <div>
            <strong>{item.label}</strong>
            {item.note ? <small>{item.note}</small> : null}
          </div>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
};

const AdminMetrics = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    let active = true;

    const fetchMetrics = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await apiClient.get(`/api/admin/metrics/overview?days=${days}`);
        if (!active) return;
        setMetrics(response || null);
      } catch (fetchError) {
        if (!active) return;
        console.error('Failed to load admin metrics:', fetchError);
        setError(fetchError.message || 'Failed to load metrics');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchMetrics();
    return () => {
      active = false;
    };
  }, [days]);

  const userMetrics = metrics?.user_metrics || {};
  const financialMetrics = metrics?.financial_metrics || {};
  const carMetrics = metrics?.car_metrics || {};
  const plateMetrics = metrics?.plate_metrics || {};

  const summaryCards = [
    { label: 'Sessions', value: formatNumber(userMetrics.sessions), note: 'Tracked page journeys in the window.' },
    { label: 'Page views', value: formatNumber(userMetrics.page_views), note: 'Sitewide route views captured by the tracker.' },
    { label: 'Bounce rate', value: formatPercent(userMetrics.bounce_rate_percent), note: 'Single-page / short-lived sessions.' },
    { label: 'Conversions', value: formatNumber(userMetrics.conversion_sessions), note: 'Sessions with lead or form intent.' },
    { label: 'GMV', value: formatMoney(financialMetrics.gross_merchandise_value), note: 'Listing value pool across tracked inventory.' },
    { label: 'Listings / seller', value: formatDecimal(financialMetrics.listings_per_seller_avg), note: 'All tracked listings divided by active sellers.' },
    { label: 'LTV', value: formatMoney(financialMetrics.estimated_ltv), note: 'Value pool per visitor proxy.' },
    {
      label: 'CAC',
      value: financialMetrics.estimated_cac == null ? 'N/A' : formatMoney(financialMetrics.estimated_cac),
      note: financialMetrics.estimated_cac == null ? 'Add spend data to compute CAC.' : 'Spend divided by new users in the window.',
    },
  ];

  const repeatRate = userMetrics.repeat_purchase_rate_percent ?? userMetrics.repeat_visit_rate_percent;
  const topPages = userMetrics.top_pages || [];
  const trafficSources = userMetrics.traffic_sources || [];
  const dailyTrends = userMetrics.daily_trends || [];

  if (loading) {
    return (
      <div className="admin-ops admin-page">
        <LoadingSpinner message="Loading platform metrics..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-ops admin-page">
        <div className="admin-card">
          <h2>Metrics unavailable</h2>
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
    <div className="admin-ops admin-page admin-metrics">
      <div className="admin-page-header">
        <div>
          <div className="admin-label">Metrics</div>
          <h1 className="admin-page-title">Platform analytics and demand intelligence</h1>
          <p className="admin-page-subtitle">
            Real platform event tracking for site behavior, retention, unit economics, car demand, and plate demand.
          </p>
        </div>
        <div className="admin-actions">
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`filter-tab ${days === option ? 'active' : ''}`}
              onClick={() => setDays(option)}
            >
              Last {option} days
            </button>
          ))}
        </div>
      </div>

      <div className="admin-kpi-grid">
        {summaryCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <Section
        label="User Metrics"
        title="User engagement & retention"
        subtitle="Track how often people return, how long they stay, and which pages create repeat engagement."
      >
        <div className="admin-grid-2">
          <div className="admin-chart-card">
            <div className="admin-chart-title">
              <div>
                <strong>Retention & behavior</strong>
                <p className="admin-muted" style={{ margin: '6px 0 0' }}>
                  Repeat rate, bounce rate, time on site, and conversion sessions.
                </p>
              </div>
            </div>
            <div className="admin-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <StatCard label="Repeat purchase / return rate" value={formatPercent(repeatRate)} />
              <StatCard label="Avg time on site" value={`${formatDecimal((userMetrics.avg_time_on_site_seconds || 0) / 3600)}h`} />
              <StatCard label="Pages / session" value={formatDecimal(userMetrics.avg_pages_per_session || 0)} />
              <StatCard label="Conversion rate" value={formatPercent(userMetrics.conversion_rate_percent || 0)} />
            </div>
            <div className="admin-divider" />
            <div className="admin-grid-2">
              <div>
                <h3 style={{ marginTop: 0 }}>Cohort retention</h3>
                <KeyValueList
                  items={[
                    { label: 'Day 1', value: formatPercent(userMetrics.cohort_retention?.day_1 || 0) },
                    { label: 'Day 7', value: formatPercent(userMetrics.cohort_retention?.day_7 || 0) },
                    { label: 'Day 30', value: formatPercent(userMetrics.cohort_retention?.day_30 || 0) },
                  ]}
                />
              </div>
              <div>
                <h3 style={{ marginTop: 0 }}>Traffic sources</h3>
                <KeyValueList
                  items={trafficSources.map((item) => ({
                    label: item.source,
                    value: formatNumber(item.sessions),
                  }))}
                />
              </div>
            </div>
          </div>

          <div className="admin-chart-card">
            <div className="admin-chart-title">
              <div>
                <strong>Daily activity</strong>
                <p className="admin-muted" style={{ margin: '6px 0 0' }}>
                  Session and conversion trend across the selected window.
                </p>
              </div>
            </div>
            <div className="admin-chart-bars">
              {dailyTrends.slice(-12).map((item) => (
                <div key={item.date} className="admin-chart-row">
                  <div className="admin-chart-label">{item.date}</div>
                  <div className="admin-chart-track">
                    <div
                      className="admin-chart-fill"
                      style={{
                        width: `${Math.max(5, ((item.sessions || 0) / Math.max(...dailyTrends.map((row) => row.sessions || 0), 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="admin-chart-value">{formatNumber(item.sessions)}</div>
                </div>
              ))}
            </div>
            <div className="admin-divider" />
            <h3 style={{ marginTop: 0 }}>Top pages</h3>
            <ListBars
              items={topPages.map((item) => ({
                segment: item.page_path,
                views: item.views,
              }))}
              labelKey="segment"
              valueKey="views"
            />
          </div>
        </div>
      </Section>

      <Section
        label="Financial Health"
        title="Unit economics"
        subtitle="Show gross value, CAC, LTV, and the listings per seller ratio in one place."
      >
        <div className="admin-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <StatCard label="GMV" value={formatMoney(financialMetrics.gross_merchandise_value)} />
          <StatCard label="Average price" value={formatMoney(financialMetrics.average_listing_price)} />
          <StatCard label="New users" value={formatNumber(financialMetrics.new_users)} />
          <StatCard label="Unique sellers" value={formatNumber(financialMetrics.unique_sellers)} />
          <StatCard label="Listings / seller" value={formatDecimal(financialMetrics.listings_per_seller_avg || 0)} />
          <StatCard label="LTV / CAC" value={financialMetrics.ltv_cac_ratio == null ? 'N/A' : formatDecimal(financialMetrics.ltv_cac_ratio)} />
        </div>
        <div className="admin-divider" />
        <p className="admin-muted" style={{ marginTop: 0 }}>
          {financialMetrics.notes?.[0] || 'CAC requires spend input. LTV is estimated from the current value pool.'}
        </p>
      </Section>

      <Section
        label="Car Metrics"
        title="Car demand, pricing, and segment views"
        subtitle="See which vehicle segments, price bands, and listing groups are getting attention."
      >
        <div className="admin-grid-2">
          <div className="admin-chart-card">
            <div className="admin-chart-title">
              <strong>Segment views</strong>
              <span className="admin-status-pill">{carMetrics.total_listings || 0} listings</span>
            </div>
            <ListBars items={carMetrics.segment_views || []} labelKey="segment" valueKey="views" />
          </div>
          <div className="admin-chart-card">
            <div className="admin-chart-title">
              <strong>Price distribution</strong>
            </div>
            <ListBars
              items={(carMetrics.price_bands || []).map((item) => ({
                segment: item.band,
                views: item.count,
              }))}
              labelKey="segment"
              valueKey="views"
            />
          </div>
        </div>
        <div className="admin-divider" />
        <div className="admin-grid-2">
          <div>
            <h3 style={{ marginTop: 0 }}>Most viewed car segment</h3>
            <KeyValueList
              items={[
                {
                  label: carMetrics.most_viewed_segment?.segment || 'Unknown',
                  value: formatNumber(carMetrics.most_viewed_segment?.views || 0),
                  note: 'Based on tracked page views.',
                },
              ]}
            />
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Top car listings</h3>
            <KeyValueList
              items={(carMetrics.top_listings || []).slice(0, 5).map((item) => ({
                label: item.title,
                value: `${formatNumber(item.views)} views`,
                note: item.price ? formatMoney(item.price) : '',
              }))}
            />
          </div>
        </div>
      </Section>

      <Section
        label="Plate Analysis"
        title="Plate price and demand intelligence"
        subtitle="Track what plate types, cities, and formats are most in demand."
      >
        <div className="admin-grid-2">
          <div className="admin-chart-card">
            <div className="admin-chart-title">
              <strong>Demand by plate segment</strong>
              <span className="admin-status-pill">{plateMetrics.total_listings || 0} listings</span>
            </div>
            <ListBars items={plateMetrics.segment_views || []} labelKey="segment" valueKey="views" />
          </div>
          <div className="admin-chart-card">
            <div className="admin-chart-title">
              <strong>Plate price distribution</strong>
            </div>
            <ListBars
              items={(plateMetrics.price_bands || []).map((item) => ({
                segment: item.band,
                views: item.count,
              }))}
              labelKey="segment"
              valueKey="views"
            />
          </div>
        </div>
        <div className="admin-divider" />
        <div className="admin-grid-2">
          <div>
            <h3 style={{ marginTop: 0 }}>Most in demand</h3>
            <KeyValueList
              items={[
                {
                  label: plateMetrics.most_in_demand?.segment || 'Unknown',
                  value: formatNumber(plateMetrics.most_in_demand?.views || 0),
                  note: 'Based on tracked plate page views.',
                },
              ]}
            />
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Top plate listings</h3>
            <KeyValueList
              items={(plateMetrics.top_listings || []).slice(0, 5).map((item) => ({
                label: item.title,
                value: `${formatNumber(item.views)} views`,
                note: item.price ? formatMoney(item.price) : '',
              }))}
            />
          </div>
        </div>
      </Section>

      <div className="admin-section">
        <div className="admin-surface">
          <div className="admin-label">Navigation</div>
          <div className="admin-actions" style={{ marginTop: '14px' }}>
            <Link className="admin-button admin-button-secondary" to="/admin">
              Back to dashboard
            </Link>
            <Link className="admin-button admin-button-secondary" to="/admin/users">
              Users
            </Link>
            <Link className="admin-button admin-button-secondary" to="/admin/listings">
              Listings
            </Link>
            <Link className="admin-button admin-button-secondary" to="/admin/reports">
              Reports
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminMetrics;
