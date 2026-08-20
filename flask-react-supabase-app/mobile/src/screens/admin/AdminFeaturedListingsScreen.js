import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { toastApiError, showSuccess } from '../../utils/toast';
import { formatDate } from '../../utils/formatters';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import ListingPickerModal from '../../components/ui/ListingPickerModal';
import FeatureListingModal from '../../components/ui/FeatureListingModal';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, FONTS } from '../../constants/theme';

const TYPE_LABELS = { car: 'Car', bike: 'Bike', plate: 'Plate', part: 'Part' };

const isExpired = (until) => !!until && new Date(until).getTime() <= Date.now();

function FeaturedRow({ row, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const expired = isExpired(row.featured_until);

  const remove = async () => {
    setBusy(true);
    try {
      await apiClient.delete(`/api/admin/featured-listings/${row.id}`);
      onRemoved(row.id);
    } catch (err) {
      toastApiError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{TYPE_LABELS[row.listing_type] || row.listing_type}</Text>
        </View>
        <Text style={styles.rowTitle} numberOfLines={1}>{row.title}</Text>
        {expired && (
          <View style={styles.expiredBadge}>
            <Text style={styles.expiredBadgeText}>Expired</Text>
          </View>
        )}
      </View>
      <Text style={styles.rowId} numberOfLines={1}>{row.listing_id}</Text>
      <Text style={styles.rowMeta} numberOfLines={2}>
        Featured {formatDate(row.featured_at)}
        {row.featured_until ? ` · until ${formatDate(row.featured_until)}` : ' · no expiry'}
        {row.note ? ` · "${row.note}"` : ''}
      </Text>
      {row.listing?.is_approved === false && (
        <Text style={styles.notApproved}>Listing not approved</Text>
      )}
      <TouchableOpacity style={styles.removeBtn} onPress={remove} disabled={busy} activeOpacity={0.7}>
        <Ionicons name="close-circle-outline" size={16} color={busy ? COLORS.textMuted : COLORS.error} />
        <Text style={[styles.removeText, busy && { color: COLORS.textMuted }]}>{busy ? 'Removing…' : 'Remove'}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function AdminFeaturedListingsScreen() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickedListing, setPickedListing] = useState(null);

  const load = useCallback(async () => {
    try {
      const url = showInactive
        ? '/api/admin/featured-listings?include_inactive=1'
        : '/api/admin/featured-listings';
      const data = await apiClient.get(url);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      toastApiError(err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => !isExpired(r.featured_until));
    return { active: active.length, total: rows.length };
  }, [rows]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerCount}>{stats.active} active · {stats.total - stats.active} expired</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowPicker(true)} activeOpacity={0.8}>
          <Ionicons name="star" size={14} color={COLORS.black} />
          <Text style={styles.addBtnText}>Feature a listing</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.toggleRow} onPress={() => setShowInactive((s) => !s)} activeOpacity={0.7}>
        <Ionicons name={showInactive ? 'checkbox' : 'square-outline'} size={18} color={showInactive ? COLORS.accent : COLORS.textMuted} />
        <Text style={styles.toggleText}>Show expired</Text>
      </TouchableOpacity>

      {loading ? (
        <LoadingSpinner message="Loading featured listings…" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => String(r.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
          renderItem={({ item }) => (
            <FeaturedRow row={item} onRemoved={(id) => setRows((prev) => prev.filter((r) => r.id !== id))} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="star-outline"
              title="No featured listings yet"
              actionLabel="Feature your first listing"
              onAction={() => setShowPicker(true)}
            />
          }
        />
      )}

      <ListingPickerModal
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(picked) => { setShowPicker(false); setPickedListing(picked); }}
      />

      <FeatureListingModal
        visible={!!pickedListing}
        listingType={pickedListing?.listingType}
        listingId={pickedListing?.listingId}
        title={pickedListing?.title}
        onClose={() => setPickedListing(null)}
        onCreated={(r) => {
          setPickedListing(null);
          setRows((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.black },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SPACING.md, paddingTop: SPACING.sm,
  },
  headerCount: { ...FONTS.regular, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 14, paddingVertical: 8,
  },
  addBtnText: { ...FONTS.bold, fontSize: FONT_SIZES.xs, color: COLORS.black },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  toggleText: { ...FONTS.medium, fontSize: FONT_SIZES.sm, color: COLORS.textSecondary },
  listContent: { padding: SPACING.md, paddingBottom: 40 },
  row: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md,
    marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BORDER_RADIUS.sm, backgroundColor: COLORS.surfaceHigher },
  typeBadgeText: { ...FONTS.label, fontSize: 10, color: COLORS.textMuted },
  rowTitle: { flex: 1, ...FONTS.semibold, fontSize: FONT_SIZES.md, color: COLORS.white },
  expiredBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BORDER_RADIUS.sm, backgroundColor: 'rgba(244,67,54,0.15)' },
  expiredBadgeText: { ...FONTS.semibold, fontSize: 10, color: COLORS.error },
  rowId: { ...FONTS.regular, fontSize: 11, color: COLORS.textMuted, marginBottom: 4 },
  rowMeta: { ...FONTS.regular, fontSize: FONT_SIZES.xs, color: COLORS.textSecondary, marginBottom: 8 },
  notApproved: { ...FONTS.medium, fontSize: 10, color: COLORS.warning, marginBottom: 8 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  removeText: { ...FONTS.semibold, fontSize: FONT_SIZES.xs, color: COLORS.error },
});
