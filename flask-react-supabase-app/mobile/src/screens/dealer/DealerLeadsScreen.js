import React, { useState, useEffect, useCallback } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const PAGE_SIZE = 50;

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'test_drive', label: 'Test Drive' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

const STATUS_COLORS = {
  new: COLORS.info,
  contacted: COLORS.warning,
  quoted: '#9c27b0',
  test_drive: '#00bcd4',
  won: COLORS.success,
  lost: COLORS.error,
};

const SOURCE_ICON = {
  call: 'call-outline',
  whatsapp: 'logo-whatsapp',
  vin_open: 'eye-outline',
  vin_reveal: 'eye-outline',
  form: 'document-text-outline',
};

const relTime = (iso) => {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function DealerLeadsScreen({ navigation }) {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchLeads = useCallback(async (nextOffset = 0, replace = true) => {
    try {
      setError('');
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
      if (status) params.set('status', status);
      const res = await apiClient.get(`/api/dealer/leads?${params.toString()}`);
      const rows = Array.isArray(res?.leads) ? res.leads : [];
      const totalNum = Number(res?.total);
      setTotal(Number.isFinite(totalNum) && totalNum > 0 ? totalNum : (nextOffset + rows.length));
      setOffset(nextOffset);
      // A full page implies there may be more — don't rely on `total`, which is
      // null when PostgREST omits content-range (that stalled pagination at page 1).
      setHasMore(rows.length === PAGE_SIZE);
      setLeads((prev) => {
        if (replace) return rows;
        const seen = new Set(prev.map((l) => l.id));
        return [...prev, ...rows.filter((l) => !seen.has(l.id))];
      });
    } catch (err) {
      if (err.status === 403) setError('This account is not linked to a dealership.');
      else setError(err.message || 'Failed to load leads');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [status]);

  useEffect(() => {
    setLoading(true);
    fetchLeads(0, true);
  }, [fetchLeads]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchLeads(0, true);
  }, [fetchLeads]);

  const onEndReached = () => {
    if (loadingMore || loading || refreshing || !hasMore) return;
    setLoadingMore(true);
    fetchLeads(offset + PAGE_SIZE, false);
  };

  const renderItem = ({ item }) => {
    const color = STATUS_COLORS[item.status] || COLORS.textMuted;
    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('DealerLeadDetail', { leadId: item.id })}
      >
        <View style={styles.sourceIcon}>
          <Ionicons name={SOURCE_ICON[item.source] || 'person-outline'} size={18} color={COLORS.accent} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {(item.listing_type || 'listing').toUpperCase()} · {String(item.listing_id || '').slice(0, 8)}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {item.event_count || 1} touch{(item.event_count || 1) === 1 ? '' : 'es'} · {relTime(item.last_event_at)}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${color}22` }]}>
          <Text style={[styles.statusText, { color }]}>{item.status || 'new'}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterContent}
      >
        {STATUS_FILTERS.map((f) => {
          const active = status === f.key;
          return (
            <TouchableOpacity
              key={f.key || 'all'}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setStatus(f.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading && leads.length === 0 ? (
        <LoadingSpinner message="Loading leads..." />
      ) : error && leads.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle" size={40} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); fetchLeads(0, true); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={leads}
          renderItem={renderItem}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            total > 0 ? <Text style={styles.totalText}>{total} lead{total === 1 ? '' : 's'}</Text> : null
          }
          ListEmptyComponent={
            <EmptyState icon="people-outline" title="No leads yet" message="Buyer interest on your listings shows up here." />
          }
          ListFooterComponent={loadingMore ? <Text style={styles.footerText}>Loading…</Text> : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  filterBar: { maxHeight: 56, flexGrow: 0 },
  filterContent: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, backgroundColor: COLORS.surface, marginRight: 8 },
  chipActive: { backgroundColor: COLORS.accent },
  chipText: { fontSize: FONT_SIZES.sm, fontWeight: '600', color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.background },
  listContent: { paddingHorizontal: SPACING.md, paddingBottom: 40 },
  totalText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginBottom: SPACING.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md, marginBottom: SPACING.sm,
  },
  sourceIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(76,175,80,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
  rowSub: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: FONT_SIZES.xs, fontWeight: '700' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  errorText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, marginTop: 12, textAlign: 'center' },
  retryBtn: { marginTop: 16, backgroundColor: COLORS.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: COLORS.background, fontWeight: '600' },
  footerText: { color: COLORS.textMuted, textAlign: 'center', paddingVertical: 16 },
});
