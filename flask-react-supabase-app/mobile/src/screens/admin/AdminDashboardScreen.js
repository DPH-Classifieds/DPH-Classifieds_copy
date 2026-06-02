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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../utils/apiClient';
import { formatNumber } from '../../utils/formatters';
import { swrGet, swrSet } from '../../utils/swrCache';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const QUICK_ACTIONS = [
  { label: 'Review Users', icon: 'people-outline', route: 'AdminUsers' },
  { label: 'Review Listings', icon: 'list-outline', route: 'AdminListings' },
  { label: 'Review Dealers', icon: 'business-outline', route: 'AdminDealers' },
  { label: 'Open Reports', icon: 'flag-outline', route: 'AdminReports' },
  { label: 'View Metrics', icon: 'stats-chart-outline', route: 'AdminMetrics' },
];

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
  const [stats, setStats] = useState({});
  const [leadMetrics, setLeadMetrics] = useState(null);
  const [dealers, setDealers] = useState([]);
  const [reports, setReports] = useState([]);
  const [liveUsers, setLiveUsers] = useState(null);
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

    const loadLive = async () => {
      try {
        const res = await apiClient.get('/api/admin/live-users?window_seconds=300').catch(() => null);
        if (!cancelled) setLiveUsers(res);
      } catch (_) {
        if (!cancelled) setLiveUsers(null);
      }
    };

    const start = () => {
      if (!intervalId) intervalId = setInterval(loadLive, 15000);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

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
        <View style={styles.kpiGrid}>
          <KpiCard icon="calendar" label="Days Since Launch" value={formatNumber(daysSinceLaunch)} color="#4CAF50" />
          <KpiCard icon="people" label="Total Users" value={formatNumber(totalUsers)} color={COLORS.accent} />
          <KpiCard icon="car" label="Total Cars" value={formatNumber(clamp(stats.cars_total))} color={COLORS.accent} />
          <KpiCard icon="bicycle" label="Total Bikes" value={formatNumber(clamp(stats.bikes_total))} color={COLORS.accent} />
          <KpiCard icon="construct" label="Total Parts" value={formatNumber(clamp(stats.parts_total))} color={COLORS.accent} />
          <KpiCard icon="key" label="Total Plates" value={formatNumber(clamp(stats.plates_total))} color={COLORS.accent} />
          <KpiCard icon="call" label="Total Leads" value={formatNumber(totalLeads)} color={COLORS.accent} />
          <KpiCard icon="logo-whatsapp" label={`Unique WhatsApp (${selectedRangeLabel})`} value={formatNumber(totalWhatsapp)} color={COLORS.accent} />
          <KpiCard icon="phone-portrait" label={`Unique Callers (${selectedRangeLabel})`} value={formatNumber(totalCalls)} color={COLORS.accent} />
          <KpiCard icon="eye" label="Total Views" value={formatNumber(totalViews)} color={COLORS.accent} />
          <KpiCard
            icon="globe-outline"
            label={`Site Visitors (${selectedRangeLabel})`}
            value={formatNumber(uniqueVisitors)}
            color={COLORS.accent}
          />
          <KpiCard icon="time" label="Pending Approvals" value={formatNumber(pendingApprovals)} color={COLORS.warning} />
          <KpiCard icon="flag" label="Reports" value={formatNumber(totalReports)} color={COLORS.error} />
          <KpiCard icon="radio" label="Live Users" value={formatNumber(liveVisitorsCount)} color={COLORS.accent} />
          <KpiCard icon="business" label="Verified Dealers" value={`${formatNumber(verifiedDealers)}/${formatNumber(totalDealers)}`} color={COLORS.accent} />
        </View>

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
                <View>
                  <Text style={styles.queueLabel}>{item.label}</Text>
                  <Text style={styles.queueSub}>Listings waiting for moderation</Text>
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
                    <View>
                      <Text style={styles.queueLabel}>{name}</Text>
                      <Text style={styles.queueSub}>{company}</Text>
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
                  <View>
                    <Text style={styles.queueLabel}>{(report.listing_type || 'listing').toUpperCase()} - {report.reason || 'Report'}</Text>
                    <Text style={styles.queueSub}>{report.details || report.status || 'Pending review'}</Text>
                  </View>
                  <Text style={[styles.badge, styles.badgeWarning]}>{report.status || 'pending'}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>External Analytics</Text>
          <ExternalAnalyticsCard
            title="Open GA4 Dashboard"
            subtitle="Active users, sessions, conversions"
            icon="stats-chart-outline"
            envVarName="EXPO_PUBLIC_GA4_MEASUREMENT_ID"
            // Without a property number we can only deep-link to the property
            // picker — that's still useful (one click to the right account).
            url="https://analytics.google.com/analytics/web/"
            enabled={!!process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID}
          />
          <ExternalAnalyticsCard
            title="Open Clarity Dashboard"
            subtitle="Heatmaps and session recordings"
            icon="eye-outline"
            envVarName="EXPO_PUBLIC_CLARITY_PROJECT_ID"
            url={process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID
              ? `https://clarity.microsoft.com/projects/view/${process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID}/dashboard`
              : 'https://clarity.microsoft.com'}
            enabled={!!process.env.EXPO_PUBLIC_CLARITY_PROJECT_ID}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          {QUICK_ACTIONS.map((action, index) => (
            <TouchableOpacity
              key={index}
              style={styles.actionCard}
              onPress={() => navigation.navigate(action.route)}
              activeOpacity={0.7}
            >
              <View style={styles.actionLeft}>
                <Ionicons name={action.icon} size={20} color={COLORS.white} />
                <Text style={styles.actionLabel}>{action.label}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ExternalAnalyticsCard({ title, subtitle, icon, envVarName, url, enabled }) {
  const handlePress = () => {
    if (!enabled) {
      Alert.alert(
        'Configure analytics',
        `Set ${envVarName} in mobile/.env, then rebuild. See docs/ANALYTICS_SETUP.md.`,
      );
      return;
    }
    Linking.openURL(url).catch(() => {
      Alert.alert('Could not open', 'No browser available to open the dashboard.');
    });
  };

  return (
    <TouchableOpacity
      style={[styles.actionCard, !enabled && styles.actionCardDisabled]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.actionLeft}>
        <Ionicons name={icon} size={20} color={enabled ? COLORS.accent : COLORS.textMuted} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.actionLabel, !enabled && { color: COLORS.textMuted }]}>{title}</Text>
          <Text style={styles.actionSubtitle}>
            {enabled ? subtitle : `Add ${envVarName} to env`}
          </Text>
        </View>
      </View>
      <Ionicons name="open-outline" size={18} color={enabled ? COLORS.textSecondary : COLORS.textMuted} />
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
  timeRangeRow: { flexDirection: 'row', gap: 6, paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  timeRangePill: { flex: 1, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, alignItems: 'center', backgroundColor: COLORS.surface },
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
  sectionTitle: { fontSize: FONT_SIZES.lg, fontWeight: '700', color: COLORS.white, marginBottom: SPACING.sm, paddingHorizontal: SPACING.sm },
  surface: { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  barLabel: { width: 90, fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.63)' },
  barTrack: { flex: 1, height: 8, backgroundColor: '#333', borderRadius: 4, marginHorizontal: 8 },
  barFill: { height: 8, backgroundColor: COLORS.accent, borderRadius: 4 },
  barValue: { width: 40, fontSize: FONT_SIZES.sm, fontWeight: '600', color: COLORS.white, textAlign: 'right' },
  queueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333' },
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
});
