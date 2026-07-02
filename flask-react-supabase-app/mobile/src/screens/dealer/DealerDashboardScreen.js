import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatNumber } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const WINDOW_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const TILES = [
  { key: 'active_listings', label: 'Active Listings', icon: 'albums-outline' },
  { key: 'impressions', label: 'Impressions', icon: 'eye-outline' },
  { key: 'detail_views', label: 'Detail Views', icon: 'documents-outline' },
  { key: 'leads', label: 'Leads', icon: 'call-outline' },
  { key: 'lead_conversion_pct', label: 'Lead Conv.', icon: 'trending-up-outline', suffix: '%' },
  { key: 'sold_on_platform', label: 'Sold', icon: 'checkmark-done-outline', accent: true },
];

function AccessDenied({ message }) {
  return (
    <SafeAreaView style={styles.centered}>
      <Ionicons name="lock-closed" size={48} color={COLORS.textMuted} />
      <Text style={styles.deniedTitle}>Dealer access required</Text>
      <Text style={styles.deniedText}>{message || "This area is for verified dealership accounts."}</Text>
    </SafeAreaView>
  );
}

export default function DealerDashboardScreen({ navigation }) {
  const [me, setMe] = useState(null); // null=loading, {is_dealer:false}=denied
  const [tiles, setTiles] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const meRes = await apiClient.get('/api/dealer/me');
      setMe(meRes);
      if (!meRes?.is_dealer) {
        setLoading(false);
        return;
      }
      const kpis = await apiClient.get(`/api/dealer/analytics/kpis?window=${days}`);
      setTiles(kpis?.tiles || {});
    } catch (err) {
      setError(err.message || 'Failed to load dealer dashboard');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner message="Loading dealer dashboard..." />
      </SafeAreaView>
    );
  }

  if (me && !me.is_dealer) {
    return (
      <AccessDenied
        message={me.is_admin ? 'Admins must act as a dealership to view this panel.' : undefined}
      />
    );
  }

  const dealership = me?.dealership || {};
  const verified = dealership.status === 'verified';

  const formatTile = (tile) => {
    const raw = tiles?.[tile.key]?.value;
    if (raw === null || raw === undefined) return '—';
    const num = tile.suffix === '%' ? Number(raw).toFixed(1) : formatNumber(raw);
    return `${num}${tile.suffix || ''}`;
  };

  const formatDelta = (tile) => {
    const d = tiles?.[tile.key]?.delta_pct;
    if (d === null || d === undefined) return null;
    const up = Number(d) >= 0;
    return { up, text: `${up ? '+' : ''}${Number(d).toFixed(1)}%` };
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
      >
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{dealership.name || 'Dealer'}</Text>
          {verified && (
            <View style={styles.verifiedPill}>
              <Ionicons name="checkmark-circle" size={12} color={COLORS.accent} />
              <Text style={styles.verifiedText}>Verified Dealer</Text>
            </View>
          )}
        </View>

        {error ? (
          <View style={styles.section}>
            <View style={styles.surface}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={load}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={styles.windowRow}>
          {WINDOW_OPTIONS.map((opt) => {
            const active = days === opt.days;
            return (
              <TouchableOpacity
                key={opt.label}
                style={[styles.windowPill, active && styles.windowPillActive]}
                onPress={() => setDays(opt.days)}
                activeOpacity={0.7}
              >
                <Text style={[styles.windowText, active && styles.windowTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.kpiGrid}>
          {TILES.map((tile) => {
            const delta = formatDelta(tile);
            return (
              <View key={tile.key} style={styles.kpiCard}>
                <Ionicons name={tile.icon} size={20} color={tile.accent ? COLORS.accent : COLORS.textSecondary} style={{ marginBottom: 8 }} />
                <Text style={[styles.kpiValue, tile.accent && { color: COLORS.accent }]}>{formatTile(tile)}</Text>
                <Text style={styles.kpiLabel}>{tile.label}</Text>
                {delta && (
                  <Text style={[styles.kpiDelta, { color: delta.up ? COLORS.success : COLORS.error }]}>
                    {delta.text}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => navigation.navigate('DealerLeads')}
          activeOpacity={0.7}
        >
          <Ionicons name="people-outline" size={20} color={COLORS.accent} />
          <Text style={styles.linkText}>View leads</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
        </TouchableOpacity>

        <Text style={styles.footNote}>
          Full inventory import, integrations and team management are available on the web dashboard.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  centered: { flex: 1, backgroundColor: COLORS.black, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  deniedTitle: { color: COLORS.white, fontSize: 18, fontWeight: '700', marginTop: 16 },
  deniedText: { color: COLORS.textSecondary, marginTop: 8, textAlign: 'center' },
  scrollContent: { paddingBottom: 40 },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  title: { fontSize: FONT_SIZES.hero, fontWeight: '700', color: COLORS.white },
  verifiedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 6,
    backgroundColor: 'rgba(76,175,80,0.12)', borderColor: 'rgba(76,175,80,0.30)', borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
  },
  verifiedText: { color: COLORS.accent, fontSize: 11, fontWeight: '700' },
  windowRow: { flexDirection: 'row', gap: 6, paddingHorizontal: SPACING.md, marginBottom: SPACING.md },
  windowPill: { flex: 1, paddingVertical: 12, borderRadius: BORDER_RADIUS.pill, alignItems: 'center', backgroundColor: COLORS.surface, minHeight: 44, justifyContent: 'center' },
  windowPillActive: { backgroundColor: COLORS.accent },
  windowText: { fontSize: FONT_SIZES.sm, fontWeight: '600', color: COLORS.textSecondary },
  windowTextActive: { color: COLORS.white },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: SPACING.md, marginBottom: SPACING.lg },
  kpiCard: { width: '48%', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
  kpiValue: { fontSize: 24, fontWeight: '700', color: COLORS.white, marginBottom: 4 },
  kpiLabel: { fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
  kpiDelta: { fontSize: FONT_SIZES.xs, fontWeight: '700', marginTop: 4 },
  section: { paddingHorizontal: SPACING.md, marginBottom: SPACING.lg },
  surface: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg,
    paddingVertical: 14, paddingHorizontal: SPACING.md,
    marginHorizontal: SPACING.md,
  },
  linkText: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
  footNote: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, textAlign: 'center', paddingHorizontal: SPACING.lg, marginTop: SPACING.lg },
  errorText: { color: COLORS.error, fontSize: FONT_SIZES.sm, textAlign: 'center' },
  retryBtn: { marginTop: 12, alignSelf: 'center', backgroundColor: COLORS.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: COLORS.white, fontWeight: '600' },
});
