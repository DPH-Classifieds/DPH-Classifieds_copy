import React, { useEffect, useState, useCallback } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const WINDOW_OPTIONS = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

// Mirrors frontend/src/components/admin/adminUtils.js getEventActorLabel/adminListingRouteType.
const getEventActorLabel = (ev) =>
  ev?.actor_name || ev?.actor_username || ev?.actor_email || (ev?.user_id ? 'Unknown user' : 'Guest');

const ROUTE_TYPE = { car: 'cars', cars: 'cars', bike: 'bikes', bikes: 'bikes', part: 'parts', parts: 'parts', plate: 'plates', plates: 'plates' };

export default function AdminVinOpensScreen({ navigation }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/admin/vin-opens?days=${days}`);
      setData(res || null);
    } catch {
      setData(null);
    }
  }, [days]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const events = Array.isArray(data?.events) ? data.events : [];

  const renderEvent = ({ item: ev }) => {
    const itemType = ROUTE_TYPE[String(ev.listing_type || '').toLowerCase()];
    const title = ev.listing_title || 'Untitled car';
    const Wrapper = itemType && ev.listing_id ? TouchableOpacity : View;
    return (
      <Wrapper
        style={styles.row}
        activeOpacity={0.7}
        {...(itemType && ev.listing_id
          ? { onPress: () => navigation.navigate('AdminListingDetail', { itemType, itemId: ev.listing_id }) }
          : {})}
      >
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.rowTime}>{ev.occurred_at ? new Date(ev.occurred_at).toLocaleString() : '—'}</Text>
        </View>
        <Text style={styles.rowVin}>{ev.vin || '—'}</Text>
        <View style={styles.rowBottom}>
          <View style={styles.actorWrap}>
            <Text style={styles.actorName}>{getEventActorLabel(ev)}</Text>
            {ev.actor_email && <Text style={styles.actorEmail} numberOfLines={1}>{ev.actor_email}</Text>}
          </View>
          {ev.platform && <Text style={styles.platformText}>{ev.platform}</Text>}
        </View>
      </Wrapper>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.windowRow}>
        {WINDOW_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.label}
            style={[styles.windowPill, days === opt.days && styles.windowPillActive]}
            onPress={() => setDays(opt.days)}
            activeOpacity={0.7}
          >
            <Text style={[styles.windowPillText, days === opt.days && styles.windowPillTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <LoadingSpinner message="Loading VIN opens..." />
      ) : (
        <FlatList
          data={events}
          renderItem={renderEvent}
          keyExtractor={(item, idx) => String(item.id || idx)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
          ListHeaderComponent={
            data ? <Text style={styles.countText}>{data.count ?? events.length} events</Text> : null
          }
          ListEmptyComponent={
            <EmptyState icon="key-outline" title="No VIN opens" message="No VIN-open events in this window." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  windowRow: { flexDirection: 'row', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: 8 },
  windowPill: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: BORDER_RADIUS.pill, backgroundColor: COLORS.surface,
  },
  windowPillActive: { backgroundColor: COLORS.primary },
  windowPillText: { fontSize: FONT_SIZES.sm, fontWeight: '600', color: COLORS.textSecondary },
  windowPillTextActive: { color: COLORS.accent },
  listContent: { padding: SPACING.md, paddingBottom: 40 },
  countText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginBottom: SPACING.sm },
  row: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm },
  rowTitle: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
  rowTime: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  rowVin: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs, fontFamily: 'monospace', marginTop: 4 },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.sm },
  actorWrap: { flex: 1 },
  actorName: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  actorEmail: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  platformText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, textTransform: 'capitalize' },
});
