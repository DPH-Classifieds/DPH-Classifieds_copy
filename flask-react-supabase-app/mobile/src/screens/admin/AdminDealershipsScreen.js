import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { timeAgo } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const STATUS_CHIPS = ['All', 'Active', 'Suspended'];
const STATUS_COLOR = { active: COLORS.success, suspended: COLORS.error };

export default function AdminDealershipsScreen({ navigation }) {
  const [dealerships, setDealerships] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/admin/dealerships');
      setDealerships(res?.dealerships || []);
    } catch {
      setDealerships([]);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const filtered = useMemo(() => {
    if (!dealerships) return [];
    const q = search.trim().toLowerCase();
    return dealerships.filter((d) => {
      const matchSearch = !q || (d.name || '').toLowerCase().includes(q) || (d.slug || '').toLowerCase().includes(q);
      const matchStatus = statusFilter === 'All' || (d.status || '').toLowerCase() === statusFilter.toLowerCase();
      return matchSearch && matchStatus;
    });
  }, [dealerships, search, statusFilter]);

  const renderDealership = ({ item: d }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.8}
      onPress={() => navigation.navigate('AdminDealershipDetail', { dealershipId: d.id })}
    >
      <View style={styles.cardTop}>
        <Text style={styles.name} numberOfLines={1}>{d.name || '—'}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[d.status] || COLORS.warning }]}>
          <Text style={styles.statusBadgeText}>{d.status || '—'}</Text>
        </View>
      </View>
      <Text style={styles.slug}>{d.slug || '—'}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{d.emirate || '—'}</Text>
        <Text style={styles.metaText}>{d.phone || '—'}</Text>
        <Text style={styles.metaText}>{timeAgo(d.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or slug..."
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <View style={styles.filterBar}>
        {STATUS_CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip}
            style={[styles.filterChip, statusFilter === chip && styles.filterChipActive]}
            onPress={() => setStatusFilter(chip)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterChipText, statusFilter === chip && styles.filterChipTextActive]}>{chip}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <LoadingSpinner message="Loading dealerships..." />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderDealership}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
          ListFooterComponent={
            <TouchableOpacity
              style={styles.auditLogLink}
              onPress={() => navigation.navigate('AdminDealerAuditLog')}
              activeOpacity={0.7}
            >
              <Ionicons name="shield-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.auditLogLinkText}>View global audit log</Text>
              <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <EmptyState icon="business-outline" title="No dealerships" message="No dealerships match your filters." />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: SPACING.md, marginTop: SPACING.sm,
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.sm },
  filterBar: { flexDirection: 'row', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  filterChipActive: { backgroundColor: COLORS.primary },
  filterChipText: { fontSize: FONT_SIZES.xs, fontWeight: '600', color: COLORS.textSecondary },
  filterChipTextActive: { color: COLORS.accent },
  listContent: { padding: SPACING.md, paddingBottom: 40 },
  card: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACING.sm },
  name: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm },
  statusBadgeText: { color: COLORS.black, fontSize: FONT_SIZES.xs, fontWeight: '600', textTransform: 'capitalize' },
  slug: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, fontFamily: 'monospace', marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.sm },
  metaText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.xs },
  auditLogLink: {
    flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center',
    paddingVertical: SPACING.md,
  },
  auditLogLinkText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
});
