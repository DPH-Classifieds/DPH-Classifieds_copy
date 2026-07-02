import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  RefreshControl,
} from 'react-native';
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
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { toastApiError } from '../../utils/toast';

const PRICE_RANGES = [
  { label: 'Any', min: 0, max: 0 },
  { label: 'Under 20k', min: 0, max: 20000 },
  { label: '20k - 50k', min: 20000, max: 50000 },
  { label: '50k - 100k', min: 50000, max: 100000 },
  { label: '100k - 200k', min: 100000, max: 200000 },
  { label: '200k - 500k', min: 200000, max: 500000 },
  { label: 'Above 500k', min: 500000, max: 0 },
];

const SORT_OPTIONS = [
  { label: 'Newest', order: 'created_at.desc' },
  { label: 'Oldest', order: 'created_at.asc' },
  { label: 'Price: Low to High', order: 'expected_selling_price.asc' },
  { label: 'Price: High to Low', order: 'expected_selling_price.desc' },
  { label: 'Year: Newest', order: 'make_year.desc' },
  { label: 'Mileage: Lowest', order: 'kilometer_driven.asc' },
];

const CAR_CITIES = [...UAE_EMIRATES, 'Al Ain'];

const PAGE_SIZE = 15;
const years = getYearOptions();

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

function CarCard({ item, index, onPress }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const uri = getImageUri(item);
  const title = item.listing_title || `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim() || 'Untitled Car';
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress} haptic="light">
        <View style={styles.card}>
          <View style={styles.imageContainer}>
            {uri ? (
              <Image source={{ uri }} style={styles.cardImage} resizeMode="cover" />
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
            <Text style={styles.cardSubtitle}>
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
  const [activeFilters, setActiveFilters] = useState({
    make: '',
    model: '',
    yearFrom: '',
    yearTo: '',
    priceRange: null,
    fuel: '',
    transmission: '',
    bodyType: '',
    city: '',
    sort: 'Newest',
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const buildQuery = useCallback((pageNum, _searchVal, filters) => {
    const offset = (pageNum - 1) * PAGE_SIZE;
    const params = [`limit=${PAGE_SIZE}`, `offset=${offset}`];
    const sortOpt = SORT_OPTIONS.find((s) => s.label === filters.sort) || SORT_OPTIONS[0];
    params.push(`order=${encodeURIComponent(sortOpt.order)}`);
    if (filters.make) params.push(`car_manufacturer=${encodeURIComponent(filters.make)}`);
    if (filters.model) params.push(`car_model=${encodeURIComponent(filters.model)}`);
    if (filters.bodyType) params.push(`body_type=${encodeURIComponent(filters.bodyType)}`);
    if (filters.city) params.push(`car_city=${encodeURIComponent(filters.city)}`);
    if (filters.yearFrom) params.push(`make_year_from=${filters.yearFrom}`);
    if (filters.yearTo) params.push(`make_year_to=${filters.yearTo}`);
    if (filters.fuel) params.push(`fuel_type=${encodeURIComponent(filters.fuel)}`);
    if (filters.transmission) params.push(`transmission_type=${encodeURIComponent(filters.transmission)}`);
    if (filters.priceRange) {
      if (filters.priceRange.min > 0) params.push(`price_from=${filters.priceRange.min}`);
      if (filters.priceRange.max > 0) params.push(`price_to=${filters.priceRange.max}`);
    }
    return `/api/cars?${params.join('&')}`;
  }, []);

  const fetchCars = useCallback(async (pageNum = 1, searchVal = '', filters = activeFilters, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      const data = await apiClient.get(buildQuery(pageNum, searchVal, filters));
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.cars || data?.listings || data?.data || []);
      if (pageNum === 1) {
        setCars(items);
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

  useEffect(() => {
    fetchCars(1);
  }, []);

  useEffect(() => {
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
      fuel: '', transmission: '', bodyType: '', city: '', sort: 'Newest',
    };
    setActiveFilters(cleared);
    setFilterModal(null);
    fetchCars(1, search, cleared);
  };

  const hasActiveFilters = Object.entries(activeFilters).some(([k, v]) => {
    if (k === 'sort') return v && v !== 'Newest';
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
    } else if (filterModal === 'fuel') {
      title = 'Fuel Type';
      selected = activeFilters.fuel;
      options = ['All', ...FUEL_TYPES];
    } else if (filterModal === 'transmission') {
      title = 'Transmission';
      selected = activeFilters.transmission;
      options = ['All', ...TRANSMISSION_TYPES];
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
                const isSelected = filterModal === 'priceRange'
                  ? (activeFilters.priceRange?.label || 'Any') === opt
                  : selected === (opt === 'All' ? '' : opt);
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.modalOption, isSelected && styles.modalOptionSelected]}
                    onPress={() => {
                      if (filterModal === 'priceRange') {
                        const range = PRICE_RANGES.find(r => r.label === opt);
                        applyFilter('priceRange', range.label === 'Any' ? null : range);
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
      onPress={() => navigation.navigate('CarDetail', { carId: item.id })}
    />
  ), [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Browse Cars</Text>
        </View>
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
            {renderFilterChip('Fuel', 'fuel', !!activeFilters.fuel)}
            {renderFilterChip('Transmission', 'transmission', !!activeFilters.transmission)}
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
            data={visibleCars}
            keyExtractor={(item) => item.id}
            estimatedItemSize={280}
            renderItem={renderCarItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.4}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
            ListFooterComponent={loadingMore ? <ActivityIndicator color="#4CAF50" style={{ padding: 20 }} /> : null}
            ListEmptyComponent={!loading ? <EmptyState title="No cars found" description="Try adjusting your filters" /> : null}
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
  header: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
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
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.md,
    overflow: 'hidden',
  },
  imageContainer: {
    height: 160,
    backgroundColor: COLORS.surfaceHigher,
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
