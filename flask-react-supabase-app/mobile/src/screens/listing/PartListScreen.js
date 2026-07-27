import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import SearchBar from '../../components/ui/SearchBar';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { resolveMediaUrl } from '../../utils/media';
import { prefetchListingWindow } from '../../utils/listingCache';
import { swrGet, swrSet } from '../../utils/swrCache';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { toastApiError } from '../../utils/toast';

const CONDITION_OPTIONS = ['New', 'Used', 'Refurbished'];
const PART_TYPES = [
  'Engine', 'Transmission', 'Brakes', 'Suspension', 'Exhaust', 'Electrical',
  'Body Parts', 'Interior', 'Wheels & Tires', 'Lighting', 'Performance',
  'Accessories', 'Tools', 'Other',
];

const SORT_OPTIONS = [
  { label: 'Newest', order: 'created_at.desc' },
  { label: 'Oldest', order: 'created_at.asc' },
  { label: 'Price: Low to High', order: 'price.asc' },
  { label: 'Price: High to Low', order: 'price.desc' },
];

const PAGE_SIZE = 15;

// SWR: cache only the default (unfiltered, unsearched) first page for instant return.
const LIST_CACHE_KEY = 'parts:list:default';
const LIST_CACHE_TTL = 120;
const isDefaultView = (filters, searchVal) =>
  !searchVal &&
  !Object.entries(filters).some(([k, v]) => (k === 'sort' ? v && v !== 'Newest' : v !== '' && v !== null));

const CONDITION_VARIANT = { New: 'success', Used: 'warning', Refurbished: 'info' };

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

function PartCard({ item, index, onPress }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const imageUri = getImageUri(item);
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress}>
        <View style={styles.card}>
          <View style={styles.cardImageContainer}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.cardImage} contentFit="cover" />
            ) : (
              <View style={styles.cardImagePlaceholder}>
                <Ionicons name="construct" size={32} color="rgba(255,255,255,0.2)" />
              </View>
            )}
          </View>
          <View style={styles.cardBody}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.part_type || item.brand || 'Part'}</Text>
              {item.condition && (
                <Badge label={item.condition} variant={CONDITION_VARIANT[item.condition] || 'default'} size="sm" />
              )}
            </View>
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {item.brand}{item.model ? ` ${item.model}` : ''}
            </Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function PartListScreen({ navigation }) {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [filterModal, setFilterModal] = useState(null);
  const [activeFilters, setActiveFilters] = useState({ condition: '', partType: '', sort: 'Newest' });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const buildQuery = useCallback((pageNum, searchVal, filters) => {
    let params = [`page=${pageNum}`, `per_page=${PAGE_SIZE}`];
    const sortOpt = SORT_OPTIONS.find((s) => s.label === filters.sort) || SORT_OPTIONS[0];
    params.push(`order=${encodeURIComponent(sortOpt.order)}`);
    if (searchVal) params.push(`search=${encodeURIComponent(searchVal)}`);
    if (filters.condition) params.push(`condition=${encodeURIComponent(filters.condition)}`);
    if (filters.partType) params.push(`part_type=${encodeURIComponent(filters.partType)}`);
    return `/api/parts?${params.join('&')}`;
  }, []);

  const fetchParts = useCallback(async (pageNum = 1, searchVal = '', filters = activeFilters, isRefresh = false, silent = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1 && !silent) setLoading(true);
      else if (pageNum !== 1) setLoadingMore(true);

      const data = await apiClient.get(buildQuery(pageNum, searchVal, filters));
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.parts || data?.listings || data?.data || []);
      if (pageNum === 1) {
        setParts(items);
        if (isDefaultView(filters, searchVal)) swrSet(LIST_CACHE_KEY, items, LIST_CACHE_TTL);
      } else setParts(prev => [...prev, ...items]);
      setHasMore(items.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (err) {
      toastApiError(err);
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
    }
  }, [buildQuery, activeFilters]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await swrGet(LIST_CACHE_KEY, LIST_CACHE_TTL);
      const hasCached = !!cached?.value?.length;
      if (!cancelled && hasCached) { setParts(cached.value); setLoading(false); }
      if (!cancelled) fetchParts(1, '', activeFilters, false, hasCached);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = useCallback((text) => {
    setSearch(text);
    setParts([]);
    setPage(1);
    setHasMore(true);
    fetchParts(1, text, activeFilters);
  }, [fetchParts, activeFilters]);

  const handleRefresh = useCallback(() => fetchParts(1, search, activeFilters, true), [fetchParts, search, activeFilters]);
  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) fetchParts(page + 1, search, activeFilters);
  }, [fetchParts, page, search, loadingMore, hasMore, activeFilters]);

  const applyFilter = (key, value) => {
    const newFilters = { ...activeFilters, [key]: value };
    setActiveFilters(newFilters);
    setFilterModal(null);
    setParts([]);
    setPage(1);
    setHasMore(true);
    fetchParts(1, search, newFilters);
  };

  const clearFilters = () => {
    const cleared = { condition: '', partType: '', sort: 'Newest' };
    setActiveFilters(cleared);
    setFilterModal(null);
    setParts([]);
    setPage(1);
    setHasMore(true);
    fetchParts(1, search, cleared);
  };

  const hasActiveFilters = Object.entries(activeFilters).some(([k, v]) => {
    if (k === 'sort') return v && v !== 'Newest';
    return v !== '';
  });

  const renderFilterChip = (label, key, isActive) => (
    <TouchableOpacity
      key={key}
      style={[styles.filterChip, isActive && styles.filterChipActive]}
      onPress={() => setFilterModal(key)}
    >
      <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{label}</Text>
      <Ionicons name="chevron-down" size={14} color={isActive ? COLORS.accent : COLORS.textMuted} />
    </TouchableOpacity>
  );

  const renderFilterModal = () => {
    if (!filterModal) return null;
    let options = [];
    let title = '';

    if (filterModal === 'sort') {
      title = 'Sort By';
      options = SORT_OPTIONS.map((s) => s.label);
    } else if (filterModal === 'condition') {
      title = 'Condition';
      options = ['All', ...CONDITION_OPTIONS];
    } else if (filterModal === 'partType') {
      title = 'Part Type';
      options = ['All', ...PART_TYPES];
    }

    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => setFilterModal(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFilterModal(null)}>
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{title}</Text>
              <TouchableOpacity onPress={() => setFilterModal(null)}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalOptions}>
              {options.map((opt) => {
                const isSelected = activeFilters[filterModal] === (opt === 'All' ? '' : opt);
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.modalOption, isSelected && styles.modalOptionSelected]}
                    onPress={() => applyFilter(filterModal, opt === 'All' ? '' : opt)}
                  >
                    <Text style={[styles.modalOptionText, isSelected && styles.modalOptionTextSelected]}>{opt}</Text>
                    {isSelected && <Ionicons name="checkmark" size={18} color={COLORS.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

  const renderPartCard = ({ item, index }) => (
    <PartCard
      item={item}
      index={index}
      onPress={() => navigation.navigate('PartDetail', { listingId: item.id, listing: item })}
    />
  );

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    prefetchListingWindow('parts', viewableItems.map((v) => v.item).filter(Boolean));
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Browse Parts</Text>
        </View>
        <View style={styles.searchContainer}>
          <SearchBar value={search} onChangeText={handleSearch} placeholder="Search parts..." />
        </View>
        <View style={styles.filtersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent}>
            {renderFilterChip(activeFilters.sort !== 'Newest' ? activeFilters.sort : 'Sort', 'sort', activeFilters.sort !== 'Newest')}
            {renderFilterChip('Condition', 'condition', !!activeFilters.condition)}
            {renderFilterChip('Part Type', 'partType', !!activeFilters.partType)}
            {hasActiveFilters && (
              <TouchableOpacity style={styles.clearFiltersChip} onPress={clearFilters}>
                <Ionicons name="close-circle" size={14} color={COLORS.accent} />
                <Text style={styles.clearFiltersText}>Clear</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
        {loading ? (
          <View style={styles.loadingContainer}><ActivityIndicator size="large" color={COLORS.accent} /></View>
        ) : (
          <FlashList
            estimatedItemSize={260}
            data={parts}
            renderItem={renderPartCard}
            keyExtractor={(item, idx) => String(item.id || idx)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.accent} />}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            ListFooterComponent={loadingMore ? <View style={styles.footerLoader}><ActivityIndicator size="small" color={COLORS.accent} /></View> : null}
            ListEmptyComponent={
              <EmptyState icon="construct-outline" title="No parts found" message="Try adjusting your filters" actionLabel="Clear Filters" onAction={clearFilters} />
            }
          />
        )}
        {renderFilterModal()}
      </ScreenEntrance>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.sm },
  headerTitle: { color: COLORS.white, fontSize: FONT_SIZES.xxl, fontWeight: '700' },
  searchContainer: { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  filtersRow: { marginBottom: SPACING.sm },
  filtersContent: { paddingHorizontal: SPACING.md, gap: SPACING.sm },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, marginRight: SPACING.sm, gap: 4,
  },
  filterChipActive: { backgroundColor: COLORS.primary },
  filterChipText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '500' },
  filterChipTextActive: { color: COLORS.accent },
  clearFiltersChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(76,175,80,0.1)',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, gap: 4,
  },
  clearFiltersText: { color: COLORS.accent, fontSize: FONT_SIZES.sm, fontWeight: '500' },
  listContent: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.xxl },
  card: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, marginBottom: SPACING.md, overflow: 'hidden' },
  cardImageContainer: { height: 120 },
  cardImage: { width: '100%', height: '100%' },
  cardImagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceDark },
  cardBody: { padding: SPACING.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600', flex: 1, marginRight: 8 },
  cardSubtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 8 },
  cardPrice: { color: COLORS.accent, fontSize: FONT_SIZES.lg, fontWeight: '700' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footerLoader: { paddingVertical: SPACING.lg, alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: COLORS.surface, borderTopLeftRadius: BORDER_RADIUS.xl, borderTopRightRadius: BORDER_RADIUS.xl, maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600' },
  modalOptions: { padding: SPACING.sm },
  modalOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: SPACING.md, borderRadius: BORDER_RADIUS.md,
  },
  modalOptionSelected: { backgroundColor: COLORS.primary },
  modalOptionText: { color: COLORS.white, fontSize: FONT_SIZES.md },
  modalOptionTextSelected: { color: COLORS.accent, fontWeight: '600' },
});
