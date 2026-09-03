import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { timeAgo } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const METHOD_CHIPS = ['All', 'GET', 'POST', 'PATCH', 'DELETE'];

export default function AdminDealerAuditLogScreen({ route }) {
  const { colors } = useTheme();
  const METHOD_COLOR = { GET: colors.info, POST: colors.success, PATCH: colors.warning, DELETE: colors.error };

  const statusColor = (code) => {
    const n = Number(code);
    if (!n) return colors.textMuted;
    if (n >= 500) return colors.error;
    if (n >= 400) return colors.warning;
    if (n >= 200) return colors.success;
    return colors.textSecondary;
  };

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.black },
    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      marginHorizontal: SPACING.md, marginTop: SPACING.sm,
      backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.md,
      paddingHorizontal: SPACING.md, paddingVertical: 10,
    },
    searchInput: { flex: 1, color: colors.white, fontSize: FONT_SIZES.sm },
    filterBar: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: 8 },
    filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: BORDER_RADIUS.pill, backgroundColor: colors.surface },
    filterChipActive: { backgroundColor: colors.primary },
    filterChipText: { fontSize: FONT_SIZES.xs, fontWeight: '600', color: colors.textSecondary },
    filterChipTextActive: { color: colors.accent },
    listContent: { padding: SPACING.md, paddingBottom: 40 },
    countText: { color: colors.textMuted, fontSize: FONT_SIZES.xs, marginBottom: SPACING.sm },
    row: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    methodBadge: { borderWidth: 1, borderRadius: BORDER_RADIUS.sm, paddingHorizontal: 6, paddingVertical: 2 },
    methodBadgeText: { fontSize: 9, fontWeight: '700' },
    statusText: { fontSize: FONT_SIZES.xs, fontFamily: 'monospace' },
    timeText: { marginLeft: 'auto', color: colors.textMuted, fontSize: FONT_SIZES.xs },
    endpointText: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, fontFamily: 'monospace', marginTop: 6 },
    rowBottom: { flexDirection: 'row', gap: SPACING.md, marginTop: 6, flexWrap: 'wrap' },
    adminText: { color: colors.white, fontSize: FONT_SIZES.xs },
    dealershipText: { color: colors.accent, fontSize: FONT_SIZES.xs },
    ipText: { color: colors.textMuted, fontSize: FONT_SIZES.xs, fontFamily: 'monospace' },
  }), [colors]);

  const dealershipId = route?.params?.dealershipId || null;
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('All');

  const fetchData = useCallback(async () => {
    try {
      const q = dealershipId ? `?dealership_id=${dealershipId}` : '';
      const res = await apiClient.get(`/api/admin/dealer-audit-log${q}`);
      setRows(res?.audit || []);
    } catch {
      setRows([]);
    }
  }, [dealershipId]);

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
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchSearch =
        !q ||
        (r.endpoint || '').toLowerCase().includes(q) ||
        (r.admin?.email || '').toLowerCase().includes(q) ||
        (r.admin?.first_name || '').toLowerCase().includes(q);
      const matchMethod = methodFilter === 'All' || (r.http_method || '').toUpperCase() === methodFilter;
      return matchSearch && matchMethod;
    });
  }, [rows, search, methodFilter]);

  const renderRow = ({ item: r }) => (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={[styles.methodBadge, { borderColor: METHOD_COLOR[r.http_method] || colors.borderLight }]}>
          <Text style={[styles.methodBadgeText, { color: METHOD_COLOR[r.http_method] || colors.textMuted }]}>
            {r.http_method || '—'}
          </Text>
        </View>
        <Text style={[styles.statusText, { color: statusColor(r.result_status) }]}>{r.result_status || '—'}</Text>
        <Text style={styles.timeText}>{timeAgo(r.created_at)}</Text>
      </View>
      <Text style={styles.endpointText} numberOfLines={1}>{r.endpoint || '—'}</Text>
      <View style={styles.rowBottom}>
        <Text style={styles.adminText} numberOfLines={1}>
          {r.admin?.first_name || r.admin?.email || '—'}
        </Text>
        {r.dealership?.name && <Text style={styles.dealershipText} numberOfLines={1}>{r.dealership.name}</Text>}
        {r.ip_address && <Text style={styles.ipText}>{r.ip_address}</Text>}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search endpoint, admin email..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>
      <View style={styles.filterBar}>
        {METHOD_CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip}
            style={[styles.filterChip, methodFilter === chip && styles.filterChipActive]}
            onPress={() => setMethodFilter(chip)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterChipText, methodFilter === chip && styles.filterChipTextActive]}>{chip}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <LoadingSpinner message="Loading audit log..." />
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderRow}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            rows ? (
              <Text style={styles.countText}>
                {filtered.length} {filtered.length === 1 ? 'event' : 'events'}
                {dealershipId ? ' · filtered by dealership' : ''}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState icon="shield-outline" title="No audit events" message="No audit events yet." />
          }
        />
      )}
    </SafeAreaView>
  );
}

