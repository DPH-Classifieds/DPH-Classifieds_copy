import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Linking,
  Alert,
  AppState,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline, Rect } from 'react-native-svg';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../utils/apiClient';
import { formatNumber } from '../../utils/formatters';
import { swrGet, swrSet } from '../../utils/swrCache';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

// Tiny SVG sparkline. `points` is an array of { ts, value }; we map the
// last N onto an inline polyline. Doesn't import a charting library — keeps
// the bundle small and skips the perf cost of recharts/victory.
function LiveVisitorsSparkline({ points = [], width = 280, height = 60 }) {
  if (!points.length) {
    return (
      <View style={{ height, width, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>Collecting live samples…</Text>
      </View>
    );
  }
  const values = points.map((p) => Number(p.value) || 0);
  const max = Math.max(1, ...values);
  const stepX = width / Math.max(1, points.length - 1);
  const polyPoints = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - (v / max) * (height - 8) - 4).toFixed(1)}`)
    .join(' ');
  return (
    <Svg width={width} height={height}>
      <Rect x={0} y={0} width={width} height={height} fill="rgba(16,185,129,0.04)" rx={6} />
      <Polyline points={polyPoints} fill="none" stroke="#10b981" strokeWidth={2} />
    </Svg>
  );
}

// Quick Actions removed — the Inbox row at the top of the page now hosts the
// only actions an operator clicks regularly (approvals, reports, dealer
// reviews). View Metrics is exposed via the "Show all metrics" expander.

const TIME_RANGE_OPTIONS = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: null },
];

const LAUNCH_DATE = new Date('2026-05-09');

const clamp = (value) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export default function AdminDashboardScreen({ navigation }) {
  const { user } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  // Sparkline width = window minus section + surface paddings (16 + 16 on each side).
  const sparklineWidth = Math.max(200, windowWidth - SPACING.md * 2 - SPACING.md * 2);
  const [showAllMetrics, setShowAllMetrics] = useState(false);
  const [stats, setStats] = useState({});
  const [leadMetrics, setLeadMetrics] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [reports, setReports] = useState([]);
  const [liveUsers, setLiveUsers] = useState(null);
  const [liveUsersHistory, setLiveUsersHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  if (!user?.is_admin && !user?.is_super_admin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.black, justifyContent: 'center', alignItems: 'center' }}>
        <Ionicons name="lock-closed" size={48} color={COLORS.textMuted} />
        <Text style={{ color: COLORS.white, fontSize: 18, fontWeight: '600', marginTop: 16 }}>Access Denied</Text>
        <Text style={{ color: COLORS.textSecondary, marginTop: 8 }}>You don't have admin privileges.</Text>
      </SafeAreaView>
    );
  }

  const loadDashboard = useCallback(async ({ hadCache = false } = {}) => {
    try {
      setError('');
      const statsQuery = days ? `/api/admin/stats?days=${days}` : '/api/admin/stats';
      const leadQuery = days ? `/api/admin/lead-metrics?days=${days}` : '/api/admin/lead-metrics';
      const [statsRes, leadRes, dealersRes, reportsRes] = await Promise.all([
        apiClient.get(statsQuery).catch(() => ({})),
        apiClient.get(leadQuery).catch(() => null),
        apiClient.get('/api/admin/dealers?pending=true').catch(() => []),
        apiClient.get('/api/admin/reports').catch(() => []),
      ]);
      const merged = {
        stats: statsRes || {},
        leadMetrics: leadRes || null,
        dealers: Array.isArray(dealersRes) ? dealersRes : [],
        reports: Array.isArray(reportsRes) ? reportsRes : [],
      };
      setStats(merged.stats);
      setLeadMetrics(merged.leadMetrics);
      setDealers(merged.dealers);
      setReports(merged.reports);
      swrSet(`admin-dashboard:${days}`, merged);
    } catch (err) {
      // Keep cached values on error — only surface error if there was no cache.
      if (!hadCache) setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    let active = true;
    (async () => {
      const cached = await swrGet(`admin-dashboard:${days}`);
      if (!active) return;
      if (cached?.value) {
        const { stats: cStats, leadMetrics: cLead, dealers: cDealers, reports: cReports } = cached.value;
        if (cStats) setStats(cStats);
        if (cLead !== undefined) setLeadMetrics(cLead);
        if (Array.isArray(cDealers)) setDealers(cDealers);
        if (Array.isArray(cReports)) setReports(cReports);
        setLoading(false);
      } else {
        setLoading(true);
      }
      if (!active) return;
      loadDashboard({ hadCache: !!cached?.value });
    })();
    return () => { active = false; };
  }, [loadDashboard, days]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    // Seed the sparkline with ~30 min of per-minute history so the chart
    // paints meaningfully on first load instead of waiting for live samples.
    const loadHistory = async () => {
      try {
        const res = await apiClient
          .get('/api/admin/live-users/history?window_seconds=1800&bucket_seconds=60')
          .catch(() => null);
        if (cancelled || !res || !Array.isArray(res.points)) return;
        const seeded = res.points
          .filter((p) => p && p.ts && Number.isFinite(Number(p.value)))
          .map((p) => ({ ts: p.ts, value: Number(p.value) }));
        if (seeded.length) setLiveUsersHistory(seeded);
      } catch (_) { /* swallow — polling will populate as it goes */ }
    };

    const loadLive = async () => {
      try {
        const res = await apiClient.get('/api/admin/live-users?window_seconds=300').catch(() => null);
        if (cancelled) return;
        setLiveUsers(res);
        if (res && Number.isFinite(Number(res.live_visitors))) {
          const ts = res.timestamp || new Date().toISOString();
          setLiveUsersHistory((prev) => {
            const next = [...prev, { ts, value: Number(res.live_visitors) }];
            return next.length > 60 ? next.slice(next.length - 60) : next;
          });
        }
      } catch (_) {
        if (!cancelled) setLiveUsers(null);
      }
    };

    const start = () => {
      // Web bumped to 30s to match backend cache TTL — same here.
      if (!intervalId) intervalId = setInterval(loadLive, 30000);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    loadHistory();
    loadLive();
    if (AppState.currentState === 'active') start();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        loadLive();
        start();
      } else {
        stop();
      }
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  }, [loadDashboard]);

  const daysSinceLaunch = Math.floor((Date.now() - LAUNCH_DATE.getTime()) / 86400000);

  const selectedRangeLabel = useMemo(() => {
    const option = TIME_RANGE_OPTIONS.find((o) => o.days === days);
    return option ? option.label : `${days}d`;
  }, [days]);

  const totals = leadMetrics?.totals || {};
  const recentEvents = leadMetrics?.recent_events || [];
  const recentReports = leadMetrics?.recent_reports || [];

  const pendingApprovals = useMemo(() =>
    clamp(stats.cars_pending) + clamp(stats.bikes_pending) + clamp(stats.parts_pending) + clamp(stats.plates_pending),
  [stats]);

  const expiredTotal = clamp(stats.expired_listings_total || 0);

  const totalViews = useMemo(() =>
    clamp(stats.cars_views) + clamp(stats.bikes_views) + clamp(stats.parts_views) + clamp(stats.plates_views),
  [stats]);

  const totalUsers = clamp(stats.total_users);
  const totalReports = clamp(stats.total_reports || reports.length);
  const totalLeads = clamp(stats.total_leads || totals.qualified_leads || totals.call_click || 0);
  const totalCalls = clamp(stats.total_calls || totals.call_click || 0);
  const totalWhatsapp = clamp(stats.total_whatsapp || totals.whatsapp_click || 0);
  const totalDealers = clamp(stats.total_dealers || dealers.length);
  const verifiedDealers = dealers.filter((d) => d.dealer_verified).length;
  const liveVisitorsCount = clamp(liveUsers?.live_visitors);
  const uniqueVisitors = clamp(stats.unique_visitors);
  const dataHealth = stats.data_health || null;
  const platformEventsMissing = dataHealth?.platform_events === 'missing';

  const pendingByType = [
    { label: 'Cars', value: clamp(stats.cars_pending) },
    { label: 'Bikes', value: clamp(stats.bikes_pending) },
    { label: 'Parts', value: clamp(stats.parts_pending) },
    { label: 'Plates', value: clamp(stats.plates_pending) },
  ];

  const leadMix = [
    { label: 'Calls', value: clamp(totals.call_click || totalCalls) },
    { label: 'WhatsApp', value: clamp(totals.whatsapp_click || totalWhatsapp) },
    { label: 'VIN Opens', value: clamp(totals.vin_open) },
    { label: 'VIN Reveals', value: clamp(totals.vin_reveal) },
    { label: 'Reports', value: clamp(totals.reports_created || totalReports) },
  ];

  const weeklyActivity = useMemo(() => {
    const map = new Map();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { key, label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), total: 0 });
    }
    recentEvents.forEach((event) => {
      const d = new Date(event.created_at);
      if (Number.isNaN(d.getTime())) return;
      const key = d.toISOString().slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.total += 1;
    });
    return Array.from(map.values());
  }, [recentEvents]);

  const chartMax = Math.max(1, ...leadMix.map((i) => i.value), ...weeklyActivity.map((i) => i.total), ...pendingByType.map((i) => i.value));

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner message="Loading operator dashboard..." />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle" size={40} color={COLORS.error} />
          <Text style={styles.errorTitle}>Dashboard Unavailable</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadDashboard}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Operator Console</Text>
        </View>

        {/* Inbox — actionable items first. These replace the old bottom
            Quick Actions section and the buried Pending Approvals KPI. */}
        <View style={styles.inboxRow}>
          <InboxCard
            label="Pending"
            sub="Approvals"
            value={pendingApprovals}
            color={COLORS.warning}
            icon="time-outline"
            onPress={() => navigation.navigate('AdminListings', { initialFilter: 'pending' })}
          />
          <InboxCard
            label="Open"
            sub="Reports"
            value={totalReports}
            color={COLORS.error}
            icon="flag-outline"
            onPress={() => navigation.navigate('AdminReports')}
          />
          <InboxCard
            label="Dealer"
            sub="Reviews"
            value={Math.max(0, totalDealers - verifiedDealers)}
            color={COLORS.info || COLORS.accent}
            icon="business-outline"
            onPress={() => navigation.navigate('AdminDealers')}
          />
          <InboxCard
            label="Expired"
            sub="Listings"
            value={expiredTotal}
            color="#FF6F00"
            icon="time-outline"
            onPress={() => navigation.navigate('AdminExpiredListings')}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.liveVisitorsHeader}>
            <Text style={styles.sectionTitle}>Live Visitors</Text>
            <View style={styles.liveVisitorsPill}>
              <Ionicons name="radio" size={10} color="#10b981" />
              <Text style={styles.liveVisitorsPillText}>Now: {formatNumber(liveVisitorsCount)}</Text>
            </View>
          </View>
          <View style={styles.surface}>
            <LiveVisitorsSparkline points={liveUsersHistory} width={sparklineWidth} height={64} />
            <Text style={styles.liveVisitorsCaption}>Rolling 30 min · refreshes every 30 s</Text>
          </View>
        </View>

        <View style={styles.timeRangeRow}>
          {TIME_RANGE_OPTIONS.map((option) => {
            const isActive = days === option.days;
            return (
              <TouchableOpacity
                key={option.label}
                style={[styles.timeRangePill, isActive && styles.timeRangePillActive]}
                onPress={() => setDays(option.days)}
                activeOpacity={0.7}
              >
                <Text style={[styles.timeRangeText, isActive && styles.timeRangeTextActive]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {platformEventsMissing && (
          <View style={styles.healthBanner}>
            <Ionicons name="warning-outline" size={18} color={COLORS.warning} />
            <Text style={styles.healthBannerText}>
              Site Visitors falls back to lead events + signups because the
              `platform_events` table is missing. Apply
              backend/migrations/add_platform_analytics_tracking.sql in the
              Supabase SQL editor to get full page-view tracking.
            </Text>
          </View>
        )}

        {/* Headline KPIs — 4 cards visible by default, rest behind a tap. */}
        <View style={styles.kpiGrid}>
          <KpiCard icon="people" label="Total Users" value={formatNumber(totalUsers)} color={COLORS.accent} />
          <KpiCard
            icon="albums-outline"
            label="Total Listings"
            value={formatNumber(
              clamp(stats.cars_total) + clamp(stats.bikes_total) +
              clamp(stats.parts_total) + clamp(stats.plates_total)
            )}
            color={COLORS.accent}
          />
          <KpiCard icon="call" label="Total Leads" value={formatNumber(totalLeads)} color={COLORS.accent} />
          <KpiCard icon="eye" label="Total Views" value={formatNumber(totalViews)} color={COLORS.accent} />
        </View>

        <TouchableOpacity
          style={styles.expanderRow}
          onPress={() => setShowAllMetrics((s) => !s)}
          activeOpacity={0.7}
        >
          <Text style={styles.expanderText}>
            {showAllMetrics ? 'Hide detailed metrics' : 'Show all metrics'}
          </Text>
          <Ionicons
            name={showAllMetrics ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={COLORS.textSecondary}
          />
        </TouchableOpacity>

        {showAllMetrics && (
          <>
            <View style={styles.kpiGrid}>
              <KpiCard icon="calendar" label="Days Since Launch" value={formatNumber(daysSinceLaunch)} color="#4CAF50" />
              <KpiCard icon="car" label="Total Cars" value={formatNumber(clamp(stats.cars_total))} color={COLORS.accent} />
              <KpiCard icon="bicycle" label="Total Bikes" value={formatNumber(clamp(stats.bikes_total))} color={COLORS.accent} />
              <KpiCard icon="construct" label="Total Parts" value={formatNumber(clamp(stats.parts_total))} color={COLORS.accent} />
              <KpiCard icon="key" label="Total Plates" value={formatNumber(clamp(stats.plates_total))} color={COLORS.accent} />
              <KpiCard icon="logo-whatsapp" label={`WhatsApp (${selectedRangeLabel})`} value={formatNumber(totalWhatsapp)} color={COLORS.accent} />
              <KpiCard icon="phone-portrait" label={`Callers (${selectedRangeLabel})`} value={formatNumber(totalCalls)} color={COLORS.accent} />
              <KpiCard icon="globe-outline" label={`Visitors (${selectedRangeLabel})`} value={formatNumber(uniqueVisitors)} color={COLORS.accent} />
              <KpiCard icon="business" label="Verified Dealers" value={`${formatNumber(verifiedDealers)}/${formatNumber(totalDealers)}`} color={COLORS.accent} />
            </View>
            <View style={{ paddingHorizontal: SPACING.md, marginTop: -SPACING.sm, marginBottom: SPACING.md }}>
              <CfSourceBadge dataSource={stats?.data_source} uniqueVisitorsSource={stats?.unique_visitors_source} />
              {stats?.data_source === 'cloudflare' && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <EdgeStat label="Requests" value={stats.edge_requests} />
                  <EdgeStat label="Threats" value={stats.edge_threats} />
                  <EdgeStat label="Cached" value={stats.edge_cached_requests} />
                </View>
              )}
            </View>
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lead Mix ({selectedRangeLabel})</Text>
          <View style={styles.surface}>
            {leadMix.map((item) => (
              <View key={item.label} style={styles.barRow}>
                <Text style={styles.barLabel}>{item.label}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.max(6, (item.value / chartMax) * 100)}%` }]} />
                </View>
                <Text style={styles.barValue}>{formatNumber(item.value)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activity Trend (7 days)</Text>
          <View style={styles.surface}>
            {weeklyActivity.map((day) => (
              <View key={day.key} style={styles.barRow}>
                <Text style={styles.barLabel}>{day.label}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.max(6, (day.total / chartMax) * 100)}%` }]} />
                </View>
                <Text style={styles.barValue}>{formatNumber(day.total)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pending Approvals</Text>
          <View style={styles.surface}>
            {pendingByType.map((item) => (
              <View key={item.label} style={styles.queueRow}>
                <View style={styles.queueRowText}>
                  <Text style={styles.queueLabel} numberOfLines={1}>{item.label}</Text>
                  <Text style={styles.queueSub} numberOfLines={1}>Listings waiting for moderation</Text>
                </View>
                <Text style={[styles.badge, styles.badgeWarning]}>{formatNumber(item.value)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dealers</Text>
          <View style={styles.surface}>
            {dealers.length === 0 ? (
              <Text style={styles.emptyText}>No pending dealers. Queue is clear.</Text>
            ) : (
              dealers.slice(0, 6).map((dealer) => {
                const name = [dealer.first_name, dealer.last_name].filter(Boolean).join(' ') || dealer.email || 'Dealer';
                const company = dealer.company_name || dealer.company_registration_number || 'No company';
                return (
                  <View key={dealer.id} style={styles.queueRow}>
                    <View style={styles.queueRowText}>
                      <Text style={styles.queueLabel} numberOfLines={1}>{name}</Text>
                      <Text style={styles.queueSub} numberOfLines={1}>{company}</Text>
                    </View>
                    <Text style={[styles.badge, dealer.dealer_verified ? styles.badgeSuccess : styles.badgeWarning]}>
                      {dealer.dealer_verified ? 'Verified' : 'Pending'}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Reports</Text>
          <View style={styles.surface}>
            {recentReports.length === 0 ? (
              <Text style={styles.emptyText}>No recent reports.</Text>
            ) : (
              recentReports.slice(0, 5).map((report) => (
                <View key={report.id} style={styles.queueRow}>
                  <View style={styles.queueRowText}>
                    <Text style={styles.queueLabel} numberOfLines={1}>{(report.listing_type || 'listing').toUpperCase()} - {report.reason || 'Report'}</Text>
                    <Text style={styles.queueSub} numberOfLines={2}>{report.details || report.status || 'Pending review'}</Text>
                  </View>
                  <Text style={[styles.badge, styles.badgeWarning]}>{report.status || 'pending'}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        {(process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID || process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>External Analytics</Text>
            {process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID && (
              <ExternalAnalyticsCard
                title="Open GA4 Dashboard"
                subtitle="Active users, sessions, conversions"
                icon="stats-chart-outline"
                url="https://analytics.google.com/analytics/web/"
              />
            )}
            {process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID && (
              <ExternalAnalyticsCard
                title="Open Clarity Dashboard"
                subtitle="Heatmaps and session recordings"
                icon="eye-outline"
                url={`https://clarity.microsoft.com/projects/view/${process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID}/dashboard`}
              />
            )}
          </View>
        )}

        <TouchableOpacity
          style={styles.metricsLinkRow}
          onPress={() => navigation.navigate('AdminMetrics')}
          activeOpacity={0.7}
        >
          <Ionicons name="stats-chart-outline" size={18} color={COLORS.textSecondary} />
          <Text style={styles.metricsLinkText}>View full metrics</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function CfSourceBadge({ dataSource, uniqueVisitorsSource }) {
  if (!dataSource) return null;
  if (dataSource !== 'cloudflare') {
    return <Text style={cfBadgeStyles.grey}>In-app tracker</Text>;
  }
  if (uniqueVisitorsSource === 'cf_rest') {
    return <Text style={cfBadgeStyles.orange}>Cloudflare (exact)</Text>;
  }
  if (uniqueVisitorsSource === 'cf_graphql_estimate') {
    return <Text style={cfBadgeStyles.amber}>Cloudflare (estimated)</Text>;
  }
  return <Text style={cfBadgeStyles.orange}>Cloudflare</Text>;
}

const cfBadgeStyles = StyleSheet.create({
  orange: { fontSize: 10, color: '#fdba74', backgroundColor: 'rgba(251,146,60,0.15)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', alignSelf: 'flex-start', marginTop: 4 },
  amber:  { fontSize: 10, color: '#fcd34d', backgroundColor: 'rgba(252,211,77,0.12)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', alignSelf: 'flex-start', marginTop: 4 },
  grey:   { fontSize: 10, color: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', alignSelf: 'flex-start', marginTop: 4 },
});

function EdgeStat({ label, value }) {
  return (
    <View style={{ flex: 1, backgroundColor: '#272729', borderRadius: 8, padding: 10, alignItems: 'center' }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{value?.toLocaleString() ?? '—'}</Text>
      <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function InboxCard({ label, sub, value, color, icon, onPress }) {
  return (
    <TouchableOpacity style={styles.inboxCard} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.inboxIconWrap, { backgroundColor: `${color}26` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.inboxValue}>{formatNumber(value || 0)}</Text>
      <Text style={styles.inboxLabel}>{label}</Text>
      <Text style={styles.inboxSub}>{sub}</Text>
    </TouchableOpacity>
  );
}

function ExternalAnalyticsCard({ title, subtitle, icon, url }) {
  const handlePress = () => {
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open', 'No browser available to open the dashboard.');
    });
  };

  return (
    <TouchableOpacity style={styles.actionCard} onPress={handlePress} activeOpacity={0.7}>
      <View style={styles.actionLeft}>
        <Ionicons name={icon} size={20} color={COLORS.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.actionLabel}>{title}</Text>
          <Text style={styles.actionSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <Ionicons name="open-outline" size={18} color={COLORS.textSecondary} />
    </TouchableOpacity>
  );
}

function KpiCard({ icon, label, value, color }) {
  return (
    <View style={styles.kpiCard}>
      <Ionicons name={icon} size={22} color={color} style={styles.kpiIcon} />
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  scrollContent: { paddingBottom: 40 },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  title: { fontSize: FONT_SIZES.hero, fontWeight: '700', color: COLORS.white },
  inboxRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.lg,
  },
  inboxCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    alignItems: 'flex-start',
    minHeight: 92,
  },
  inboxIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  inboxValue: { fontSize: 22, fontWeight: '800', color: COLORS.white },
  inboxLabel: { fontSize: FONT_SIZES.xs, color: COLORS.textSecondary, marginTop: 4 },
  inboxSub: { fontSize: FONT_SIZES.xs, color: COLORS.textSecondary, fontWeight: '600' },
  expanderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, marginHorizontal: SPACING.md, marginBottom: SPACING.md,
  },
  expanderText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  metricsLinkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg,
    paddingVertical: 14, paddingHorizontal: SPACING.md,
    marginHorizontal: SPACING.md, marginTop: SPACING.sm,
  },
  metricsLinkText: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '500' },
  timeRangeRow: { flexDirection: 'row', gap: 6, paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  timeRangePill: { flex: 1, paddingVertical: 12, borderRadius: BORDER_RADIUS.pill, alignItems: 'center', backgroundColor: COLORS.surface, minHeight: 44, justifyContent: 'center' },
  timeRangePillActive: { backgroundColor: COLORS.accent },
  timeRangeText: { fontSize: FONT_SIZES.xs, fontWeight: '600', color: COLORS.textSecondary },
  timeRangeTextActive: { color: COLORS.white },
  healthBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    backgroundColor: 'rgba(255,152,0,0.12)',
    borderRadius: BORDER_RADIUS.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.warning,
  },
  healthBannerText: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZES.xs,
    lineHeight: 16,
  },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: SPACING.md, marginBottom: SPACING.lg },
  kpiCard: { width: '48%', backgroundColor: '#272729', borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
  kpiIcon: { marginBottom: SPACING.sm },
  kpiValue: { fontSize: 24, fontWeight: '700', color: COLORS.white, marginBottom: 4 },
  kpiLabel: { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.63)' },
  section: { paddingHorizontal: SPACING.md, marginBottom: SPACING.lg },
  sectionTitle: { fontSize: FONT_SIZES.lg, fontWeight: '700', color: COLORS.white, marginBottom: SPACING.sm },
  surface: { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  barLabel: { width: 90, fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.63)' },
  barTrack: { flex: 1, height: 8, backgroundColor: '#333', borderRadius: 4, marginHorizontal: 8 },
  barFill: { height: 8, backgroundColor: COLORS.accent, borderRadius: 4 },
  barValue: { width: 40, fontSize: FONT_SIZES.sm, fontWeight: '600', color: COLORS.white, textAlign: 'right' },
  queueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333', gap: 8 },
  queueRowText: { flex: 1, minWidth: 0 },
  queueLabel: { fontSize: FONT_SIZES.md, fontWeight: '500', color: COLORS.white },
  queueSub: { fontSize: FONT_SIZES.xs, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  badge: { fontSize: FONT_SIZES.xs, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  badgeSuccess: { backgroundColor: 'rgba(76,175,80,0.2)', color: '#4CAF50' },
  badgeWarning: { backgroundColor: 'rgba(255,152,0,0.2)', color: '#FF9800' },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: FONT_SIZES.sm, textAlign: 'center', paddingVertical: 12 },
  actionCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
  actionCardDisabled: { opacity: 0.6 },
  actionLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  actionLabel: { fontSize: FONT_SIZES.md, fontWeight: '500', color: COLORS.white },
  actionSubtitle: { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: COLORS.white, marginTop: 16 },
  errorText: { fontSize: FONT_SIZES.md, color: 'rgba(255,255,255,0.63)', marginTop: 8, textAlign: 'center' },
  retryBtn: { marginTop: 20, backgroundColor: COLORS.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: COLORS.white, fontWeight: '600', fontSize: FONT_SIZES.md },
  liveVisitorsHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
  },
  liveVisitorsPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(16,185,129,0.10)', borderColor: 'rgba(16,185,129,0.30)', borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  liveVisitorsPillText: {
    color: '#a7f3d0', fontSize: 11, fontWeight: '700', letterSpacing: 0.2,
  },
  liveVisitorsCaption: {
    color: 'rgba(255,255,255,0.30)', fontSize: 10, marginTop: 6,
  },
});
