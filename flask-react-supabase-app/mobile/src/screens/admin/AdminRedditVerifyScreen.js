import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, FlatList, TouchableOpacity, Image, Linking, StyleSheet, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const FIELD_LABELS = {
  car_manufacturer: 'Make', car_model: 'Model', make_year: 'Year',
  expected_selling_price: 'Price', regional_spec: 'Regional spec', fuel_type: 'Fuel',
  transmission_type: 'Transmission', horsepower: 'Horsepower', steering_side: 'Steering',
  body_type: 'Body type',
  bike_brand: 'Make', bike_model: 'Model', year: 'Year', price: 'Price',
  condition: 'Condition', bike_type: 'Type', location: 'Location',
  name: 'Name', part_type: 'Part type', number: 'Plate number', code: 'Code', city: 'City',
};

const TYPE_LABEL = { car: 'Car', bike: 'Bike', part: 'Part', plate: 'Plate' };
const SOURCE_LABEL = { vin: 'VIN', description: 'desc', title: 'title', post: 'post', default: 'default' };

const fmtValue = (key, value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'expected_selling_price' || key === 'price') {
    const n = Number(value);
    return Number.isFinite(n) ? `AED ${n.toLocaleString()}` : String(value);
  }
  return String(value);
};

export default function AdminRedditVerifyScreen({ navigation }) {
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.black },
    listContent: { padding: SPACING.md, paddingBottom: 40 },
    kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.md },
    kpiCard: {
      flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.lg, padding: SPACING.md,
    },
    kpiValue: { color: colors.white, fontSize: FONT_SIZES.xxl, fontWeight: '700' },
    kpiLabel: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, marginTop: 4 },
    filterPill: {
      alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8,
      borderRadius: BORDER_RADIUS.pill, backgroundColor: colors.surface,
      borderWidth: 1, borderColor: colors.borderLight, marginBottom: SPACING.md,
    },
    filterPillActive: { backgroundColor: 'rgba(255,152,0,0.15)', borderColor: 'rgba(255,152,0,0.3)' },
    filterPillText: { color: colors.textSecondary, fontSize: FONT_SIZES.xs, fontWeight: '600' },
    filterPillTextActive: { color: colors.warning },
    card: { backgroundColor: colors.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm },
    cardTop: { flexDirection: 'row', gap: SPACING.sm },
    thumbWrap: { width: 96, height: 72 },
    thumb: { width: 96, height: 72, borderRadius: BORDER_RADIUS.md },
    thumbEmpty: { backgroundColor: colors.surfaceHigher, alignItems: 'center', justifyContent: 'center' },
    photoCountBadge: {
      position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.7)',
      borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
    },
    photoCountText: { color: colors.white, fontSize: 9 },
    cardInfo: { flex: 1, minWidth: 0 },
    badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
    typeBadge: { backgroundColor: colors.surfaceHigher, borderRadius: BORDER_RADIUS.sm, paddingHorizontal: 6, paddingVertical: 2 },
    typeBadgeText: { color: colors.textSecondary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
    statusBadge: { borderRadius: BORDER_RADIUS.sm, paddingHorizontal: 6, paddingVertical: 2 },
    statusBadgeText: { fontSize: 9, fontWeight: '700' },
    cardTitle: { color: colors.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
    cardPrice: { color: colors.accent, fontSize: FONT_SIZES.sm, fontWeight: '700', marginTop: 2 },
    fieldGrid: { marginTop: SPACING.sm, gap: 4 },
    fieldRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      borderBottomWidth: 1, borderBottomColor: colors.borderLight, paddingBottom: 4,
    },
    fieldLabel: { color: colors.textMuted, fontSize: FONT_SIZES.xs },
    fieldValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    fieldValue: { color: colors.white, fontSize: FONT_SIZES.xs },
    fieldValueMissing: { color: colors.warning },
    fieldValueMuted: { color: colors.textMuted },
    sourceTag: { backgroundColor: colors.surfaceHigher, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
    sourceTagText: { color: colors.textMuted, fontSize: 8, fontWeight: '600' },
    cardActions: {
      flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginTop: SPACING.sm,
      paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.borderLight,
    },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    linkBtnText: { color: colors.accent, fontSize: FONT_SIZES.xs, fontWeight: '600' },
    authorText: { marginLeft: 'auto', color: colors.textMuted, fontSize: FONT_SIZES.xs },
  }), [colors]);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/admin/reddit-listings');
      setData(res || null);
    } catch {
      setData(null);
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

  const summary = data?.summary || { total: 0, hidden: 0, incomplete: 0, with_vin: 0 };
  const kpis = [
    { label: 'Total imported', value: summary.total },
    { label: 'Hidden from site', value: summary.hidden },
    { label: 'Incomplete fields', value: summary.incomplete },
    { label: 'Has VIN', value: summary.with_vin },
  ];

  const listings = useMemo(() => {
    const rows = Array.isArray(data?.listings) ? data.listings : [];
    return onlyIncomplete ? rows.filter((l) => (l.missing_fields || []).length > 0) : rows;
  }, [data, onlyIncomplete]);

  const renderListing = ({ item: l }) => {
    const missing = new Set(l.missing_fields || []);
    const entries = Object.entries(l.fields || {});
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.thumbWrap}>
            {l.images?.[0] ? (
              <Image source={{ uri: l.images[0] }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]}>
                <Ionicons name="image-outline" size={20} color="rgba(255,255,255,0.25)" />
              </View>
            )}
            {l.images?.length > 1 && (
              <View style={styles.photoCountBadge}>
                <Text style={styles.photoCountText}>{l.images.length} photos</Text>
              </View>
            )}
          </View>
          <View style={styles.cardInfo}>
            <View style={styles.badgeRow}>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{TYPE_LABEL[l.listing_type] || l.listing_type}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: l.is_approved ? colors.success : colors.surfaceHigher }]}>
                <Text style={[styles.statusBadgeText, { color: l.is_approved ? colors.black : colors.textSecondary }]}>
                  {l.is_approved ? 'Shown' : 'Hidden'}
                </Text>
              </View>
              {missing.size > 0 ? (
                <View style={[styles.statusBadge, { backgroundColor: 'rgba(255,152,0,0.15)' }]}>
                  <Text style={[styles.statusBadgeText, { color: colors.warning }]}>{missing.size} missing</Text>
                </View>
              ) : (
                <View style={[styles.statusBadge, { backgroundColor: 'rgba(139,214,180,0.15)' }]}>
                  <Text style={[styles.statusBadgeText, { color: colors.accent }]}>Complete</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardTitle} numberOfLines={1}>{l.title}</Text>
            <Text style={styles.cardPrice}>{fmtValue('price', l.price)}</Text>
          </View>
        </View>

        <View style={styles.fieldGrid}>
          {entries.map(([key, value]) => (
            <View key={key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{FIELD_LABELS[key] || key}</Text>
              <View style={styles.fieldValueWrap}>
                {l.field_sources?.[key] && !missing.has(key) && (
                  <View style={styles.sourceTag}>
                    <Text style={styles.sourceTagText}>{SOURCE_LABEL[l.field_sources[key]] || l.field_sources[key]}</Text>
                  </View>
                )}
                <Text style={[styles.fieldValue, missing.has(key) && styles.fieldValueMissing]}>
                  {missing.has(key) ? 'Missing' : fmtValue(key, value)}
                </Text>
              </View>
            </View>
          ))}
          {l.listing_type === 'car' && (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>VIN</Text>
              <Text style={[styles.fieldValue, !l.vin_number && styles.fieldValueMuted]}>
                {l.vin_number || 'Not decoded yet'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.cardActions}>
          {l.source_url && (
            <TouchableOpacity onPress={() => Linking.openURL(l.source_url)} style={styles.linkBtn}>
              <Ionicons name="logo-reddit" size={14} color={colors.accent} />
              <Text style={styles.linkBtnText}>Reddit post</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => navigation.navigate('AdminListingDetail', { itemType: `${l.listing_type}s`, itemId: l.id })}
            style={styles.linkBtn}
          >
            <Ionicons name="open-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.linkBtnText, { color: colors.textSecondary }]}>Admin detail</Text>
          </TouchableOpacity>
          {l.source_author && <Text style={styles.authorText}>u/{l.source_author}</Text>}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {loading ? (
        <LoadingSpinner message="Loading Reddit listings..." />
      ) : (
        <FlatList
          data={listings}
          renderItem={renderListing}
          keyExtractor={(item) => `${item.listing_type}-${item.id}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            <View>
              <View style={styles.kpiGrid}>
                {kpis.map((k) => (
                  <View key={k.label} style={styles.kpiCard}>
                    <Text style={styles.kpiValue}>{k.value}</Text>
                    <Text style={styles.kpiLabel}>{k.label}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.filterPill, onlyIncomplete && styles.filterPillActive]}
                onPress={() => setOnlyIncomplete((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterPillText, onlyIncomplete && styles.filterPillTextActive]}>
                  {onlyIncomplete ? 'Showing incomplete only' : 'Show incomplete only'}
                </Text>
              </TouchableOpacity>
            </View>
          }
          ListEmptyComponent={
            <EmptyState icon="logo-reddit" title="No Reddit listings" message="Nothing to verify in this view." />
          }
        />
      )}
    </SafeAreaView>
  );
}

