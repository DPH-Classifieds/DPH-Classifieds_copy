import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { Image } from 'expo-image';
import { FlashList } from '@shopify/flash-list';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatNumber } from '../../utils/formatters';
import { CAR_MAKES, CAR_MODELS, BODY_TYPES, FUEL_TYPES, TRANSMISSION_TYPES, UAE_EMIRATES, getYearOptions } from '../../utils/listingConstants';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import SearchBar from '../../components/ui/SearchBar';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { resolveMediaUrl } from '../../utils/media';
import { prefetchListing, prefetchListingWindow } from '../../utils/listingCache';
import { swrGet, swrSet } from '../../utils/swrCache';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import ListHeader from '../../components/ui/ListHeader';
import { useGridColumns } from '../../hooks/useGridColumns';
import { toastApiError } from '../../utils/toast';
import {
  CARS_SORT_OPTIONS as SORT_OPTIONS,
  CARS_PRICE_RANGES as PRICE_RANGES,
  CARS_KM_RANGES as KM_RANGES,
  buildCarsQuery,
} from '../../utils/carsQuery';

const CAR_CITIES = [...UAE_EMIRATES, 'Al Ain'];

const PAGE_SIZE = 15;
const years = getYearOptions();

// SWR: cache only the default (unfiltered, unsearched) first page so returning
// to the list shows results instantly, then revalidates in the background.
const LIST_CACHE_KEY = 'cars:list:default';
const LIST_CACHE_TTL = 120;
const isDefaultView = (filters, searchVal) =>
  !searchVal &&
  !Object.entries(filters).some(([k, v]) => {
    if (k === 'sort') return v && v !== 'Newest';
    if (k === 'hideReddit') return v === true;
    return v !== '' && v !== null;
  });

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

function CarCard({ item, index, onPress, columns }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const uri = getImageUri(item);
  const title = item.listing_title || `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim() || 'Untitled Car';
  const grid = columns === 2;
  return (
    <Animated.View style={[animatedStyle, grid && styles.cardGrid]}>
      <PressableScale onPress={onPress} haptic="light">
        <View style={styles.card}>
          <View style={[styles.imageContainer, grid && styles.imageContainerGrid]}>
            {uri ? (
              <Image source={{ uri }} style={styles.cardImage} contentFit="cover" />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="car" size={40} color="rgba(255,255,255,0.2)" />
              </View>
            )}
            {item.is_featured && (
              <View style={styles.featuredBadge}>
                <Badge label="Featured" variant="success" size="sm" />
              </View>
            )}
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {item.make_year || ''} | {formatNumber(item.kilometer_driven)} km | {item.fuel_type || 'Petrol'}
            </Text>
            <Text style={styles.cardPrice}>{formatPrice(item.expected_selling_price)}</Text>
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

export default function CarListScreen({ navigation }) {
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [filterModal, setFilterModal] = useState(null);
  // Search box inside long option modals (make/model/city). Cleared each time a
  // different modal opens.
  const [optionSearch, setOptionSearch] = useState('');
  useEffect(() => { setOptionSearch(''); }, [filterModal]);
  const [activeFilters, setActiveFilters] = useState({
    make: '',
    model: '',
    yearFrom: '',
    yearTo: '',
    priceRange: null,
    mileageRange: null,
    fuel: '',
    transmission: '',
    bodyType: '',
    city: '',
    hideReddit: false,
    sort: 'Newest',
  });
  const { columns, toggleColumns } = useGridColumns();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const buildQuery = useCallback((pageNum, _searchVal, filters) => (
    buildCarsQuery(pageNum, PAGE_SIZE, filters)
  ), []);

  const fetchCars = useCallback(async (pageNum = 1, searchVal = '', filters = activeFilters, isRefresh = false, silent = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1 && !silent) setLoading(true);
      else if (pageNum !== 1) setLoadingMore(true);

      const data = await apiClient.get(buildQuery(pageNum, searchVal, filters));
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.cars || data?.listings || data?.data || []);
      if (pageNum === 1) {
        setCars(items);
        if (isDefaultView(filters, searchVal)) swrSet(LIST_CACHE_KEY, items, LIST_CACHE_TTL);
      } else {
        setCars(prev => [...prev, ...items]);
      }
      setHasMore(items.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (err) {
      toastApiError(err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [buildQuery, activeFilters]);

  // Hydrate the default view from cache instantly, then revalidate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await swrGet(LIST_CACHE_KEY, LIST_CACHE_TTL);
      const hasCached = !!cached?.value?.length;
      if (!cancelled && hasCached) { setCars(cached.value); setLoading(false); }
      if (!cancelled) fetchCars(1, '', activeFilters, false, hasCached);
    })();
    return () => { cancelled = true; };
  }, []);

  // Refetch on filter change — but not on the initial mount (handled above).
  const didMountFilters = useRef(false);
  useEffect(() => {
    if (!didMountFilters.current) { didMountFilters.current = true; return; }
    setCars([]);
    setPage(1);
    setHasMore(true);
    fetchCars(1, search, activeFilters);
  }, [activeFilters]);

  const handleSearch = useCallback((text) => {
    setSearch(text);
  }, []);

  const handleRefresh = useCallback(() => {
    fetchCars(1, search, activeFilters, true);
  }, [fetchCars, search, activeFilters]);

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      fetchCars(page + 1, search, activeFilters);
    }
  }, [fetchCars, page, search, loadingMore, hasMore, activeFilters]);

  const applyFilter = (key, value) => {
    const newFilters = { ...activeFilters, [key]: value };
    if (key === 'make') newFilters.model = ''; // model list depends on make
    // Keep the year range coherent so from > to can't silently return nothing.
    if (key === 'yearFrom' && value && newFilters.yearTo && Number(value) > Number(newFilters.yearTo)) {
      newFilters.yearTo = value;
    }
    if (key === 'yearTo' && value && newFilters.yearFrom && Number(value) < Number(newFilters.yearFrom)) {
      newFilters.yearFrom = value;
    }
    setActiveFilters(newFilters);
    setFilterModal(null);
    fetchCars(1, search, newFilters);
  };

  const clearFilters = () => {
    const cleared = {
      make: '', model: '', yearFrom: '', yearTo: '', priceRange: null,
      mileageRange: null, fuel: '', transmission: '', bodyType: '', city: '',
      hideReddit: false, sort: 'Newest',
    };
    setActiveFilters(cleared);
    setFilterModal(null);
    fetchCars(1, search, cleared);
  };

  const toggleHideReddit = () => {
    const newFilters = { ...activeFilters, hideReddit: !activeFilters.hideReddit };
    setActiveFilters(newFilters);
    fetchCars(1, search, newFilters);
  };

  const hasActiveFilters = Object.entries(activeFilters).some(([k, v]) => {
    if (k === 'sort') return v && v !== 'Newest';
    if (k === 'hideReddit') return v === true;
    return v !== '' && v !== null;
  });

  const visibleCars = useMemo(() => {
    if (!search.trim()) return cars;
    const q = search.toLowerCase();
    return cars.filter((c) => {
      const haystack = [
        c.listing_title,
        c.car_manufacturer,
        c.car_model,
        c.trim,
        c.make_year != null ? String(c.make_year) : '',
        c.car_city,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [cars, search]);

  const renderFilterChip = (label, key, isActive) => (
    <TouchableOpacity
      key={key}
      style={[styles.filterChip, isActive && styles.filterChipActive]}
      onPress={() => setFilterModal(key)}
    >
      <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
        {label}
      </Text>
      <Ionicons
        name="chevron-down"
        size={14}
        color={isActive ? COLORS.accent : COLORS.textMuted}
      />
    </TouchableOpacity>
  );

  const renderFilterModal = () => {
    if (!filterModal) return null;

    let options = [];
    let title = '';
    let selected = '';

    if (filterModal === 'sort') {
      title = 'Sort By';
      selected = activeFilters.sort;
      options = SORT_OPTIONS.map((s) => s.label);
    } else if (filterModal === 'make') {
      title = 'Make';
      selected = activeFilters.make;
      options = ['All', ...CAR_MAKES];
    } else if (filterModal === 'model') {
      title = 'Model';
      selected = activeFilters.model;
      options = ['All', ...((CAR_MODELS[activeFilters.make]) || [])];
    } else if (filterModal === 'bodyType') {
      title = 'Body Type';
      selected = activeFilters.bodyType;
      options = ['All', ...BODY_TYPES];
    } else if (filterModal === 'city') {
      title = 'City';
      selected = activeFilters.city;
      options = ['All', ...CAR_CITIES];
    } else if (filterModal === 'yearFrom') {
      title = 'Year From';
      selected = activeFilters.yearFrom;
      options = ['All', ...years];
    } else if (filterModal === 'yearTo') {
      title = 'Year To';
      selected = activeFilters.yearTo;
      options = ['All', ...years];
    } else if (filterModal === 'priceRange') {
      title = 'Price Range';
      selected = activeFilters.priceRange?.label || 'Any';
      options = PRICE_RANGES.map(r => r.label);
    } else if (filterModal === 'mileageRange') {
      title = 'Mileage';
      selected = activeFilters.mileageRange?.label || 'Any';
      options = KM_RANGES.map(r => r.label);
    } else if (filterModal === 'fuel') {
      title = 'Fuel Type';
      selected = activeFilters.fuel;
      options = ['All', ...FUEL_TYPES];
    } else if (filterModal === 'transmission') {
      title = 'Transmission';
      selected = activeFilters.transmission;
      options = ['All', ...TRANSMISSION_TYPES];
    }

    // Long lists (make/model/city, or any >12 options) get a type-to-search box.
    const searchable = ['make', 'model', 'city'].includes(filterModal) || options.length > 12;
    const shownOptions = (searchable && optionSearch.trim())
      ? options.filter((o) => o === 'All' || String(o).toLowerCase().includes(optionSearch.trim().toLowerCase()))
      : options;

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
            {searchable && (
              <View style={styles.modalSearchWrap}>
                <Ionicons name="search" size={16} color={COLORS.textMuted} />
                <TextInput
                  style={styles.modalSearchInput}
                  value={optionSearch}
                  onChangeText={setOptionSearch}
                  placeholder={`Search ${title.toLowerCase()}...`}
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  autoCorrect={false}
                />
              </View>
            )}
            <ScrollView style={styles.modalOptions} keyboardShouldPersistTaps="handled">
              {shownOptions.length === 0 && (
                <Text style={styles.modalEmptyText}>No matches</Text>
              )}
              {shownOptions.map((opt) => {
                const isRange = filterModal === 'priceRange' || filterModal === 'mileageRange';
                const isSelected = isRange
                  ? ((activeFilters[filterModal]?.label) || 'Any') === opt
                  : selected === (opt === 'All' ? '' : opt);
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.modalOption, isSelected && styles.modalOptionSelected]}
                    onPress={() => {
                      if (isRange) {
                        const ranges = filterModal === 'priceRange' ? PRICE_RANGES : KM_RANGES;
                        const range = ranges.find(r => r.label === opt);
                        applyFilter(filterModal, range.label === 'Any' ? null : range);
                      } else {
                        applyFilter(filterModal, opt === 'All' ? '' : opt);
                      }
                    }}
                  >
                    <Text style={[styles.modalOptionText, isSelected && styles.modalOptionTextSelected]}>
                      {opt}
                    </Text>
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

  const renderCarItem = useCallback(({ item, index }) => (
    <CarCard
      item={item}
      index={index}
      columns={columns}
      onPress={() => { prefetchListing('cars', item); navigation.navigate('CarDetail', { listingId: item.id }); }}
    />
  ), [navigation, columns]);

  // Sliding window: preload the detail (freshest fields + images) for cards as
  // they scroll into view, so opening any of them feels instant. Fires for the
  // first 5-6 on mount too.
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    prefetchListingWindow('cars', viewableItems.map((v) => v.item).filter(Boolean));
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <ListHeader
          title="Browse Cars"
          onBack={() => navigation.goBack()}
          columns={columns}
          onToggleColumns={toggleColumns}
        />
        <View style={styles.searchContainer}>
          <SearchBar
            value={search}
            onChangeText={handleSearch}
            placeholder="Search cars..."
          />
        </View>
        <View style={styles.filtersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent}>
            {renderFilterChip(activeFilters.sort !== 'Newest' ? activeFilters.sort : 'Sort', 'sort', activeFilters.sort !== 'Newest')}
            {renderFilterChip('Make', 'make', !!activeFilters.make)}
            {activeFilters.make && (CAR_MODELS[activeFilters.make] || []).length > 0
              ? renderFilterChip('Model', 'model', !!activeFilters.model)
              : null}
            {renderFilterChip('Body', 'bodyType', !!activeFilters.bodyType)}
            {renderFilterChip('Year From', 'yearFrom', !!activeFilters.yearFrom)}
            {renderFilterChip('Year To', 'yearTo', !!activeFilters.yearTo)}
            {renderFilterChip('City', 'city', !!activeFilters.city)}
            {renderFilterChip('Price', 'priceRange', !!activeFilters.priceRange)}
            {renderFilterChip('Mileage', 'mileageRange', !!activeFilters.mileageRange)}
            {renderFilterChip('Fuel', 'fuel', !!activeFilters.fuel)}
            {renderFilterChip('Transmission', 'transmission', !!activeFilters.transmission)}
            <TouchableOpacity
              style={[styles.filterChip, activeFilters.hideReddit && styles.filterChipActive]}
              onPress={toggleHideReddit}
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
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.accent} />
          </View>
        ) : (
          <FlashList
            key={`cols-${columns}`}
            numColumns={columns}
            data={visibleCars}
            keyExtractor={(item) => item.id}
            estimatedItemSize={columns === 2 ? 210 : 280}
            renderItem={renderCarItem}
            contentContainerStyle={columns === 2 ? styles.listContentGrid : styles.listContent}
            showsVerticalScrollIndicator={false}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.4}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
            ListFooterComponent={loadingMore ? <ActivityIndicator color="#4CAF50" style={{ padding: 20 }} /> : null}
            ListEmptyComponent={!loading ? <EmptyState icon="car-sport-outline" title="No cars found" message="Try adjusting your filters or search." /> : null}
          />
        )}
        {renderFilterModal()}
      </ScreenEntrance>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  searchContainer: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  filtersRow: {
    marginBottom: SPACING.sm,
  },
  filtersContent: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BORDER_RADIUS.pill,
    marginRight: SPACING.sm,
    gap: 4,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
  },
  filterChipText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: COLORS.accent,
  },
  clearFiltersChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(76,175,80,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BORDER_RADIUS.pill,
    gap: 4,
  },
  clearFiltersText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
  },
  listContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  listContentGrid: {
    paddingHorizontal: SPACING.md - SPACING.xs,
    paddingBottom: SPACING.xxl,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  cardGrid: {
    flex: 1,
    marginHorizontal: SPACING.xs,
  },
  imageContainer: {
    height: 160,
    backgroundColor: COLORS.surfaceHigher,
  },
  imageContainerGrid: {
    height: 120,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceDark,
  },
  featuredBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
  },
  cardBody: {
    padding: SPACING.md,
  },
  cardTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardSubtitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginBottom: 8,
  },
  cardPrice: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerLoader: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    maxHeight: '60%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
  },
  modalSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalSearchInput: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    padding: 0,
  },
  modalEmptyText: {
    color: COLORS.textMuted,
    textAlign: 'center',
    paddingVertical: SPACING.lg,
  },
  modalOptions: {
    padding: SPACING.sm,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  modalOptionSelected: {
    backgroundColor: COLORS.primary,
  },
  modalOptionText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
  },
  modalOptionTextSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
});
