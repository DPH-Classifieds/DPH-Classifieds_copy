import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import Text from '../../components/ui/AppText';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatNumber } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { resolveMediaUrl } from '../../utils/media';
import PressableScale from '../../components/ui/PressableScale';
import { LayoutToggleButton } from '../../components/ui/ListHeader';
import { useGridColumns } from '../../hooks/useGridColumns';
import { prefetchListing } from '../../utils/listingCache';
import { toastApiError } from '../../utils/toast';

const DETAIL_SCREENS = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };
const CATEGORY_LABEL = { cars: 'CAR', bikes: 'BIKE', plates: 'PLATE', parts: 'PART' };
const ENDPOINTS = [['cars', '/api/cars'], ['bikes', '/api/bikes'], ['plates', '/api/plates'], ['parts', '/api/parts']];
const TYPES = [
  { label: 'All', key: 'all' },
  { label: 'Cars', key: 'cars' },
  { label: 'Bikes', key: 'bikes' },
  { label: 'Plates', key: 'plates' },
  { label: 'Parts', key: 'parts' },
];
const PRICE_RANGES = [
  { label: 'All', min: 0, max: 0 },
  { label: 'Under 50k', min: 0, max: 50000 },
  { label: '50k–100k', min: 50000, max: 100000 },
  { label: '100k–200k', min: 100000, max: 200000 },
  { label: '200k+', min: 200000, max: 0 },
];
const SORTS = [
  { label: 'Newest', key: 'newest' },
  { label: 'Oldest', key: 'oldest' },
  { label: 'Price ↑', key: 'price-low' },
  { label: 'Price ↓', key: 'price-high' },
];

const imageOf = (raw) => {
  const arr = raw.images || raw.car_images || raw.bike_images || raw.part_images || [];
  if (Array.isArray(arr) && arr.length) {
    const first = arr[0];
    return resolveMediaUrl(typeof first === 'string' ? first : first.url || first.image_url || first.display_url);
  }
  return resolveMediaUrl(raw.image_url || raw.display_url || null);
};

const normalize = (category, raw) => {
  if (category === 'cars') {
    return {
      id: raw.id, category,
      title: `${raw.car_manufacturer || ''} ${raw.car_model || ''}`.trim() || raw.listing_title || 'Car',
      subtitle: [raw.make_year, raw.kilometer_driven ? `${formatNumber(raw.kilometer_driven)} km` : null, raw.regional_spec !== 'Unspecified' ? raw.regional_spec : null].filter(Boolean).join(' · '),
      price: raw.expected_selling_price, image: imageOf(raw), created_at: raw.created_at, raw,
    };
  }
  if (category === 'bikes') {
    return {
      id: raw.id, category,
      title: `${raw.bike_brand || ''} ${raw.bike_model || ''}`.trim() || 'Bike',
      subtitle: [raw.year, raw.engine_size ? `${raw.engine_size} cc` : null].filter(Boolean).join(' · '),
      price: raw.price, image: imageOf(raw), created_at: raw.created_at, raw,
    };
  }
  if (category === 'plates') {
    return {
      id: raw.id, category,
      title: [raw.city, raw.code, raw.number].filter(Boolean).join(' ') || 'Plate',
      subtitle: raw.plate_format || '', price: raw.price, image: imageOf(raw), created_at: raw.created_at, raw,
    };
  }
  return {
    id: raw.id, category,
    title: raw.name || raw.part_type || 'Part',
    subtitle: [raw.condition, raw.part_type].filter(Boolean).join(' · '),
    price: raw.price, image: imageOf(raw), created_at: raw.created_at, raw,
  };
};

export default function RedditListScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [priceRange, setPriceRange] = useState(PRICE_RANGES[0]);
  const [sort, setSort] = useState('newest');
  const [type, setType] = useState('all');
  const { columns, toggleColumns } = useGridColumns();

  const load = useCallback(async () => {
    const results = await Promise.all(
      ENDPOINTS.map(([cat, ep]) =>
        apiClient
          .get(`${ep}?source_platform=reddit&limit=30&order=created_at.desc`)
          .catch(() => [])
          .then((res) => (Array.isArray(res) ? res : res?.[cat] || res?.data || []).map((r) => normalize(cat, r)))
      )
    );
    setItems(results.flat());
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        await load();
      } catch (err) {
        toastApiError(err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } catch (err) { toastApiError(err); } finally { setRefreshing(false); }
  }, [load]);

  const visible = useMemo(() => {
    const ts = (d) => (d ? new Date(d).getTime() : 0);
    let list = items.filter((it) => {
      if (type !== 'all' && it.category !== type) return false;
      const p = Number(it.price) || 0;
      if (priceRange.min && p < priceRange.min) return false;
      if (priceRange.max && p > priceRange.max) return false;
      return true;
    });
    if (sort === 'price-low') list = [...list].sort((a, b) => (a.price || 0) - (b.price || 0));
    else if (sort === 'price-high') list = [...list].sort((a, b) => (b.price || 0) - (a.price || 0));
    else if (sort === 'oldest') list = [...list].sort((a, b) => ts(a.created_at) - ts(b.created_at));
    else list = [...list].sort((a, b) => ts(b.created_at) - ts(a.created_at)); // newest
    return list;
  }, [items, type, priceRange, sort]);

  const renderItem = useCallback(({ item }) => (
    <PressableScale
      onPress={() => { prefetchListing(item.category, item.raw); navigation.navigate(DETAIL_SCREENS[item.category], { listingId: item.id }); }}
      haptic="light"
      style={styles.cardWrap}
    >
      <View style={styles.card}>
        <View style={styles.imageWrap}>
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.image} contentFit="cover" />
          ) : (
            <View style={styles.imagePlaceholder}><Ionicons name="pricetag" size={28} color="rgba(255,255,255,0.2)" /></View>
          )}
          {CATEGORY_LABEL[item.category] ? (
            <View style={styles.categoryBadge}><Text style={styles.categoryBadgeText}>{CATEGORY_LABEL[item.category]}</Text></View>
          ) : null}
          <View style={styles.redditBadge}><Text style={styles.redditBadgeText}>Reddit</Text></View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          {!!item.subtitle && <Text style={styles.cardSubtitle} numberOfLines={1}>{item.subtitle}</Text>}
          <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>
        </View>
      </View>
    </PressableScale>
  ), [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reddit Listings</Text>
        <LayoutToggleButton columns={columns} onToggle={toggleColumns} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filtersContent}>
        {TYPES.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => setType(t.key)} style={[styles.chip, type === t.key && styles.chipActive]}>
            <Text style={[styles.chipText, type === t.key && styles.chipTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.divider} />
        {PRICE_RANGES.map((r) => (
          <TouchableOpacity key={r.label} onPress={() => setPriceRange(r)} style={[styles.chip, priceRange.label === r.label && styles.chipActive]}>
            <Text style={[styles.chipText, priceRange.label === r.label && styles.chipTextActive]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
        <View style={styles.divider} />
        {SORTS.map((s) => (
          <TouchableOpacity key={s.key} onPress={() => setSort(s.key)} style={[styles.chip, sort === s.key && styles.chipActive]}>
            <Text style={[styles.chipText, sort === s.key && styles.chipTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.accent} /></View>
      ) : visible.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="logo-reddit" size={44} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>No Reddit listings found.</Text>
        </View>
      ) : (
        <FlashList
          key={`cols-${columns}`}
          data={visible}
          keyExtractor={(it) => `${it.category}-${it.id}`}
          renderItem={renderItem}
          numColumns={columns}
          estimatedItemSize={columns === 2 ? 240 : 320}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  backBtn: { width: 24, alignItems: 'flex-start' },
  headerTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.lg, fontWeight: '700' },
  filters: { flexGrow: 0, maxHeight: 52 },
  filtersContent: { paddingHorizontal: SPACING.md, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  chipTextActive: { color: COLORS.background },
  divider: { width: 1, height: 22, backgroundColor: COLORS.border, marginHorizontal: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: COLORS.textMuted, fontSize: FONT_SIZES.md },
  listContent: { padding: SPACING.sm },
  cardWrap: { flex: 1, padding: 6 },
  card: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  imageWrap: { aspectRatio: 4 / 3, backgroundColor: COLORS.surfaceDark },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  redditBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: '#ff4500', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  redditBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  categoryBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(5,16,10,0.72)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  categoryBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cardBody: { padding: 10, gap: 3 },
  cardTitle: { color: COLORS.textPrimary, fontSize: FONT_SIZES.md, fontWeight: '700' },
  cardSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.sm },
  cardPrice: { color: COLORS.accent, fontSize: FONT_SIZES.md, fontWeight: '800', marginTop: 2 },
});
