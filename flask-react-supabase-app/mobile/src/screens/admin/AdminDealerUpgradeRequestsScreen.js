import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import apiClient from '../../utils/apiClient';
import { toastApiError } from '../../utils/toast';
import { formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const FILTERS = ['pending', 'approved', 'rejected', 'cancelled'];

const dealerLabel = (dealer) => {
  if (!dealer) return 'Unknown dealer';
  return dealer.legal_business_name || dealer.company_name || dealer.email || dealer.id;
};

// Mirrors frontend/src/components/admin/AdminDealerUpgradeRequests.jsx — the
// piece of the web Dealerships Hub's "Limit requests" tab that mobile was
// entirely missing (dealers had no way to be approved for a higher listing
// cap from the app).
export default function AdminDealerUpgradeRequestsScreen({ onResolved }) {
  const { colors } = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [busyId, setBusyId] = useState(null);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
    filterChip: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill,
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    },
    filterChipActive: { backgroundColor: 'rgba(139,214,180,0.16)', borderColor: colors.accent },
    filterChipText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: colors.textSecondary, textTransform: 'capitalize' },
    filterChipTextActive: { color: colors.accent },
    listContent: { padding: SPACING.md, paddingBottom: 40 },
    card: {
      backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md,
      marginBottom: SPACING.sm, borderWidth: 1, borderColor: colors.border,
    },
    dealerLabel: { ...FONTS.semibold, fontSize: FONT_SIZES.md, color: colors.textPrimary },
    dealerSub: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: colors.textMuted, marginTop: 2 },
    limitLine: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: colors.textSecondary, marginTop: 8 },
    limitValue: { ...FONTS.semibold, color: colors.textPrimary },
    reason: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: colors.textSecondary, marginTop: 6 },
    meta: { ...FONTS.regular, fontSize: 11, color: colors.textMuted, marginTop: 8 },
    actions: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
    approveBtn: { flex: 1, paddingVertical: 10, borderRadius: BORDER_RADIUS.md, backgroundColor: colors.accent, alignItems: 'center' },
    approveBtnText: { ...FONTS.bold, fontSize: FONT_SIZES.xs, color: colors.black },
    rejectBtn: { flex: 1, paddingVertical: 10, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    rejectBtnText: { ...FONTS.semibold, fontSize: FONT_SIZES.xs, color: colors.textSecondary },
    statusPill: { alignSelf: 'flex-start', marginTop: SPACING.sm, paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.pill, borderWidth: 1, borderColor: colors.border },
    statusPillText: { ...FONTS.medium, fontSize: FONT_SIZES.xs, color: colors.textSecondary, textTransform: 'capitalize' },
  }), [colors]);

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get(`/api/admin/dealer/listing-upgrade-requests?status=${filter}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      toastApiError(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const decide = async (row, decision) => {
    setBusyId(row.id);
    try {
      await apiClient.post(`/api/admin/dealer/listing-upgrade-requests/${row.id}/decision`, {
        decision,
        new_limit: decision === 'approve' ? row.requested_limit : undefined,
      });
      await load();
      onResolved?.();
    } catch (err) {
      toastApiError(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(f)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <LoadingSpinner message="Loading requests…" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListEmptyComponent={<EmptyState icon="trending-up-outline" title={`No ${filter} requests`} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.dealerLabel}>{dealerLabel(item.dealer)}</Text>
              <Text style={styles.dealerSub} numberOfLines={1}>{item.dealer?.email || item.dealer_id}</Text>
              <Text style={styles.limitLine}>
                Current <Text style={styles.limitValue}>{item.current_limit}</Text> → Requested{' '}
                <Text style={styles.limitValue}>{item.requested_limit}</Text>
              </Text>
              {!!item.reason && <Text style={styles.reason}>{item.reason}</Text>}
              <Text style={styles.meta} numberOfLines={1}>
                Submitted {formatDate(item.created_at)}
                {item.resolved_at ? ` · Resolved ${formatDate(item.resolved_at)}` : ''}
              </Text>

              {item.status === 'pending' ? (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.approveBtn}
                    disabled={busyId === item.id}
                    onPress={() => decide(item, 'approve')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.approveBtnText}>Approve ({item.requested_limit})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    disabled={busyId === item.id}
                    onPress={() => decide(item, 'reject')}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>{item.status}</Text>
                </View>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

