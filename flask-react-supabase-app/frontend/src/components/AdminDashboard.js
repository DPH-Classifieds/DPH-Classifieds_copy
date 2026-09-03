import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Users,
  Eye,
  Target,
  Phone,
  MessageSquare,
  Store,
  Activity,
  AlertTriangle,
  Car,
  Bike,
  Wrench,
  Hash,
  ShieldCheck,
  Shield,
  Radio,
  ExternalLink,
  ChevronRight,
  Loader2,
  ImageOff,
  Clock,
  Fingerprint,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import apiClient from '../utils/apiClient';
import { analyticsConfig } from '../utils/analytics';
import { swrGet, swrSet } from '../utils/swrCache';
import {
  GlassCard,
  KpiTile,
  TrendChart,
  EmptyState,
  SegmentedControl,
} from './ui/dashboard';
import { adminListingDetailHref } from './admin/adminUtils';
import VinRevealAnalyticsModal from './admin/VinRevealAnalyticsModal';
import RedditImportAnalyticsPanel from './admin/RedditImportAnalyticsPanel';

// ─── constants ──────────────────────────────────────────────────────────────

const CLARITY_DASHBOARD_URL = analyticsConfig.clarityProjectId
  ? `https://clarity.microsoft.com/projects/view/${analyticsConfig.clarityProjectId}/dashboard`
  : 'https://clarity.microsoft.com';
const GA4_DASHBOARD_URL = 'https://analytics.google.com/analytics/web/';

const EMPTY_ARRAY = [];

const WINDOW_OPTIONS = [
  { label: '24h', value: 1  },
  { label: '7d',  value: 7  },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '365d',value: 365},
];

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Clamp any value to a finite number */
const clampNumber = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Days since a listing was created (for display) */
// eslint-disable-next-line no-unused-vars
const daysFromCreated = (createdAt) => {
  if (!createdAt) return null;
  const diff = Date.now() - new Date(createdAt).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
};

const formatDateKey = (date) => date.toISOString().slice(0, 10);

const LAUNCH_DATE = new Date('2026-05-09T00:00:00');

// Days since launch — kept for potential future use
// eslint-disable-next-line no-unused-vars
const getDaysSinceLaunch = () => {
  const diffMs = Date.now() - LAUNCH_DATE.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

/** Relative-time label (e.g. "2d ago") */
const relTime = (ts) => {
  if (!ts) return '';
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 2) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.round(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.round(diffHrs / 24);
  return `${diffDays}d ago`;
};

// ─── sub-components ──────────────────────────────────────────────────────────

/** Small inline badge */
const Badge = ({ children, color = 'white' }) => {
  const cls = {
    white:   'text-[color:var(--ex-shell-text-muted)] bg-[color:var(--ex-shell-surface-strong)] border-[color:var(--ex-shell-line)]',
    emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    amber:   'text-amber-300 bg-amber-500/10 border-amber-500/20',
    rose:    'text-rose-300 bg-rose-500/10 border-rose-500/20',
    blue:    'text-blue-300 bg-blue-500/10 border-blue-500/20',
  }[color] || 'text-[color:var(--ex-shell-text-muted)] bg-[color:var(--ex-shell-surface-strong)] border-[color:var(--ex-shell-line)]';
  return (
    <span className={`inline-block text-[10px] font-semibold uppercase tracking-[0.10em] px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  );
};

/** Listing-type badge */
const TypeBadge = ({ type }) => {
  const t = String(type || '').toLowerCase();
  if (t === 'car' || t === 'cars')  return <Badge color="blue">Car</Badge>;
  if (t === 'bike' || t === 'bikes') return <Badge color="emerald">Bike</Badge>;
  if (t === 'plate' || t === 'plates') return <Badge color="amber">Plate</Badge>;
  if (t === 'part' || t === 'parts')  return <Badge color="white">Part</Badge>;
  return <Badge>{type || 'Listing'}</Badge>;
};

/** Severity dot for reports */
const SeverityDot = ({ severity }) => {
  const s = Number(severity ?? 0);
  const cls = s >= 0.7 ? 'bg-rose-400' : s >= 0.4 ? 'bg-amber-400' : 'bg-yellow-400';
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />;
};

// ─── main component ──────────────────────────────────────────────────────────

const AdminDashboard = () => {
  useAuth(); // keep context subscription for auth-guard side-effects
  const navigate = useNavigate();

  // UI state
  const [days, setDays] = useState(30);

  // Data state (all preserved from original)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({});
  const [leadMetrics, setLeadMetrics] = useState(null);
  const [contactAnalytics, setContactAnalytics] = useState(null);
  const [redditImport, setRedditImport] = useState(null);
  const [showVinAnalytics, setShowVinAnalytics] = useState(false);
  const [history, setHistory] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [reports, setReports] = useState([]);
  const [liveUsers, setLiveUsers] = useState(null);
  const [liveUsersHistory, setLiveUsersHistory] = useState([]);

  // ── primary data fetch ──────────────────────────────────────────────────
  useEffect(() => {
    const cacheKey = `admin-dashboard:${days}`;

    // 1. Synchronously hydrate from cache so we paint instantly.
    const cached = swrGet(cacheKey);
    if (cached?.value) {
      const {
        stats: cStats,
        leadMetrics: cLeadMetrics,
        redditImport: cRedditImport,
        history: cHistory,
        dealers: cDealers,
        reports: cReports,
      } = cached.value;
      if (cStats) setStats(cStats);
      if (cLeadMetrics !== undefined) setLeadMetrics(cLeadMetrics);
      if (cRedditImport !== undefined) setRedditImport(cRedditImport);
      if (Array.isArray(cHistory)) setHistory(cHistory);
      if (Array.isArray(cDealers)) setDealers(cDealers);
      if (Array.isArray(cReports)) setReports(cReports);
      setLoading(false);
    }

    let active = true;
    setRefreshing(true);

    (async () => {
      const merged = {
        stats: cached?.value?.stats || {},
        leadMetrics: cached?.value?.leadMetrics ?? null,
        contactAnalytics: cached?.value?.contactAnalytics ?? null,
        redditImport: cached?.value?.redditImport ?? null,
        history: Array.isArray(cached?.value?.history) ? cached.value.history : [],
        dealers: Array.isArray(cached?.value?.dealers) ? cached.value.dealers : [],
        reports: Array.isArray(cached?.value?.reports) ? cached.value.reports : [],
      };
      let statsResolved = Boolean(cached?.value?.stats);
      try {
        setError('');
        const daysParam = days ? `?days=${days}` : '';

        const requests = [
          apiClient.get(`/api/admin/stats${daysParam}`).catch(() => ({})).then((statsRes) => {
            if (!active) return;
            merged.stats = statsRes || {};
            setStats(merged.stats);
            statsResolved = true;
            setLoading(false);
          }),
          apiClient.get(`/api/admin/lead-metrics?days=${days}`).catch(() => null).then((leadRes) => {
            if (!active) return;
            merged.leadMetrics = leadRes || null;
            setLeadMetrics(merged.leadMetrics);
          }),
          apiClient.get(`/api/admin/contact-analytics?days=${days}`).catch(() => null).then((contactRes) => {
            if (!active) return;
            merged.contactAnalytics = contactRes || null;
            setContactAnalytics(merged.contactAnalytics);
          }),
          apiClient.get(`/api/admin/reddit-import-analytics?days=${days}`).catch(() => null).then((redditRes) => {
            if (!active) return;
            merged.redditImport = redditRes || null;
            setRedditImport(merged.redditImport);
          }),
          apiClient.get('/api/admin/listing-history?limit=12').catch(() => []).then((historyRes) => {
            if (!active) return;
            merged.history = Array.isArray(historyRes) ? historyRes : [];
            setHistory(merged.history);
          }),
          apiClient.get('/api/admin/dealers?pending=true').catch(() => []).then((dealersRes) => {
            if (!active) return;
            merged.dealers = Array.isArray(dealersRes) ? dealersRes : [];
            setDealers(merged.dealers);
          }),
          apiClient.get('/api/admin/reports?status=pending&limit=12').catch(() => []).then((reportsRes) => {
            if (!active) return;
            merged.reports = Array.isArray(reportsRes) ? reportsRes : [];
            setReports(merged.reports);
          }),
        ];

        await Promise.allSettled(requests);
        if (!active) return;
        swrSet(cacheKey, merged);
      } catch (loadError) {
        if (!active) return;
        console.error('Failed to load admin dashboard:', loadError);
        if (!cached?.value) setError(loadError.message || 'Failed to load dashboard');
      } finally {
        if (active) {
          if (!statsResolved) setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => { active = false; };
  }, [days]);

  // ── live-users polling (30 s, visibility-aware) ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    // Seed the sparkline with the last 30 min of per-minute buckets so the
    // chart renders meaningful history on first paint instead of waiting
    // 15s+ for polled samples to accumulate.
    const loadHistory = async () => {
      try {
        const res = await apiClient
          .request('/api/admin/live-users/history?window_seconds=1800&bucket_seconds=60')
          .catch(() => null);
        if (cancelled || !res || !Array.isArray(res.points)) return;
        const seeded = res.points
          .filter((p) => p && p.ts && Number.isFinite(Number(p.value)))
          .map((p) => ({ date: p.ts, value: Number(p.value) }));
        if (!seeded.length) return;
        setLiveUsersHistory((prev) => {
          // If the polling loop already pushed a sample, keep it on top.
          if (!prev.length) return seeded;
          const lastSeedTs = new Date(seeded[seeded.length - 1].date).getTime();
          const tail = prev.filter((p) => new Date(p.date).getTime() > lastSeedTs);
          return [...seeded, ...tail];
        });
      } catch {
        /* swallow — polling will populate as it goes */
      }
    };

    const loadLiveUsers = async () => {
      try {
        const res = await apiClient.request('/api/admin/live-users?window_seconds=300').catch(() => null);
        if (cancelled) return;
        setLiveUsers(res);
        if (res && Number.isFinite(Number(res.live_visitors))) {
          const ts = res.timestamp || new Date().toISOString();
          setLiveUsersHistory((prev) => {
            const next = [...prev, { date: ts, value: Number(res.live_visitors) }];
            // Keep last ~30 min of samples (30 history buckets + ~120 poll samples = ~150 cap)
            return next.length > 200 ? next.slice(next.length - 200) : next;
          });
        }
      } catch {
        if (!cancelled) setLiveUsers(null);
      }
    };

    const start = () => {
      if (!intervalId) intervalId = window.setInterval(loadLiveUsers, 30000);
    };
    const stop = () => {
      if (intervalId) { window.clearInterval(intervalId); intervalId = null; }
    };
    const onVisibility = () => {
      if (document.hidden) { stop(); } else { loadLiveUsers(); start(); }
    };

    loadHistory();
    loadLiveUsers();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ── derived values ───────────────────────────────────────────────────────
  const contactSummary = contactAnalytics?.summary || {};
  const recentEvents = leadMetrics?.recent_events ?? EMPTY_ARRAY;

  const totalListingViews = useMemo(
    () =>
      clampNumber(stats.cars_views) +
      clampNumber(stats.bikes_views) +
      clampNumber(stats.parts_views) +
      clampNumber(stats.plates_views),
    [stats],
  );

  const totalLeads    = clampNumber(contactSummary.unique_leads);
  const totalCalls    = clampNumber(contactSummary.unique_callers);
  const totalWhatsapp = clampNumber(contactSummary.unique_whatsapp_contacts);
  const vinReveals    = clampNumber(contactSummary.unique_vin_revealers);
  const totalDealers  = clampNumber(stats.total_dealers  || dealers.length);
  const totalReports  = clampNumber(stats.total_reports  || reports.length);
  const savedSearchesTotal = clampNumber(stats.saved_searches_total);
  const savedSearchesWindow = clampNumber(stats.saved_searches_window);
  const lifecycleTotals = stats.listing_lifecycle?.totals || {};
  const activeListingsTotal = clampNumber(stats.active_listings_total ?? lifecycleTotals.active);
  const draftListingsTotal = clampNumber(stats.draft_listings_total ?? lifecycleTotals.draft);
  const expiredListingsTotal = clampNumber(stats.expired_listings_total ?? lifecycleTotals.expired);
  const soldOnDphTotal = clampNumber(stats.sold_on_dph_total ?? lifecycleTotals.sold_on_dph);
  const soldElsewhereTotal = clampNumber(stats.sold_elsewhere_total ?? lifecycleTotals.sold_elsewhere);
  const noResponseTotal = clampNumber(stats.no_response_total ?? lifecycleTotals.no_response);

  const pendingDealers = dealers.filter((d) => !d.dealer_verified);
  const pendingReports = reports.filter((r) => (r.status || 'pending') === 'pending');
  const liveVisitorsCount = clampNumber(liveUsers?.live_visitors);
  const dataHealth = stats.data_health || null;

  // ── lead trend series for TrendChart ────────────────────────────────────
  const leadTrendSeries = useMemo(() => {
    if (leadMetrics?.daily && Array.isArray(leadMetrics.daily) && leadMetrics.daily.length > 1) {
      const daily = leadMetrics.daily;
      return [
        {
          label: 'Calls',
          color: '#10b981',
          data: daily.map((d) => ({ date: d.date, value: d.call_click || 0 })),
        },
        {
          label: 'WhatsApp',
          color: '#3b82f6',
          data: daily.map((d) => ({ date: d.date, value: d.whatsapp_click || 0 })),
        },
        {
          label: 'VIN Reveals',
          color: '#f59e0b',
          data: daily.map((d) => ({ date: d.date, value: d.vin_reveal || 0 })),
        },
      ];
    }

    // Fallback: build weekly buckets from recent_events
    const buckets = [];
    const map = new Map();
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = formatDateKey(date);
      map.set(key, { date: key, call_click: 0, whatsapp_click: 0, vin_reveal: 0 });
    }
    recentEvents.forEach((ev) => {
      const d = new Date(ev.created_at);
      if (Number.isNaN(d.getTime())) return;
      const key = formatDateKey(d);
      const bucket = map.get(key);
      if (!bucket) return;
      const action = ev.action || '';
      if (action === 'call_click')     bucket.call_click     += 1;
      if (action === 'whatsapp_click') bucket.whatsapp_click += 1;
      if (action === 'vin_reveal')     bucket.vin_reveal     += 1;
    });
    map.forEach((v) => buckets.push(v));

    return [
      { label: 'Calls',      color: '#10b981', data: buckets.map((b) => ({ date: b.date, value: b.call_click })) },
      { label: 'WhatsApp',   color: '#3b82f6', data: buckets.map((b) => ({ date: b.date, value: b.whatsapp_click })) },
      { label: 'VIN Reveals',color: '#f59e0b', data: buckets.map((b) => ({ date: b.date, value: b.vin_reveal })) },
    ];
  }, [leadMetrics, recentEvents]);

  // ── live-users sparkline series ─────────────────────────────────────────
  const liveUsersSeries = useMemo(() => {
    if (!liveUsersHistory.length) return [];
    return [
      {
        label: 'Live visitors',
        color: '#10b981',
        data: liveUsersHistory.map((p) => ({ date: p.date, value: p.value })),
      },
    ];
  }, [liveUsersHistory]);

  // ── loading skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 p-1">
        {/* hero skeleton */}
        <div className="flex items-center justify-between">
          <div className="animate-pulse bg-[color:var(--ex-shell-surface-strong)] rounded-lg h-9 w-56" />
          <div className="animate-pulse bg-[color:var(--ex-shell-surface-strong)] rounded-full h-8 w-40" />
        </div>
        {/* 8-tile skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <KpiTile key={i} label="" value={0} loading />
          ))}
        </div>
      </div>
    );
  }

  // ── error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-6 p-1">
        <GlassCard className="text-center py-16">
          <p className="text-[color:var(--ex-shell-text)] text-lg font-medium mb-2">Dashboard unavailable</p>
          <p className="text-[color:var(--ex-shell-text-muted)] text-sm mb-6">{error}</p>
          <button
            type="button"
            className="px-4 py-2 rounded-xl bg-[color:var(--ex-shell-surface-strong)] text-[color:var(--ex-shell-text)] text-sm hover:bg-[color:var(--ex-shell-surface-strong)] transition-colors"
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

      {/* ── 1. Hero row ─────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between gap-4 flex-wrap"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold text-[color:var(--ex-shell-text)]">Platform overview</h1>
          {/* Live visitors pill */}
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
              liveVisitorsCount > 0
                ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                : 'text-[color:var(--ex-shell-text-muted)] bg-[color:var(--ex-shell-surface)] border-[color:var(--ex-shell-line)]'
            }`}
          >
            <Radio size={10} className={liveVisitorsCount > 0 ? 'text-emerald-400 animate-pulse' : 'text-[color:var(--ex-shell-text-muted)]'} />
            Live: {liveVisitorsCount.toLocaleString('en-AE')} visitors
          </span>
        </div>
        <div className="flex items-center gap-2">
          {refreshing && !loading && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border border-[color:var(--ex-shell-line)] bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)]">
              <Loader2 size={11} className="animate-spin" />
              Updating…
            </span>
          )}
          {/* Tells the operator whether the headline tiles are coming from
              Cloudflare edge data or the in-app platform_events tracker. The
              backend stamps stats.data_source ('cloudflare' | 'platform_events')
              and an optional stats.data_source_note explaining how to switch. */}
          {stats?.data_source && (() => {
            // Build a precise label + tooltip so it's obvious which pipeline
            // produced the visitor number and how trustworthy it is:
            //   cf_rest          → matches dash.cloudflare.com exactly
            //   cf_graphql_estimate → linear-decay heuristic from per-day uniques
            //   platform_events  → in-app tracker, doesn't see ad-blocked clients
            const cfSource = stats.unique_visitors_source;
            let label = 'platform_events';
            let tooltip = stats.data_source_note ||
              'Numbers from the in-app platform_events tracker. Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID on the backend to switch to edge truth.';
            let tone = 'border-[color:var(--ex-shell-line)] bg-[color:var(--ex-shell-surface)] text-[color:var(--ex-shell-text-muted)]';
            if (stats.data_source === 'cloudflare') {
              tone = 'border-orange-400/30 bg-orange-400/10 text-orange-200';
              if (cfSource === 'cf_rest') {
                label = 'Cloudflare (exact)';
                tooltip = 'Site visitors come from Cloudflare REST Zone Analytics — same number dash.cloudflare.com shows.';
              } else if (cfSource === 'cf_graphql_estimate') {
                label = 'Cloudflare (estimated)';
                tooltip = 'REST dashboard endpoint unavailable on this plan, so window-uniques are estimated from per-day GraphQL uniques (peak day floored, decays toward truth as the window grows). Page views / requests / threats are exact.';
                tone = 'border-amber-400/30 bg-amber-400/10 text-amber-200';
              } else {
                label = 'Cloudflare';
                tooltip = 'Headline traffic numbers from Cloudflare edge analytics.';
              }
            }
            return (
              <span title={tooltip} className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border ${tone}`}>
                Source: {label}
              </span>
            );
          })()}
          <SegmentedControl options={WINDOW_OPTIONS} value={days} onChange={setDays} />
        </div>
      </motion.div>

      {/* ── 2. Primary KPI grid (8 tiles) ───────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total users',       value: clampNumber(stats.total_users),   icon: Users,         accent: 'default' },
          { label: 'Site visitors',     value: clampNumber(stats.unique_visitors),icon: Eye,           suffix: ' uniq'   },
          { label: 'Total leads',       value: totalLeads,                        icon: Target,        accent: 'emerald' },
          { label: 'Call taps',         value: totalCalls,                        icon: Phone                           },
          { label: 'WhatsApp taps',     value: totalWhatsapp,                     icon: MessageSquare                   },
          { label: 'VIN reveals',       value: vinReveals,                        icon: Fingerprint, accent: 'default', onClick: () => setShowVinAnalytics(true) },
          { label: 'Total dealers',     value: totalDealers,                      icon: Store                           },
          { label: 'Active listing views', value: totalListingViews,              icon: Activity                        },
          { label: 'Saved searches',    value: savedSearchesTotal,                icon: Target, delta: savedSearchesWindow },
          {
            label: pendingReports.length > 0
              ? `Reports (${pendingReports.length} pending)`
              : 'Reports',
            value: totalReports,
            icon: AlertTriangle,
            delta: pendingReports.length > 0 ? -pendingReports.length : undefined,
          },
        ].map(({ label, value, icon, accent, suffix, delta, onClick }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
          >
            <KpiTile
              label={label}
              value={value}
              icon={icon}
              accent={accent}
              suffix={suffix}
              delta={delta}
              onClick={onClick}
            />
          </motion.div>
        ))}
      </div>

      <VinRevealAnalyticsModal open={showVinAnalytics} onClose={() => setShowVinAnalytics(false)} listings={contactAnalytics?.vin_listings || []} days={days} />

      {/* ── Reddit import health & outbound opens ─────────────────────────── */}
      <RedditImportAnalyticsPanel data={redditImport} />

      {/* ── 3. Pending review queue ──────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
        <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-3">
          Moderation queue
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Cars pending',   value: clampNumber(stats.cars_pending),   icon: Car,   href: '/admin/listings?types=cars&statuses=pending'   },
            { label: 'Bikes pending',  value: clampNumber(stats.bikes_pending),  icon: Bike,  href: '/admin/listings?types=bikes&statuses=pending'  },
            { label: 'Parts pending',  value: clampNumber(stats.parts_pending),  icon: Wrench,href: '/admin/listings?types=parts&statuses=pending'  },
            { label: 'Plates pending', value: clampNumber(stats.plates_pending), icon: Hash,  href: '/admin/listings?types=plates&statuses=pending' },
          ].map(({ label, value, icon: Icon, href }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.20 + i * 0.04 }}
            >
              <GlassCard
                className="cursor-pointer hover:bg-[color:var(--ex-shell-surface-strong)] transition-colors"
                onClick={() => navigate(href)}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium">{label}</p>
                  <Icon size={14} className="text-[color:var(--ex-shell-text-muted)]" />
                </div>
                <p className="text-2xl font-semibold tabular-nums text-[color:var(--ex-shell-text)]">
                  {value.toLocaleString('en-AE')}
                </p>
                {value > 0 && (
                  <p className="text-[11px] text-amber-300/70 mt-1">Needs review</p>
                )}
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── 3b. Listing lifecycle outcomes ──────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
        <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-3">
          Listing lifecycle
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Active', value: activeListingsTotal, icon: Activity, href: '/admin/listings?statuses=approved' },
            { label: 'Drafts', value: draftListingsTotal, icon: Wrench, href: '/admin/listings?statuses=draft' },
            { label: 'Expired', value: expiredListingsTotal, icon: AlertTriangle, href: '/admin/listings?statuses=expired' },
            { label: 'Sold on DPH', value: soldOnDphTotal, icon: Car, href: '/admin/listings?statuses=sold' },
            { label: 'Sold elsewhere', value: soldElsewhereTotal, icon: ExternalLink, href: '/admin/listings?statuses=sold' },
            { label: 'No response', value: noResponseTotal, icon: Clock, href: '/admin/expired-listings?reason=no_response' },
          ].map(({ label, value, icon: Icon, href }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.26 + i * 0.04 }}
            >
              <GlassCard
                className="cursor-pointer hover:bg-[color:var(--ex-shell-surface-strong)] transition-colors"
                onClick={() => navigate(href)}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium">{label}</p>
                  <Icon size={14} className="text-[color:var(--ex-shell-text-muted)]" />
                </div>
                <p className="text-2xl font-semibold tabular-nums text-[color:var(--ex-shell-text)]">
                  {value.toLocaleString('en-AE')}
                </p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── 4. Three-column: Lead activity + Live visitors + Pending dealers ─ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_380px] gap-4">

        {/* Lead activity chart */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}>
          <GlassCard>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-4">
              Lead activity
            </p>
            <TrendChart
              series={leadTrendSeries}
              height={220}
              showLegend
              emptyLabel="No lead activity in this window"
            />
          </GlassCard>
        </motion.div>

        {/* Live visitors sparkline */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.29 }}>
          <GlassCard>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium">
                Live visitors
              </p>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  liveVisitorsCount > 0
                    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-[color:var(--ex-shell-text-muted)] bg-[color:var(--ex-shell-surface)] border-[color:var(--ex-shell-line)]'
                }`}
              >
                <Radio size={9} className={liveVisitorsCount > 0 ? 'text-emerald-400 animate-pulse' : 'text-[color:var(--ex-shell-text-muted)]'} />
                Now: {liveVisitorsCount.toLocaleString('en-AE')}
              </span>
            </div>
            <TrendChart
              series={liveUsersSeries}
              height={220}
              showLegend={false}
              emptyLabel="Collecting live samples…"
            />
            <p className="mt-2 text-[10px] text-[color:var(--ex-shell-text-muted)]">
              Rolling 30 min · refreshes every 15s
            </p>
          </GlassCard>
        </motion.div>

        {/* Pending dealers */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.30 }}>
          <GlassCard className="flex flex-col h-full">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-4">
              Pending dealers
            </p>

            {pendingDealers.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No pending dealers"
                description="The verification queue is clear."
              />
            ) : (
              <div className="space-y-2 flex-1">
                {pendingDealers.slice(0, 5).map((dealer) => {
                  const initial = (dealer.email || 'D')[0].toUpperCase();
                  const email = dealer.email || 'No email';
                  return (
                    <div
                      key={dealer.id}
                      className="flex items-center gap-3 py-2 border-b border-[color:var(--ex-shell-line)] last:border-0"
                    >
                      {/* Initial circle */}
                      <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[11px] font-semibold text-amber-300 flex-shrink-0">
                        {initial}
                      </div>
                      <p className="text-sm text-[color:var(--ex-shell-text-muted)] flex-1 truncate">{email}</p>
                      <Badge color="amber">Pending</Badge>
                      <Link
                        to={`/admin/dealers/${dealer.id}`}
                        className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors flex-shrink-0"
                      >
                        Review
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}

            {pendingDealers.length > 0 && (
              <Link
                to="/admin/dealers?pending=true"
                className="mt-4 pt-3 border-t border-[color:var(--ex-shell-line)] text-[11px] text-[color:var(--ex-shell-text-muted)] hover:text-[color:var(--ex-shell-text-muted)] transition-colors flex items-center gap-1"
              >
                View all pending <ChevronRight size={11} />
              </Link>
            )}
          </GlassCard>
        </motion.div>
      </div>

      {/* ── 5. Recent listing activity ───────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.34 }}>
        <GlassCard>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-4">
            Recent listings
          </p>
          {history.length === 0 ? (
            <EmptyState icon={Activity} title="No listing history" description="Listing activity will appear here." />
          ) : (
            <div className="space-y-1">
              {history.slice(0, 8).map((entry, i) => {
                // listing_deletion_events.id is the event ID — link target is listing_id.
                const listingId = entry.listing_id || entry.id;
                const href = adminListingDetailHref(entry.listing_type, listingId);
                const idLabel = String(listingId || '').slice(0, 8) || '—';
                const priceNum = entry.price != null ? Number(entry.price) : null;
                const priceStr =
                  priceNum != null && !Number.isNaN(priceNum) && priceNum > 0
                    ? `AED ${priceNum.toLocaleString('en-AE')}`
                    : null;
                const rowClass =
                  'flex items-center gap-3 py-2 border-b border-[color:var(--ex-shell-line)] last:border-0';
                const rowBody = (
                  <>
                    {entry.image_url ? (
                      <img
                        src={entry.image_url}
                        alt=""
                        loading="lazy"
                        className="w-10 h-10 rounded-md object-cover flex-shrink-0 bg-[color:var(--ex-shell-surface)]"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] flex items-center justify-center flex-shrink-0">
                        <ImageOff size={14} className="text-[color:var(--ex-shell-text-muted)]" />
                      </div>
                    )}
                    <TypeBadge type={entry.listing_type} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[color:var(--ex-shell-text)] truncate">
                        {entry.title || idLabel}
                      </p>
                      {(priceStr || entry.title) && (
                        <p className="text-[11px] text-[color:var(--ex-shell-text-muted)] truncate">
                          {priceStr}
                          {priceStr && entry.title ? ' · ' : ''}
                          <span className="font-mono">{idLabel}</span>
                        </p>
                      )}
                    </div>
                    <Badge
                      color={
                        entry.status === 'approved'
                          ? 'emerald'
                          : entry.status === 'rejected'
                          ? 'rose'
                          : 'amber'
                      }
                    >
                      {entry.status || 'removed'}
                    </Badge>
                    <span className="text-[11px] text-[color:var(--ex-shell-text-muted)] flex-shrink-0">
                      {relTime(entry.created_at || entry.deleted_at)}
                    </span>
                  </>
                );
                return (
                  <motion.div
                    key={entry.id || listingId || i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.36 + i * 0.03 }}
                  >
                    {href ? (
                      <Link
                        to={href}
                        className={`${rowClass} hover:bg-[color:var(--ex-shell-surface)] rounded-lg px-2 -mx-2 transition-colors cursor-pointer`}
                      >
                        {rowBody}
                      </Link>
                    ) : (
                      <div className={rowClass}>{rowBody}</div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* ── 6. Open reports ─────────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
        <GlassCard>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-4">
            Open reports
          </p>
          {pendingReports.length === 0 ? (
            <EmptyState icon={Shield} title="No open reports" description="All clear right now." />
          ) : (
            <div className="space-y-1">
              {pendingReports.slice(0, 5).map((report, i) => (
                <motion.div
                  key={report.id || i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.40 + i * 0.03 }}
                  className="flex items-center gap-3 py-2 border-b border-[color:var(--ex-shell-line)] last:border-0"
                >
                  <SeverityDot severity={report.severity} />
                  <p className="text-sm text-[color:var(--ex-shell-text-muted)] flex-1 truncate">
                    {report.title || report.reason || (report.details || '').slice(0, 60) || 'Report'}
                  </p>
                  <span className="text-[11px] text-[color:var(--ex-shell-text-muted)] flex-shrink-0">
                    {relTime(report.created_at)}
                  </span>
                  <Link
                    to="/admin/reports"
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors flex-shrink-0"
                  >
                    Review
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* ── 7. Data health (optional) ────────────────────────────────────── */}
      {dataHealth && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.44 }}>
          <GlassCard>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-4">
              Data health
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(dataHealth).map(([key, val]) => {
                const ok = val === true || val === 'ok' || val === 'healthy' || val === 'indexed';
                const bad = val === false || val === 'missing' || val === 'down';
                const icon = ok ? '✓' : bad ? '✗' : '·';
                const color = ok ? 'text-emerald-400' : bad ? 'text-rose-400' : 'text-amber-400';
                const label = key.replace(/_/g, ' ');
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className={`font-semibold ${color} w-4 text-center flex-shrink-0`}>{icon}</span>
                    <span className="text-[11px] text-[color:var(--ex-shell-text-muted)] capitalize">{label}</span>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── 7b. Unified Cropper rollout health ──────────────────────────── */}
      {stats?.cropped_at_pct !== null && stats?.cropped_at_pct !== undefined && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          <GlassCard>
            <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-1">
              Modern crop rollout
            </p>
            <p className="text-2xl font-semibold text-[color:var(--ex-shell-text)]">{stats.cropped_at_pct}%</p>
            <p className="text-[11px] text-[color:var(--ex-shell-text-muted)] mt-1">
              of listing images use the unified cropper
            </p>
          </GlassCard>
        </motion.div>
      )}

      {/* ── External analytics ──────────────────────────────────────────── */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.46 }}>
        <GlassCard>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ex-shell-text-muted)] font-medium mb-1">
            External analytics
          </p>
          <p className="text-sm text-[color:var(--ex-shell-text-muted)] mb-4">
            Hosted dashboards for traffic, conversions, heatmaps and session recordings.
          </p>
          <div className="flex flex-wrap gap-3">
            {analyticsConfig.ga4Enabled ? (
              <a
                href={GA4_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-xl bg-[color:var(--ex-shell-surface-strong)] border border-[color:var(--ex-shell-line)] text-[color:var(--ex-shell-text)] hover:bg-[color:var(--ex-shell-surface-strong)] transition-colors"
              >
                GA4 Dashboard <ExternalLink size={11} />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] text-[color:var(--ex-shell-text-muted)] cursor-not-allowed"
                title="Set REACT_APP_GA4_MEASUREMENT_ID in frontend/.env"
              >
                GA4 — add measurement ID
              </button>
            )}
            {analyticsConfig.clarityEnabled ? (
              <a
                href={CLARITY_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-xl bg-[color:var(--ex-shell-surface-strong)] border border-[color:var(--ex-shell-line)] text-[color:var(--ex-shell-text)] hover:bg-[color:var(--ex-shell-surface-strong)] transition-colors"
              >
                Clarity Dashboard <ExternalLink size={11} />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 text-xs px-4 py-2 rounded-xl bg-[color:var(--ex-shell-surface)] border border-[color:var(--ex-shell-line)] text-[color:var(--ex-shell-text-muted)] cursor-not-allowed"
                title="Set REACT_APP_CLARITY_PROJECT_ID in frontend/.env"
              >
                Clarity — add project ID
              </button>
            )}
            <Link
              to="/admin/metrics"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              Open Metrics <ChevronRight size={11} />
            </Link>
          </div>
        </GlassCard>
      </motion.div>

    </div>
  );
};

export default AdminDashboard;
