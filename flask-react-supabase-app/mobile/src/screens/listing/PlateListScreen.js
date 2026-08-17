import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice } from '../../utils/formatters';
import { PLATE_CITIES } from '../../utils/listingConstants';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import { resolveMediaUrl } from '../../utils/media';
import { prefetchListing, prefetchListingWindow } from '../../utils/listingCache';
import { swrGet, swrSet } from '../../utils/swrCache';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import UAEPlate from '../../components/ui/UAEPlate';
import ListHeader from '../../components/ui/ListHeader';
import { useGridColumns } from '../../hooks/useGridColumns';
import { toastApiError } from '../../utils/toast';

const DIGIT_OPTIONS = ['Any', '1', '2', '3', '4', '5'];

const SORT_OPTIONS = [
  { label: 'Newest', order: 'created_at.desc' },
  { label: 'Oldest', order: 'created_at.asc' },
  { label: 'Price: Low to High', order: 'price.asc' },
  { label: 'Price: High to Low', order: 'price.desc' },
];

const PAGE_SIZE = 15;

// SWR: cache only the default (unfiltered, unsearched) first page for instant return.
const LIST_CACHE_KEY = 'plates:list:default';
const LIST_CACHE_TTL = 120;
const isDefaultView = (filters, searchVal) =>
  !searchVal &&
  !Object.entries(filters).some(([k, v]) => (k === 'sort' ? v && v !== 'Newest' : v !== '' && v !== null));

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

function PlateCard({ item, index, onPress, columns }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const grid = columns === 2;
  return (
    <Animated.View style={[animatedStyle, grid && styles.cardGrid]}>
      <PressableScale onPress={onPress}>
        <View style={styles.card}>
          <View style={styles.plateVisual}>
            <UAEPlate
              city={item.city}
              code={item.code}
              number={item.number || item.digits}
              sold={item.status === 'sold'}
              height={84}
              style={styles.plateFill}
            />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardCity}>{item.city || 'Unknown'}</Text>
            <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function PlateListScreen({ navigation }) {
  const [plates, setPlates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [filterModal, setFilterModal] = useState(null);
  const [activeFilters, setActiveFilters] = useState({ city: '', digits: '', sort: 'Newest', hideReddit: false });
  const { columns, toggleColumns } = useGridColumns();
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
    if (filters.city) params.push(`city=${encodeURIComponent(filters.city)}`);
    if (filters.digits && filters.digits !== 'Any') params.push(`digits=${filters.digits}`);
    if (filters.hideReddit) params.push('exclude_reddit=true');
    return `/api/plates?${params.join('&')}`;
  }, []);

  const fetchPlates = useCallback(async (pageNum = 1, searchVal = '', filters = activeFilters, isRefresh = false, silent = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1 && !silent) setLoading(true);
      else if (pageNum !== 1) setLoadingMore(true);

      const data = await apiClient.get(buildQuery(pageNum, searchVal, filters));
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.plates || data?.listings || data?.data || []);
      if (pageNum === 1) {
        setPlates(items);
        if (isDefaultView(filters, searchVal)) swrSet(LIST_CACHE_KEY, items, LIST_CACHE_TTL);
      } else setPlates(prev => [...prev, ...items]);
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
      if (!cancelled && hasCached) { setPlates(cached.value); setLoading(false); }
      if (!cancelled) fetchPlates(1, '', activeFilters, false, hasCached);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSearch = useCallback((text) => {
    setSearch(text);
    setPlates([]);
    setPage(1);
    setHasMore(true);
    fetchPlates(1, text, activeFilters);
  }, [fetchPlates, activeFilters]);

  const handleRefresh = useCallback(() => fetchPlates(1, search, activeFilters, true), [fetchPlates, search, activeFilters]);
  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) fetchPlates(page + 1, search, activeFilters);
  }, [fetchPlates, page, search, loadingMore, hasMore, activeFilters]);

  const applyFilter = (key, value) => {
    const newFilters = { ...activeFilters, [key]: value };
    setActiveFilters(newFilters);
    setFilterModal(null);
    setPlates([]);
    setPage(1);
    setHasMore(true);
    fetchPlates(1, search, newFilters);
  };

  const clearFilters = () => {
    const cleared = { city: '', digits: '', sort: 'Newest', hideReddit: false };
    setActiveFilters(cleared);
    setFilterModal(null);
    setPlates([]);
    setPage(1);
    setHasMore(true);
    fetchPlates(1, search, cleared);
  };

  const hasActiveFilters = Object.entries(activeFilters).some(([k, v]) => {
    if (k === 'sort') return v && v !== 'Newest';
    if (k === 'hideReddit') return v === true;
    return v !== '' && v !== null && v !== 'Any';
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
    } else if (filterModal === 'city') {
      title = 'City';
      options = ['All', ...PLATE_CITIES.map((c) => c.name)];
    } else if (filterModal === 'digits') {
      title = 'Digits Count';
      options = DIGIT_OPTIONS;
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
                let isSelected;
                if (filterModal === 'city') isSelected = activeFilters.city === (opt === 'All' ? '' : opt);
                else if (filterModal === 'digits') isSelected = activeFilters.digits === (opt === 'Any' ? '' : opt);
                else isSelected = activeFilters.sort === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.modalOption, isSelected && styles.modalOptionSelected]}
                    onPress={() => {
                      if (filterModal === 'city') applyFilter('city', opt === 'All' ? '' : opt);
                      else if (filterModal === 'digits') applyFilter('digits', opt === 'Any' ? '' : opt);
                      else applyFilter('sort', opt);
                    }}
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

  const renderPlateCard = ({ item, index }) => (
    <PlateCard
      item={item}
      index={index}
      columns={columns}
      onPress={() => { prefetchListing('plates', item); navigation.navigate('PlateDetail', { listingId: item.id }); }}
    />
  );

  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    prefetchListingWindow('plates', viewableItems.map((v) => v.item).filter(Boolean));
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <ListHeader
          title="Browse Plates"
          onBack={() => navigation.goBack()}
          columns={columns}
          onToggleColumns={toggleColumns}
        />
        <View style={styles.searchContainer}>
          <SearchBar value={search} onChangeText={handleSearch} placeholder="Search plates..." />
        </View>
        <View style={styles.filtersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent}>
            {renderFilterChip(activeFilters.sort !== 'Newest' ? activeFilters.sort : 'Sort', 'sort', activeFilters.sort !== 'Newest')}
            {renderFilterChip('City', 'city', !!activeFilters.city)}
            {renderFilterChip('Digits', 'digits', !!activeFilters.digits)}
            <TouchableOpacity
              style={[styles.filterChip, activeFilters.hideReddit && styles.filterChipActive]}
              onPress={() => applyFilter('hideReddit', !activeFilters.hideReddit)}
            >
              <Ionicons
                name={activeFilters.hideReddit ? 'eye-off' : 'logo-reddit'}
                size={14}
                color={activeFilters.hideReddit ? COLORS.accent : COLORS.textMuted}
              />
              <Text style={[styles.filterChipText, activeFilters.hideReddit && styles.filterChipTextActive]}>
                {activeFilters.hideReddit ? 'Reddit hidden' : 'Hide Reddit'}
              </Text>
            </TouchableOpacity>
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
            key={`cols-${columns}`}
            numColumns={columns}
            estimatedItemSize={columns === 2 ? 210 : 260}
            data={plates}
            renderItem={renderPlateCard}
            keyExtractor={(item, idx) => String(item.id || idx)}
            contentContainerStyle={columns === 2 ? styles.listContentGrid : styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.accent} />}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            ListFooterComponent={loadingMore ? <View style={styles.footerLoader}><ActivityIndicator size="small" color={COLORS.accent} /></View> : null}
            ListEmptyComponent={
              <EmptyState icon="key-outline" title="No plates found" message="Try adjusting your filters" actionLabel="Clear Filters" onAction={clearFilters} />
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
  listContentGrid: { paddingHorizontal: SPACING.md - SPACING.xs, paddingBottom: SPACING.xxl },
  card: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, marginBottom: SPACING.md, padding: SPACING.md, overflow: 'hidden',
  },
  cardGrid: { flex: 1, marginHorizontal: SPACING.xs },
  plateVisual: { alignItems: 'center', marginBottom: SPACING.md },
  plateFill: { width: '100%' },
  cardInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardCity: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
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
