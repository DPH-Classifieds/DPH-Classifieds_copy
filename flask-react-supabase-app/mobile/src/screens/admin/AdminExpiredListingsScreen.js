import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Image, RefreshControl, ScrollView } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatDate } from '../../utils/formatters';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

// ── Constants ──────────────────────────────────────────────────────────────

const TYPE_TABS  = ['All', 'Cars', 'Bikes', 'Parts', 'Plates'];
const TYPE_KEYS  = { All: 'all', Cars: 'cars', Bikes: 'bikes', Parts: 'parts', Plates: 'plates' };
const REASON_CHIPS = [
  { label: 'All',            key: 'all' },
  { label: 'Auto-expired',   key: 'auto_expired' },
  { label: 'User deleted',   key: 'user_deleted' },
  { label: 'Admin deleted',  key: 'admin_deleted' },
  { label: 'Sold on DPH',    key: 'sold_on_dph' },
  { label: 'Sold elsewhere', key: 'sold_elsewhere' },
  { label: 'No response',    key: 'no_response' },
];
const DAY_OPTIONS = [7, 30, 90];

const REASON_COLORS = {
  'Sold on DPH':                '#4CAF50',
  'Sold elsewhere':             '#FF9800',
  'Renewed (not sold)':         '#2196F3',
  'User deleted':               '#9E9E9E',
  'Admin deleted':              '#F44336',
  'Auto-expired':               '#FF6F00',
  'Auto-removed (past retention)': '#E65100',
  'Expired — no response':      '#c62828',
};

// ── Sub-components ─────────────────────────────────────────────────────────

function ExpiredListingCard({ item, onPress, colors, styles }) {
  const imageUri = item.image_url || null;
  const reasonColor = REASON_COLORS[item.expiry_reason] || '#9E9E9E';
  const displayDate = item.deleted_at || item.expired_at;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardContent}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.thumbnail} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={24} color="rgba(255,255,255,0.2)" />
          </View>
        )}
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
          {item.price ? (
            <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>
          ) : null}
          <View style={styles.reasonRow}>
            <View style={[styles.reasonBadge, { backgroundColor: reasonColor + '26' }]}>
              <Text style={[styles.reasonText, { color: reasonColor }]}>{item.expiry_reason}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            {item.email_interacted ? (
              <View style={styles.emailChip}>
                <Ionicons name="mail-open-outline" size={11} color="#4CAF50" />
                <Text style={[styles.emailChipText, { color: '#4CAF50' }]}>Email opened</Text>
              </View>
            ) : item.renewal_nudge_count > 0 ? (
              <View style={styles.emailChip}>
                <Ionicons name="mail-outline" size={11} color="rgba(255,255,255,0.4)" />
                <Text style={[styles.emailChipText, { color: 'rgba(255,255,255,0.4)' }]}>
                  ×{item.renewal_nudge_count} sent, not opened
                </Text>
              </View>
            ) : null}
            {displayDate ? (
              <Text style={styles.metaDate}>{formatDate(displayDate)}</Text>
            ) : null}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

export default function AdminExpiredListingsScreen({ navigation }) {
  const { colors } = useTheme();
  const [listings, setListings]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [typeFilter, setTypeFilter]   = useState('all');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [days, setDays]               = useState(30);
  const [offset, setOffset]           = useState(0);
  const [hasMore, setHasMore]         = useState(false);
  const [error, setError]             = useState('');

  const styles = useMemo(() => StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.background },
    tabRow:        { maxHeight: 44, flexGrow: 0 },
    chipRow:       { maxHeight: 40, flexGrow: 0 },
    tabRowContent: { paddingHorizontal: SPACING.sm, gap: 6, paddingVertical: 6 },
    tab:           { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1c1c1e' },
    tabActive:     { backgroundColor: colors.accent },
    tabText:       { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
    tabTextActive: { color: colors.background, fontWeight: '700' },
    chip:          { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: '#2a2a2a' },
    chipActive:    { backgroundColor: '#2a2a2a', borderColor: colors.accent },
    chipText:      { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },
    chipTextActive:{ color: colors.textPrimary, fontWeight: '700' },
    dayRow:        { flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
    dayBtn:        { flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1c1c1e', alignItems: 'center' },
    dayBtnActive:  { backgroundColor: colors.accent },
    dayBtnText:    { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
    dayBtnTextActive: { color: colors.background, fontWeight: '700' },
    card:          { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, marginHorizontal: SPACING.md, marginVertical: 4, padding: SPACING.sm },
    cardContent:   { flexDirection: 'row', gap: SPACING.sm },
    thumbnail:     { width: 60, height: 60, borderRadius: BORDER_RADIUS.md },
    thumbPlaceholder: { backgroundColor: '#2a2a2a', justifyContent: 'center', alignItems: 'center' },
    cardInfo:      { flex: 1, justifyContent: 'center' },
    cardTitle:     { color: colors.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '600' },
    cardPrice:     { color: colors.accent, fontSize: FONT_SIZES.sm, marginTop: 2 },
    reasonRow:     { flexDirection: 'row', marginTop: 4 },
    reasonBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BORDER_RADIUS.sm },
    reasonText:    { fontSize: 10, fontWeight: '700' },
    metaRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
    emailChip:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
    emailChipText: { fontSize: 10 },
    metaDate:      { fontSize: 10, color: 'rgba(255,255,255,0.3)' },
    centerWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
    loadingText:   { color: 'rgba(255,255,255,0.4)', fontSize: FONT_SIZES.md },
    emptyText:     { color: 'rgba(255,255,255,0.3)', fontSize: FONT_SIZES.md, textAlign: 'center', marginTop: 12 },
    errorText:     { color: colors.error, fontSize: FONT_SIZES.md, textAlign: 'center', marginTop: 12 },
    retryBtn:      { marginTop: 16, backgroundColor: colors.accent, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
    retryText:     { color: colors.background, fontWeight: '600' },
    loadMoreBtn:   { margin: SPACING.md, padding: SPACING.sm, backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, alignItems: 'center' },
    loadMoreText:  { color: colors.accent, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  }), [colors]);

  const load = useCallback(async (reset = true) => {
    try {
      if (reset) setLoading(true);
      setError('');
      const currentOffset = reset ? 0 : offset;
      const data = await apiClient.get('/api/admin/expired-listings', {
        params: { type: typeFilter, reason: reasonFilter, days, limit: 50, offset: currentOffset },
      });
      const fetched = data?.listings || [];
      if (reset) {
        setListings(fetched);
        setOffset(50);
      } else {
        setListings(prev => [...prev, ...fetched]);
        setOffset(prev => prev + 50);
      }
      setHasMore(data?.has_more || false);
    } catch (err) {
      setError(err?.message || 'Failed to load expired listings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [typeFilter, reasonFilter, days, offset]);

  useEffect(() => { load(true); }, [typeFilter, reasonFilter, days]);

  const onRefresh = () => { setRefreshing(true); load(true); };
  const onLoadMore = () => { if (hasMore && !loading) load(false); };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={styles.tabRowContent}>
        {TYPE_TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, typeFilter === TYPE_KEYS[tab] && styles.tabActive]}
            onPress={() => setTypeFilter(TYPE_KEYS[tab])}
          >
            <Text style={[styles.tabText, typeFilter === TYPE_KEYS[tab] && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.tabRowContent}>
        {REASON_CHIPS.map(chip => (
          <TouchableOpacity
            key={chip.key}
            style={[styles.chip, reasonFilter === chip.key && styles.chipActive]}
            onPress={() => setReasonFilter(chip.key)}
          >
            <Text style={[styles.chipText, reasonFilter === chip.key && styles.chipTextActive]}>{chip.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.dayRow}>
        {DAY_OPTIONS.map(d => (
          <TouchableOpacity
            key={d}
            style={[styles.dayBtn, days === d && styles.dayBtnActive]}
            onPress={() => setDays(d)}
          >
            <Text style={[styles.dayBtnText, days === d && styles.dayBtnTextActive]}>{d}d</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={styles.centerWrap}>
          <Ionicons name="alert-circle-outline" size={32} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => load(true)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading && listings.length === 0 ? (
        <View style={styles.centerWrap}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : listings.length === 0 ? (
        <View style={styles.centerWrap}>
          <Ionicons name="checkmark-circle-outline" size={40} color="rgba(255,255,255,0.2)" />
          <Text style={styles.emptyText}>No expired listings match this filter.</Text>
        </View>
      ) : (
        <FlashList
          data={listings}
          estimatedItemSize={100}
          keyExtractor={item => `${item.listing_type}-${item.id}`}
          renderItem={({ item }) => (
            <ExpiredListingCard
              item={item}
              onPress={() => navigation.navigate('AdminListingDetail', { itemType: item.listing_type, itemId: item.id })}
              colors={colors}
              styles={styles}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={hasMore ? (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={onLoadMore}>
              <Text style={styles.loadMoreText}>Load more</Text>
            </TouchableOpacity>
          ) : null}
        />
      )}
    </SafeAreaView>
  );
}

