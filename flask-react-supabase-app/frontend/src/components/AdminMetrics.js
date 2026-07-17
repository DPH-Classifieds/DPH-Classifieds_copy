import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Users,
  ShoppingBag,
  Layers,
  Activity,
  Heart,
  Database,
  Cpu,
  Zap,
  Globe,
  CheckCircle,
  AlertCircle,
  XCircle,
  ChevronLeft,
} from 'lucide-react';
import apiClient from '../utils/apiClient';
import { formatNumber } from './admin/adminUtils';
import {
  GlassCard,
  KpiTile,
  TrendChart,
  EmptyState,
  SegmentedControl,
} from './ui/dashboard';

// ─── local format helpers (preserved from original) ─────────────────────────

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

const formatBytes = (value) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

// ─── shared primitives ───────────────────────────────────────────────────────

/** Underline-tab bar */
const TabBar = ({ tabs, active, onChange }) => (
  <div className="flex gap-1 border-b border-white/[0.06] mb-6">
    {tabs.map((t) => (
      <button
        key={t}
        type="button"
        onClick={() => onChange(t)}
        className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
          active === t ? 'text-white' : 'text-white/40 hover:text-white/70'
        }`}
      >
        {t}
        {active === t && (
          <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-emerald-400 rounded-full" />
        )}
      </button>
    ))}
  </div>
);

/** Section title */
const SectionTitle = ({ children }) => (
  <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium mb-3">
    {children}
  </p>
);

/** Health status pill */
const HealthPill = ({ status }) => {
  const s = String(status || 'unknown').toLowerCase();
  const ok = s === 'ok' || s === 'healthy' || s === 'up';
  const degraded = s === 'degraded' || s === 'warning';
  const down = s === 'down' || s === 'error' || s === 'critical';

  if (ok)      return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full"><CheckCircle size={10} /> Healthy</span>;
  if (degraded) return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full"><AlertCircle size={10} /> Degraded</span>;
  if (down)    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full"><XCircle size={10} /> Down</span>;
  return <span className="text-[11px] text-white/30 px-2 py-0.5 rounded-full border border-white/10">Unknown</span>;
};

/** Generic key-value row list inside a GlassCard section */
const KvList = ({ items, emptyLabel = 'No data' }) => {
  if (!items || items.length === 0) {
    return <p className="text-sm text-white/30">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-2">
      {items.map(({ label, value, note }) => (
        <div key={label} className="flex items-start justify-between gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
          <div>
            <p className="text-sm text-white/70">{label}</p>
            {note && <p className="text-[11px] text-white/30">{note}</p>}
          </div>
          <p className="text-sm font-semibold text-white tabular-nums flex-shrink-0">{value}</p>
        </div>
      ))}
    </div>
  );
};

/** Horizontal bar chart row */
const BarRow = ({ label, value, maxValue }) => {
  const pct = maxValue > 0 ? Math.max(4, (value / maxValue) * 100) : 4;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <p className="text-sm text-white/60 w-32 flex-shrink-0 truncate">{label}</p>
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-500/60 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-sm font-semibold tabular-nums text-white/70 w-16 text-right flex-shrink-0">
        {formatNumber(value)}
      </p>
    </div>
  );
};

// ─── main component ──────────────────────────────────────────────────────────

const TABS = ['Engagement', 'Acquisition', 'Conversion', 'Health', 'Email', 'Errors'];
const WINDOW_OPTIONS = [
  { label: '24h', value: 1  },
  { label: '7d',  value: 7  },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '365d',value: 365},
];

const AdminMetrics = () => {
  // ── state ──────────────────────────────────────────────────────────────
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [days, setDays]         = useState(30);
  const [metrics, setMetrics]   = useState(null);
  const [health, setHealth]     = useState(null);
  const [emailMetrics, setEmailMetrics] = useState(null);
  const [errorMetrics, setErrorMetrics] = useState(null);
  const [activeTab, setActiveTab] = useState('Engagement');

  // ── API: metrics overview (re-fetches on window change) ─────────────────
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
        if (active) setLoading(false);
      }
    };

    fetchMetrics();
    return () => { active = false; };
  }, [days]);

  // ── API: email metrics (re-fetches on window change) ──────────────────────
  useEffect(() => {
    let active = true;
    const fetchEmail = async () => {
      try {
        const response = await apiClient.get(`/api/admin/metrics/email?days=${days}`);
        if (!active) return;
        setEmailMetrics(response || null);
      } catch (e) {
        if (!active) return;
        setEmailMetrics({ error: e.message || 'Failed to load email metrics' });
      }
    };
    fetchEmail();
    return () => { active = false; };
  }, [days]);

  // ── API: error events (re-fetches on window change) ───────────────────────
  useEffect(() => {
    let active = true;
    const fetchErrors = async () => {
      try {
        const response = await apiClient.get(`/api/admin/metrics/errors?days=${days}`);
        if (!active) return;
        setErrorMetrics(response || null);
      } catch (e) {
        if (!active) return;
        setErrorMetrics({ error: e.message || 'Failed to load errors' });
      }
    };
    fetchErrors();
    return () => { active = false; };
  }, [days]);

  // ── API: health (once on mount) ─────────────────────────────────────────
  useEffect(() => {
    let active = true;

    const fetchHealth = async () => {
      try {
        const response = await apiClient.get('/api/admin/health');
        if (!active) return;
        setHealth(response || null);
      } catch (fetchError) {
        if (!active) return;
        console.error('Failed to load health status:', fetchError);
        setHealth({ error: fetchError.message || 'Failed to load health status' });
      }
    };

    fetchHealth();
    return () => { active = false; };
  }, []);

  // ── derived values ──────────────────────────────────────────────────────
  const userMetrics      = metrics?.user_metrics      || {};
  const financialMetrics = metrics?.financial_metrics || {};
  const carMetrics       = metrics?.car_metrics       || {};
  const plateMetrics     = metrics?.plate_metrics     || {};

  const healthCurrent   = health?.current  || null;
  const healthLatest    = health?.latest   || null;
  const healthSnapshot  = healthCurrent || healthLatest || null;
  const healthComponents = healthSnapshot?.details || {};

  const healthLabel = (component) => {
    if (!component) return 'unknown';
    return component.ok ? 'ok' : (component.status || 'degraded');
  };

  const repeatRate = userMetrics.repeat_purchase_rate_percent ?? userMetrics.repeat_visit_rate_percent ?? 0;
  const topPages      = userMetrics.top_pages      || [];
  const trafficSources = userMetrics.traffic_sources || [];
  const platformBreakdown = userMetrics.platform_breakdown || [];
  const dailyTrends   = userMetrics.daily_trends   || [];

  // Build TrendChart series for engagement daily
  const engagementSeries = dailyTrends.length > 1
    ? [
        {
          label: 'Sessions',
          color: '#10b981',
          data: dailyTrends.map((d) => ({ date: d.date, value: d.sessions || 0 })),
        },
        {
          label: 'Conversions',
          color: '#6366f1',
          data: dailyTrends.map((d) => ({ date: d.date, value: d.conversions || d.conversion_sessions || 0 })),
        },
      ]
    : [];

  // ── avg time on site formatter ──────────────────────────────────────────
  const fmtDuration = (seconds) => {
    const s = Number(seconds ?? 0);
    if (!s) return '0m';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // ── loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="animate-pulse bg-white/[0.06] rounded-lg h-9 w-56" />
          <div className="animate-pulse bg-white/[0.06] rounded-full h-8 w-36" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <KpiTile key={i} label="" value={0} loading />
          ))}
        </div>
      </div>
    );
  }

  // ── error state ─────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-6">
        <GlassCard className="text-center py-16">
          <p className="text-white text-lg font-medium mb-2">Metrics unavailable</p>
          <p className="text-white/50 text-sm mb-6">{error}</p>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm hover:bg-white/15 transition-colors"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </GlassCard>
      </div>
    );
  }

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between gap-4 flex-wrap"
      >
        <div>
          <h1 className="text-3xl font-semibold text-white">Platform metrics</h1>
          <p className="text-sm text-white/40 mt-1">
            Analytics, unit economics, demand intelligence and system health.
          </p>
        </div>
        <SegmentedControl options={WINDOW_OPTIONS} value={days} onChange={setDays} />
      </motion.div>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }}>
        <GlassCard>
          <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />

          {/* ── ENGAGEMENT tab ────────────────────────────────────────── */}
          {activeTab === 'Engagement' && (
            <div className="space-y-6">
              <div>
                <SectionTitle>User engagement</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    {
                      label: 'Repeat return rate',
                      value: Number(repeatRate),
                      icon: Heart,
                      suffix: '%',
                      accent: 'default',
                    },
                    {
                      label: 'Avg time on site',
                      value: fmtDuration(userMetrics.avg_time_on_site_seconds),
                      icon: Activity,
                    },
                    {
                      label: 'Pages per session',
                      value: formatDecimal(userMetrics.avg_pages_per_session || 0),
                      icon: Layers,
                    },
                    {
                      label: 'Conversion rate',
                      value: Number(userMetrics.conversion_rate_percent || 0),
                      icon: TrendingUp,
                      suffix: '%',
                      accent: 'emerald',
                    },
                  ].map(({ label, value, icon, suffix, accent }, i) => (
                    <motion.div
                      key={label}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <KpiTile label={label} value={typeof value === 'number' ? value : value} icon={icon} suffix={suffix} accent={accent} />
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Activity trend chart */}
              <div>
                <SectionTitle>Daily activity trend</SectionTitle>
                <TrendChart
                  series={engagementSeries}
                  height={220}
                  showLegend
                  emptyLabel="No daily trend data for this window"
                />
              </div>

              {/* Cohort retention + traffic sources */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <SectionTitle>Cohort retention</SectionTitle>
                  <KvList
                    items={[
                      { label: 'Day 1', value: formatPercent(userMetrics.cohort_retention?.day_1 || 0) },
                      { label: 'Day 7', value: formatPercent(userMetrics.cohort_retention?.day_7 || 0) },
                      { label: 'Day 30', value: formatPercent(userMetrics.cohort_retention?.day_30 || 0) },
                    ]}
                    emptyLabel="No cohort data yet"
                  />
                </div>
                <div>
                  <SectionTitle>Traffic sources</SectionTitle>
                  {trafficSources.length === 0 ? (
                    <EmptyState icon={Globe} title="No source data" description="Traffic attribution will appear here." />
                  ) : (
                    <div className="space-y-1">
                      {trafficSources.map((src) => (
                        <BarRow
                          key={src.source}
                          label={src.source}
                          value={src.sessions || 0}
                          maxValue={Math.max(1, ...trafficSources.map((s) => s.sessions || 0))}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Platform: web vs mobile app */}
              <div>
                <SectionTitle>Platform · web vs mobile app</SectionTitle>
                {platformBreakdown.length === 0 ? (
                  <EmptyState icon={Globe} title="No platform data" description="Web vs mobile split appears here as traffic comes in." />
                ) : (
                  <div className="space-y-1">
                    {platformBreakdown.map((p) => (
                      <BarRow
                        key={p.platform}
                        label={p.platform === 'mobile'
                          ? `Mobile app${p.app_opens ? ` · ${(p.app_opens).toLocaleString()} opens` : ''}`
                          : (p.platform === 'web' ? 'Web' : p.platform)}
                        value={p.visitors || 0}
                        maxValue={Math.max(1, ...platformBreakdown.map((x) => x.visitors || 0))}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Top pages */}
              {topPages.length > 0 && (
                <div>
                  <SectionTitle>Top pages</SectionTitle>
                  <div className="space-y-1">
                    {topPages.slice(0, 8).map((pg) => (
                      <BarRow
                        key={pg.page_path}
                        label={pg.page_path}
                        value={pg.views || 0}
                        maxValue={Math.max(1, ...topPages.map((p) => p.views || 0))}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── ACQUISITION tab ───────────────────────────────────────── */}
          {activeTab === 'Acquisition' && (
            <div className="space-y-6">
              <SectionTitle>Unit economics</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    label: 'GMV',
                    value: formatMoney(financialMetrics.gross_merchandise_value),
                    icon: DollarSign,
                    accent: 'emerald',
                  },
                  {
                    label: 'Avg listing price',
                    value: formatMoney(financialMetrics.average_listing_price),
                    icon: ShoppingBag,
                  },
                  {
                    label: 'New users',
                    value: Number(financialMetrics.new_users || 0),
                    icon: Users,
                  },
                  {
                    label: 'Unique sellers',
                    value: Number(financialMetrics.unique_sellers || 0),
                    icon: Users,
                  },
                  {
                    label: 'Listings / seller',
                    value: formatDecimal(financialMetrics.listings_per_seller_avg || 0),
                    icon: Layers,
                  },
                  {
                    label: 'LTV / CAC ratio',
                    value: financialMetrics.ltv_cac_ratio == null ? 'N/A' : formatDecimal(financialMetrics.ltv_cac_ratio),
                    icon: TrendingUp,
                    accent: 'emerald',
                  },
                ].map(({ label, value, icon, accent }, i) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <KpiTile label={label} value={value} icon={icon} accent={accent} />
                  </motion.div>
                ))}
              </div>

              {financialMetrics.notes?.[0] && (
                <p className="text-sm text-white/30 italic">{financialMetrics.notes[0]}</p>
              )}

              {/* LTV / CAC detail */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <SectionTitle>Lifetime value detail</SectionTitle>
                  <KvList
                    items={[
                      { label: 'Estimated LTV', value: formatMoney(financialMetrics.estimated_ltv), note: 'Value pool per visitor proxy' },
                      { label: 'Estimated CAC', value: financialMetrics.estimated_cac == null ? 'N/A' : formatMoney(financialMetrics.estimated_cac), note: financialMetrics.estimated_cac == null ? 'Add spend data to compute CAC' : 'Spend ÷ new users' },
                    ]}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <SectionTitle>Platform totals</SectionTitle>
                    {userMetrics.data_source === 'cloudflare' ? (() => {
                      const uvSrc = userMetrics.unique_visitors_source;
                      const isExact = uvSrc === 'cf_rest';
                      const isEstimate = uvSrc === 'cf_graphql_estimate';
                      const badgeClass = isExact
                        ? 'border-orange-400/30 bg-orange-400/10 text-orange-200'
                        : isEstimate
                          ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                          : 'border-orange-500/30 bg-orange-500/10 text-orange-300';
                      const badgeLabel = isExact ? 'Cloudflare (exact)' : isEstimate ? 'Cloudflare (estimated)' : 'Cloudflare';
                      const badgeTip = isExact
                        ? 'Visitor counts are exact — sourced from the Cloudflare REST Zone Analytics endpoint, same as dash.cloudflare.com.'
                        : isEstimate
                          ? 'Unique visitors are estimated from per-day GraphQL uniques using a linear-decay heuristic (may be ~10–20% off). Add CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY to Railway for the exact number from the CF dashboard.'
                          : 'Visitor counts come from Cloudflare edge analytics. Bounce rate and conversion sessions still come from platform_events.';
                      return (
                        <span className={`text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border ${badgeClass}`} title={badgeTip}>
                          Source: {badgeLabel}
                        </span>
                      );
                    })() : (
                      <span
                        className="text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-white/[0.06] text-white/40 border border-white/10"
                        title={userMetrics.data_source_note || 'Numbers from the in-app platform_events tracker. Set CLOUDFLARE_API_TOKEN plus CLOUDFLARE_ZONE_IDS on the backend to switch to Cloudflare edge data.'}
                      >
                        Source: in-app tracker
                      </span>
                    )}
                  </div>
                  <KvList
                    items={[
                      { label: 'Sessions', value: formatNumber(userMetrics.sessions), note: userMetrics.unique_visitors_source === 'cf_rest' ? 'Exact window-deduped unique visitors (Cloudflare REST)' : userMetrics.unique_visitors_source === 'cf_graphql_estimate' ? 'Estimated unique visitors — add CF Global API Key for exact match' : 'Unique visitor sessions in the window' },
                      { label: 'Page views', value: formatNumber(userMetrics.page_views), note: 'Sitewide page loads at the edge' },
                      { label: 'Bounce rate', value: formatPercent(userMetrics.bounce_rate_percent), note: 'From in-app tracker (CF can’t see this)' },
                      { label: 'Conversion sessions', value: formatNumber(userMetrics.conversion_sessions), note: 'From in-app tracker (lead/form intent)' },
                      ...(userMetrics.data_source === 'cloudflare' ? [
                        { label: 'Edge requests', value: formatNumber(userMetrics.edge_requests), note: 'Total HTTP requests at the edge (incl. bots/assets)' },
                        { label: 'Threats blocked', value: formatNumber(userMetrics.edge_threats), note: 'Bots / WAF rules / DDoS' },
                        { label: 'Cached requests', value: formatNumber(userMetrics.edge_cached_requests), note: 'Served from Cloudflare cache (no origin hit)' },
                        { label: 'Bandwidth', value: formatBytes(userMetrics.edge_bytes), note: 'Total bytes Cloudflare delivered for this window' },
                        { label: 'Peak daily uniques', value: formatNumber(userMetrics.peak_daily_uniques), note: 'Highest single-day uniques in the window' },
                      ] : []),
                    ]}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── CONVERSION tab ────────────────────────────────────────── */}
          {activeTab === 'Conversion' && (
            <div className="space-y-6">
              <SectionTitle>Car demand</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Segment views */}
                <div>
                  <p className="text-sm text-white/40 mb-3">
                    Segment views
                    <span className="ml-2 text-[11px] text-white/20">{carMetrics.total_listings || 0} listings</span>
                  </p>
                  {(carMetrics.segment_views || []).length === 0 ? (
                    <EmptyState icon={BarChart3} title="No segment data" description="Car segment analytics will appear here." />
                  ) : (
                    <div className="space-y-1">
                      {(carMetrics.segment_views || []).map((item) => (
                        <BarRow
                          key={item.segment}
                          label={item.segment}
                          value={item.views || 0}
                          maxValue={Math.max(1, ...(carMetrics.segment_views || []).map((s) => s.views || 0))}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Price distribution */}
                <div>
                  <p className="text-sm text-white/40 mb-3">Price distribution</p>
                  {(carMetrics.price_bands || []).length === 0 ? (
                    <EmptyState icon={BarChart3} title="No price band data" description="Price distribution will appear here." />
                  ) : (
                    <div className="space-y-1">
                      {(carMetrics.price_bands || []).map((item) => (
                        <BarRow
                          key={item.band}
                          label={item.band}
                          value={item.count || 0}
                          maxValue={Math.max(1, ...(carMetrics.price_bands || []).map((b) => b.count || 0))}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Top car listings */}
              {(carMetrics.top_listings || []).length > 0 && (
                <div>
                  <SectionTitle>Top car listings</SectionTitle>
                  <KvList
                    items={(carMetrics.top_listings || []).slice(0, 5).map((item) => ({
                      label: item.title,
                      value: `${formatNumber(item.views)} views`,
                      note: item.price ? formatMoney(item.price) : '',
                    }))}
                  />
                </div>
              )}

              <div className="border-t border-white/[0.06] pt-6">
                <SectionTitle>Plate demand</SectionTitle>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Plate segment views */}
                  <div>
                    <p className="text-sm text-white/40 mb-3">
                      Demand by segment
                      <span className="ml-2 text-[11px] text-white/20">{plateMetrics.total_listings || 0} listings</span>
                    </p>
                    {(plateMetrics.segment_views || []).length === 0 ? (
                      <EmptyState icon={BarChart3} title="No plate segment data" description="Plate analytics will appear here." />
                    ) : (
                      <div className="space-y-1">
                        {(plateMetrics.segment_views || []).map((item) => (
                          <BarRow
                            key={item.segment}
                            label={item.segment}
                            value={item.views || 0}
                            maxValue={Math.max(1, ...(plateMetrics.segment_views || []).map((s) => s.views || 0))}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Plate price bands */}
                  <div>
                    <p className="text-sm text-white/40 mb-3">Price distribution</p>
                    {(plateMetrics.price_bands || []).length === 0 ? (
                      <EmptyState icon={BarChart3} title="No plate price data" description="Plate price bands will appear here." />
                    ) : (
                      <div className="space-y-1">
                        {(plateMetrics.price_bands || []).map((item) => (
                          <BarRow
                            key={item.band}
                            label={item.band}
                            value={item.count || 0}
                            maxValue={Math.max(1, ...(plateMetrics.price_bands || []).map((b) => b.count || 0))}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Top plate listings */}
                {(plateMetrics.top_listings || []).length > 0 && (
                  <div className="mt-4">
                    <SectionTitle>Top plate listings</SectionTitle>
                    <KvList
                      items={(plateMetrics.top_listings || []).slice(0, 5).map((item) => ({
                        label: item.title,
                        value: `${formatNumber(item.views)} views`,
                        note: item.price ? formatMoney(item.price) : '',
                      }))}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── HEALTH tab ────────────────────────────────────────────── */}
          {activeTab === 'Health' && (
            <div className="space-y-6">
              {health?.error && (
                <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-rose-300 text-sm">
                  Health check unavailable — {health.error}
                </div>
              )}

              {/* Overall status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {[
                  { label: 'Overall',  status: healthSnapshot?.overall_status || 'unknown', icon: Activity,  note: healthSnapshot?.checked_at ? `Checked ${new Date(healthSnapshot.checked_at).toLocaleTimeString()}` : 'No snapshot yet' },
                  { label: 'Frontend', status: healthLabel(healthComponents.frontend),       icon: Globe,     note: healthComponents.frontend?.message || 'Waiting for snapshot' },
                  { label: 'Backend',  status: healthLabel(healthComponents.backend),        icon: Cpu,       note: healthComponents.backend?.message  || 'Waiting for snapshot' },
                  { label: 'Redis',    status: healthLabel(healthComponents.redis),          icon: Zap,       note: healthComponents.redis?.message    || 'Waiting for snapshot' },
                  { label: 'Worker',   status: healthLabel(healthComponents.worker),         icon: Database,  note: healthComponents.worker?.last_seen_at ? `Last seen ${new Date(healthComponents.worker.last_seen_at).toLocaleTimeString()}` : 'Waiting for snapshot' },
                ].map(({ label, status, icon: Icon, note }, i) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <GlassCard>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-white/40 font-medium">{label}</p>
                        <Icon size={14} className="text-white/30" />
                      </div>
                      <div className="mb-2">
                        <HealthPill status={status} />
                      </div>
                      {note && <p className="text-[11px] text-white/30 mt-1">{note}</p>}
                    </GlassCard>
                  </motion.div>
                ))}
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <SectionTitle>Latest snapshot</SectionTitle>
                  <KvList
                    items={[
                      { label: 'Status',      value: healthSnapshot?.overall_status  || 'unknown' },
                      { label: 'Checked at',  value: healthSnapshot?.checked_at ? new Date(healthSnapshot.checked_at).toLocaleString() : 'Not yet checked' },
                      { label: 'Source',      value: healthSnapshot?.source || 'worker' },
                    ]}
                    emptyLabel="No health snapshot available"
                  />
                </div>
                <div>
                  <SectionTitle>Component notes</SectionTitle>
                  <KvList
                    items={[
                      { label: 'Frontend', value: healthComponents.frontend?.status || 'unknown', note: healthComponents.frontend?.checked_url || '' },
                      { label: 'Backend',  value: healthComponents.backend?.status  || 'unknown', note: healthComponents.backend?.checked_url  || '' },
                      { label: 'Redis',    value: healthComponents.redis?.status    || 'unknown', note: healthComponents.redis?.message        || '' },
                      { label: 'Worker',   value: healthComponents.worker?.status   || 'unknown', note: healthComponents.worker?.last_seen_at  || '' },
                    ]}
                  />
                </div>
              </div>
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* ── EMAIL tab ─────────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
        <GlassCard>
          {activeTab === 'Email' && (() => {
            const em = emailMetrics || {};
            const summary = em.summary || {};
            const byType  = em.by_type || [];
            const daily   = em.daily   || [];

            if (em.error) return (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-rose-300 text-sm">
                Email metrics unavailable — run the reminder system migration first.
              </div>
            );

            return (
              <div className="space-y-6">
                {/* ── Summary cards ── */}
                <SectionTitle>Email overview — last {days} day{days !== 1 ? 's' : ''}</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  {[
                    { label: 'Sent',          value: summary.total_sent    ?? '—' },
                    { label: 'Delivered',      value: summary.delivered     ?? '—' },
                    { label: 'Opened',         value: summary.opened        ?? '—' },
                    { label: 'Clicked',        value: summary.clicked       ?? '—' },
                    { label: 'Open rate',      value: summary.open_rate     != null ? `${summary.open_rate}%` : '—' },
                    { label: 'Click rate',     value: summary.click_rate    != null ? `${summary.click_rate}%` : '—' },
                    { label: 'Bounce rate',    value: summary.bounce_rate   != null ? `${summary.bounce_rate}%` : '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl bg-white/[0.04] border border-white/10 p-4 text-center">
                      <p className="text-2xl font-bold text-emerald-400 tabular-nums">{value}</p>
                      <p className="text-xs text-white/50 mt-1">{label}</p>
                    </div>
                  ))}
                </div>

                {/* ── Daily trend ── */}
                {daily.length > 0 && (
                  <div>
                    <SectionTitle>Daily sends</SectionTitle>
                    <div className="flex items-end gap-1 h-24">
                      {(() => {
                        const max = Math.max(...daily.map(d => d.count), 1);
                        return daily.slice(-30).map(d => (
                          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                            <div
                              className="w-full bg-emerald-500/60 rounded-sm transition-all group-hover:bg-emerald-400"
                              style={{ height: `${Math.max((d.count / max) * 88, 2)}px` }}
                            />
                            <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-white/70 bg-black/70 px-1 rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                              {d.date}: {d.count}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </div>
                )}

                {/* ── Per-type breakdown ── */}
                {byType.length > 0 && (
                  <div>
                    <SectionTitle>Breakdown by type</SectionTitle>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-white/40 text-xs border-b border-white/10">
                            <th className="text-left py-2 pr-4">Email type</th>
                            <th className="text-right py-2 px-3">Sent</th>
                            <th className="text-right py-2 px-3">Opened</th>
                            <th className="text-right py-2 px-3">Clicked</th>
                            <th className="text-right py-2 px-3">Open %</th>
                            <th className="text-right py-2 pl-3">Click %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byType.map(row => (
                            <tr key={row.type} className="border-b border-white/5 hover:bg-white/[0.03]">
                              <td className="py-2 pr-4 text-white/80 font-mono text-xs">{row.type}</td>
                              <td className="text-right py-2 px-3 text-white tabular-nums">{row.sent}</td>
                              <td className="text-right py-2 px-3 text-emerald-400 tabular-nums">{row.opened}</td>
                              <td className="text-right py-2 px-3 text-emerald-400 tabular-nums">{row.clicked}</td>
                              <td className="text-right py-2 px-3 text-white/60 tabular-nums">{row.open_rate}%</td>
                              <td className="text-right py-2 pl-3 text-white/60 tabular-nums">{row.click_rate}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {byType.length === 0 && (
                  <p className="text-white/40 text-sm text-center py-8">
                    No email data yet for this period. Run the migration then send some emails.
                  </p>
                )}
              </div>
            );
          })()}
          {activeTab === 'Errors' && (() => {
            const errm     = errorMetrics || {};
            const summary  = errm.summary || {};
            const byCtx    = errm.by_context || [];
            const recent   = errm.recent || [];

            if (errm.error) return (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-rose-300 text-sm">
                Errors unavailable — run the app_errors migration first.
              </div>
            );

            return (
              <div className="space-y-6">
                <SectionTitle>Silent errors — last {days} day{days !== 1 ? 's' : ''}</SectionTitle>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total',    value: summary.total    ?? '—' },
                    { label: 'Backend',  value: summary.backend  ?? '—' },
                    { label: 'Frontend', value: summary.frontend ?? '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl bg-white/[0.04] border border-white/10 p-4 text-center">
                      <p className="text-2xl font-bold text-rose-400 tabular-nums">{value}</p>
                      <p className="text-xs text-white/50 mt-1">{label}</p>
                    </div>
                  ))}
                </div>

                {byCtx.length > 0 && (
                  <div>
                    <SectionTitle>By context</SectionTitle>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-white/40 text-xs border-b border-white/10">
                            <th className="text-left py-2 pr-4">Context</th>
                            <th className="text-right py-2 pl-3">Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byCtx.map(row => (
                            <tr key={row.context} className="border-b border-white/5 hover:bg-white/[0.03]">
                              <td className="py-2 pr-4 text-white/80 font-mono text-xs">{row.context}</td>
                              <td className="text-right py-2 pl-3 text-white tabular-nums">{row.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {recent.length > 0 && (
                  <div>
                    <SectionTitle>Recent</SectionTitle>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-white/40 text-xs border-b border-white/10">
                            <th className="text-left py-2 pr-4">When</th>
                            <th className="text-left py-2 px-3">Context</th>
                            <th className="text-left py-2 px-3">Code</th>
                            <th className="text-left py-2 px-3">Source</th>
                            <th className="text-left py-2 pl-3">Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recent.map((row, i) => (
                            <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03] align-top">
                              <td className="py-2 pr-4 text-white/50 tabular-nums whitespace-nowrap">{String(row.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                              <td className="py-2 px-3 text-white/80 font-mono text-xs whitespace-nowrap">{row.context}</td>
                              <td className="py-2 px-3 text-amber-300 font-mono text-xs whitespace-nowrap">{row.error_code || '—'}</td>
                              <td className="py-2 px-3 text-white/60 text-xs">{row.source}</td>
                              <td className="py-2 pl-3 text-white/70 text-xs break-words max-w-md">{row.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {recent.length === 0 && (
                  <p className="text-white/40 text-sm text-center py-8">
                    No errors recorded for this period. 🎉 (Run the app_errors migration if you expected data.)
                  </p>
                )}
              </div>
            );
          })()}
          {activeTab !== 'Email' && activeTab !== 'Errors' && null}
        </GlassCard>
      </motion.div>

      {/* ── nav footer ────────────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.24 }}>
        <GlassCard>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-white/70 hover:bg-white/10 transition-colors"
            >
              <ChevronLeft size={12} /> Dashboard
            </Link>
            {[
              { label: 'Users',    href: '/admin/users'    },
              { label: 'Listings', href: '/admin/listings' },
              { label: 'Reports',  href: '/admin/reports'  },
            ].map(({ label, href }) => (
              <Link
                key={href}
                to={href}
                className="inline-flex items-center text-xs font-medium px-4 py-2 rounded-xl bg-white/[0.06] border border-white/10 text-white/70 hover:bg-white/10 transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
        </GlassCard>
      </motion.div>

    </div>
  );
};

export default AdminMetrics;
