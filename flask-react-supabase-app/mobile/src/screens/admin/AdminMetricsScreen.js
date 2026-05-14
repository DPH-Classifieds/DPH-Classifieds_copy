import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatNumber } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const WINDOW_OPTIONS = [7, 30, 90];

const formatPercent = (value) => {
  const n = Number(value ?? 0);
  return `${Number.isFinite(n) ? n.toFixed(2) : '0.00'}%`;
};

const formatDecimal = (value, digits = 2) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(digits) : `0.${'0'.repeat(digits)}`;
};

const formatMoney = (value) =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(value ?? 0));

function MetricRow({ label, value, note }) {
  return (
    <View style={styles.metricRow}>
      <View style={styles.metricLeft}>
        <Text style={styles.metricLabel}>{label}</Text>
        {note ? <Text style={styles.metricNote}>{note}</Text> : null}
      </View>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function SectionHeader({ label, title, subtitle }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function BarChart({ items, labelKey = 'segment', valueKey = 'views' }) {
  if (!items || items.length === 0) {
    return <Text style={styles.emptyText}>No data yet</Text>;
  }
  const maxValue = Math.max(1, ...items.map((item) => Number(item?.[valueKey] || 0)));
  return (
    <View style={styles.barChart}>
      {items.map((item) => (
        <View key={`${item[labelKey]}-${item[valueKey]}`} style={styles.chartRow}>
          <Text style={styles.chartLabel}>{item[labelKey]}</Text>
          <View style={styles.chartTrack}>
            <View style={[styles.chartFill, { width: `${Math.max(4, (Number(item[valueKey] || 0) / maxValue) * 100)}%` }]} />
          </View>
          <Text style={styles.chartValue}>{formatNumber(item[valueKey])}</Text>
        </View>
      ))}
    </View>
  );
}

export default function AdminMetricsScreen() {
  const [metrics, setMetrics] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  useEffect(() => { loadMetrics(); }, [days]);
  useEffect(() => { loadHealth(); }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      setError('');
      const data = await apiClient.get(`/api/admin/metrics/overview?days=${days}`);
      setMetrics(data || null);
    } catch (err) {
      setError(err.message || 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  };

  const loadHealth = async () => {
    try {
      const data = await apiClient.get('/api/admin/health');
      setHealth(data || null);
    } catch {
      setHealth(null);
    }
  };

  const userMetrics = metrics?.user_metrics || {};
  const financialMetrics = metrics?.financial_metrics || {};
  const carMetrics = metrics?.car_metrics || {};
  const plateMetrics = metrics?.plate_metrics || {};
  const rawCounts = metrics?.raw_counts || {};

  const healthCurrent = health?.current || null;
  const healthLatest = health?.latest || null;
  const healthSnapshot = healthCurrent || healthLatest || null;
  const healthComponents = healthSnapshot?.details || {};

  const healthLabel = (component) => {
    if (!component) return 'Unknown';
    return component.ok ? 'Healthy' : (component.status || 'Degraded').toUpperCase();
  };

  const healthIsOk = healthSnapshot?.overall_status === 'healthy';

  const repeatRate = userMetrics.repeat_purchase_rate_percent ?? userMetrics.repeat_visit_rate_percent;
  const topPages = userMetrics.top_pages || [];
  const trafficSources = userMetrics.traffic_sources || [];
  const dailyTrends = userMetrics.daily_trends || [];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <Text style={styles.loadingText}>Loading platform metrics...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle" size={40} color={COLORS.error} />
          <Text style={styles.errorTitle}>Metrics Unavailable</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadMetrics}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.windowRow}>
          {WINDOW_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.windowBtn, days === option && styles.windowBtnActive]}
              onPress={() => setDays(option)}
            >
              <Text style={[styles.windowBtnText, days === option && styles.windowBtnTextActive]}>
                Last {option} days
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <SectionHeader label="PLATFORM HEALTH" title="Frontend, backend, Redis, and worker status" subtitle="Live health snapshot updated every 30 minutes." />

        <View style={styles.healthGrid}>
          <View style={[styles.healthCard, { borderLeftColor: healthIsOk ? '#4CAF50' : '#FF9800' }]}>
            <Ionicons name={healthIsOk ? 'checkmark-circle' : 'warning'} size={20} color={healthIsOk ? '#4CAF50' : '#FF9800'} />
            <View style={styles.healthInfo}>
              <Text style={styles.healthLabel}>Overall</Text>
              <Text style={[styles.healthValue, { color: healthIsOk ? '#4CAF50' : '#FF9800' }]}>
                {(healthSnapshot?.overall_status || 'unknown').toUpperCase()}
              </Text>
              <Text style={styles.healthSub}>
                {healthSnapshot?.checked_at ? `Checked ${new Date(healthSnapshot.checked_at).toLocaleString()}` : 'No snapshot yet'}
              </Text>
            </View>
          </View>
          {['frontend', 'backend', 'redis', 'worker'].map((key) => {
            const comp = healthComponents[key];
            const ok = comp?.ok;
            return (
              <View key={key} style={[styles.healthCard, { borderLeftColor: ok ? '#4CAF50' : ok === false ? '#FF9800' : '#666' }]}>
                <Ionicons name={ok ? 'checkmark-circle' : ok === false ? 'warning' : 'help-circle'} size={16} color={ok ? '#4CAF50' : ok === false ? '#FF9800' : '#666'} />
                <View style={styles.healthInfo}>
                  <Text style={styles.healthLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
                  <Text style={[styles.healthValue, { fontSize: 14, color: ok ? '#4CAF50' : ok === false ? '#FF9800' : '#999' }]}>
                    {healthLabel(comp)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <SectionHeader label="SUMMARY" title="Key metrics at a glance" subtitle={`Platform analytics for the last ${days} days.`} />

        <View style={styles.summaryGrid}>
          <SummaryCard label="Sessions" value={formatNumber(userMetrics.sessions)} />
          <SummaryCard label="Page Views" value={formatNumber(userMetrics.page_views)} />
          <SummaryCard label="Bounce Rate" value={formatPercent(userMetrics.bounce_rate_percent)} />
          <SummaryCard label="Conversions" value={formatNumber(userMetrics.conversion_sessions)} />
          <SummaryCard label="GMV" value={formatMoney(financialMetrics.gross_merchandise_value)} />
          <SummaryCard label="Avg Price" value={formatMoney(financialMetrics.average_listing_price)} />
          <SummaryCard label="New Users" value={formatNumber(financialMetrics.new_users)} />
          <SummaryCard label="Unique Sellers" value={formatNumber(financialMetrics.unique_sellers)} />
          <SummaryCard label="Listings/Seller" value={formatDecimal(financialMetrics.listings_per_seller_avg)} />
          <SummaryCard label="LTV" value={formatMoney(financialMetrics.estimated_ltv)} />
          <SummaryCard label="CAC" value={financialMetrics.estimated_cac == null ? 'N/A' : formatMoney(financialMetrics.estimated_cac)} />
          <SummaryCard label="Events" value={formatNumber(rawCounts.events)} />
        </View>

        <SectionHeader label="USER METRICS" title="Engagement and retention" subtitle="How users interact with the platform." />

        <View style={styles.surface}>
          <MetricRow label="Repeat Rate" value={formatPercent(repeatRate)} />
          <MetricRow label="Avg Time on Site" value={`${formatDecimal((userMetrics.avg_time_on_site_seconds || 0) / 3600)}h`} />
          <MetricRow label="Pages / Session" value={formatDecimal(userMetrics.avg_pages_per_session || 0)} />
          <MetricRow label="Conversion Rate" value={formatPercent(userMetrics.conversion_rate_percent || 0)} />
        </View>

        <Text style={styles.subSectionTitle}>Cohort Retention</Text>
        <View style={styles.surface}>
          <MetricRow label="Day 1" value={formatPercent(userMetrics.cohort_retention?.day_1 || 0)} />
          <MetricRow label="Day 7" value={formatPercent(userMetrics.cohort_retention?.day_7 || 0)} />
          <MetricRow label="Day 30" value={formatPercent(userMetrics.cohort_retention?.day_30 || 0)} />
        </View>

        <Text style={styles.subSectionTitle}>Traffic Sources</Text>
        <View style={styles.surface}>
          {trafficSources.length === 0 ? (
            <Text style={styles.emptyText}>No traffic source data yet.</Text>
          ) : (
            trafficSources.map((item) => (
              <MetricRow key={item.source} label={item.source} value={formatNumber(item.sessions)} />
            ))
          )}
        </View>

        {topPages.length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Top Pages</Text>
            <View style={styles.surface}>
              <BarChart items={topPages.map((p) => ({ segment: p.page_path, views: p.views }))} />
            </View>
          </>
        )}

        {dailyTrends.length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Daily Activity</Text>
            <View style={styles.surface}>
              <BarChart items={dailyTrends.slice(-12).map((d) => ({ segment: d.date, views: d.sessions }))} />
            </View>
          </>
        )}

        <SectionHeader label="CAR METRICS" title="Car demand, pricing, and segments" subtitle="Which vehicle segments get the most attention." />

        <View style={styles.surface}>
          <MetricRow label="Total Car Listings" value={formatNumber(carMetrics.total_listings)} />
          {carMetrics.most_viewed_segment && (
            <MetricRow label="Most Viewed Segment" value={`${carMetrics.most_viewed_segment.segment || 'Unknown'} (${formatNumber(carMetrics.most_viewed_segment.views || 0)})`} />
          )}
        </View>

        {carMetrics.segment_views?.length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Segment Views</Text>
            <View style={styles.surface}>
              <BarChart items={carMetrics.segment_views} />
            </View>
          </>
        )}

        {carMetrics.price_bands?.length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Price Distribution</Text>
            <View style={styles.surface}>
              <BarChart items={carMetrics.price_bands.map((b) => ({ segment: b.band, views: b.count }))} />
            </View>
          </>
        )}

        {carMetrics.top_listings?.length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Top Car Listings</Text>
            <View style={styles.surface}>
              {carMetrics.top_listings.slice(0, 5).map((item) => (
                <MetricRow key={item.title} label={item.title} value={`${formatNumber(item.views)} views`} note={item.price ? formatMoney(item.price) : ''} />
              ))}
            </View>
          </>
        )}

        <SectionHeader label="PLATE METRICS" title="Plate demand and pricing intelligence" subtitle="Which plate types and cities are most in demand." />

        <View style={styles.surface}>
          <MetricRow label="Total Plate Listings" value={formatNumber(plateMetrics.total_listings)} />
          {plateMetrics.most_in_demand && (
            <MetricRow label="Most In Demand" value={`${plateMetrics.most_in_demand.segment || 'Unknown'} (${formatNumber(plateMetrics.most_in_demand.views || 0)})`} />
          )}
        </View>

        {plateMetrics.segment_views?.length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Demand by Plate Segment</Text>
            <View style={styles.surface}>
              <BarChart items={plateMetrics.segment_views} />
            </View>
          </>
        )}

        {plateMetrics.price_bands?.length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Plate Price Distribution</Text>
            <View style={styles.surface}>
              <BarChart items={plateMetrics.price_bands.map((b) => ({ segment: b.band, views: b.count }))} />
            </View>
          </>
        )}

        {plateMetrics.top_listings?.length > 0 && (
          <>
            <Text style={styles.subSectionTitle}>Top Plate Listings</Text>
            <View style={styles.surface}>
              {plateMetrics.top_listings.slice(0, 5).map((item) => (
                <MetricRow key={item.title} label={item.title} value={`${formatNumber(item.views)} views`} note={item.price ? formatMoney(item.price) : ''} />
              ))}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryCard({ label, value }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md },
  content: { padding: SPACING.md },
  errorWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  errorTitle: { fontSize: 20, fontWeight: '700', color: COLORS.white, marginTop: 16 },
  errorText: { fontSize: FONT_SIZES.md, color: 'rgba(255,255,255,0.63)', marginTop: 8, textAlign: 'center' },
  retryBtn: { marginTop: 20, backgroundColor: COLORS.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: COLORS.white, fontWeight: '600', fontSize: FONT_SIZES.md },
  windowRow: { flexDirection: 'row', gap: 8, marginBottom: SPACING.md },
  windowBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#272729', alignItems: 'center' },
  windowBtnActive: { backgroundColor: COLORS.accent },
  windowBtnText: { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.63)', fontWeight: '500' },
  windowBtnTextActive: { color: COLORS.white, fontWeight: '700' },
  sectionHeader: { marginBottom: SPACING.sm, marginTop: SPACING.md },
  sectionLabel: { fontSize: FONT_SIZES.xs, fontWeight: '600', color: COLORS.accent, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  sectionTitle: { fontSize: FONT_SIZES.lg, fontWeight: '700', color: COLORS.white },
  sectionSubtitle: { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.53)', marginTop: 2 },
  subSectionTitle: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.white, marginTop: SPACING.md, marginBottom: 4, paddingHorizontal: 4 },
  surface: { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
  healthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.sm },
  healthCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, padding: 12, borderLeftWidth: 3, gap: 10, minWidth: '47%', flex: 1 },
  healthInfo: { flex: 1 },
  healthLabel: { fontSize: FONT_SIZES.xs, color: 'rgba(255,255,255,0.53)' },
  healthValue: { fontSize: 16, fontWeight: '700', color: COLORS.white, marginTop: 2 },
  healthSub: { fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.sm },
  summaryCard: { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, padding: 12, width: '30%', minWidth: 90 },
  summaryLabel: { fontSize: 10, color: 'rgba(255,255,255,0.53)', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 16, fontWeight: '700', color: COLORS.white, marginTop: 4 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333' },
  metricLeft: { flex: 1, marginRight: 12 },
  metricLabel: { fontSize: FONT_SIZES.md, color: COLORS.white },
  metricNote: { fontSize: FONT_SIZES.xs, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  metricValue: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.white },
  barChart: { gap: 6 },
  chartRow: { flexDirection: 'row', alignItems: 'center' },
  chartLabel: { width: 90, fontSize: 10, color: 'rgba(255,255,255,0.63)' },
  chartTrack: { flex: 1, height: 6, backgroundColor: '#333', borderRadius: 3, marginHorizontal: 6 },
  chartFill: { height: 6, backgroundColor: COLORS.accent, borderRadius: 3 },
  chartValue: { width: 36, fontSize: 10, fontWeight: '600', color: COLORS.white, textAlign: 'right' },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: FONT_SIZES.sm, textAlign: 'center', paddingVertical: 12 },
});
