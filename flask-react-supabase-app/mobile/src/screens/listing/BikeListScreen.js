import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import { resolveMediaUrl } from '../../utils/media';

const BIKE_BRANDS = [
  'Honda', 'Yamaha', 'Kawasaki', 'Suzuki', 'BMW', 'Ducati', 'Harley-Davidson',
  'KTM', 'Triumph', 'Aprilia', 'Indian', 'Moto Guzzi', 'Husqvarna',
  'Benelli', 'MV Agusta', 'Royal Enfield', 'CFMoto', 'Other',
];

const BIKE_TYPES = ['Sport', 'Cruiser', 'Adventure', 'Touring', 'Naked', 'Dirt', 'Scooter', 'Other'];

const PRICE_RANGES = [
  { label: 'Any', min: 0, max: 0 },
  { label: 'Under 10k', min: 0, max: 10000 },
  { label: '10k - 25k', min: 10000, max: 25000 },
  { label: '25k - 50k', min: 25000, max: 50000 },
  { label: '50k - 100k', min: 50000, max: 100000 },
  { label: 'Above 100k', min: 100000, max: 0 },
];

const PAGE_SIZE = 15;

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

export default function BikeListScreen({ navigation }) {
  const [bikes, setBikes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [filterModal, setFilterModal] = useState(null);
  const [activeFilters, setActiveFilters] = useState({
    brand: '',
    type: '',
    priceRange: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const buildQuery = useCallback((pageNum, searchVal, filters) => {
    let params = [`page=${pageNum}`, `per_page=${PAGE_SIZE}`];
    if (searchVal) params.push(`search=${encodeURIComponent(searchVal)}`);
    if (filters.brand) params.push(`brand=${encodeURIComponent(filters.brand)}`);
    if (filters.type) params.push(`type=${encodeURIComponent(filters.type)}`);
    if (filters.priceRange) {
      if (filters.priceRange.max > 0) {
        params.push(`min_price=${filters.priceRange.min}`, `max_price=${filters.priceRange.max}`);
      } else if (filters.priceRange.min > 0) {
        params.push(`min_price=${filters.priceRange.min}`);
      }
    }
    return `/api/bikes?${params.join('&')}`;
  }, []);

  const fetchBikes = useCallback(async (pageNum = 1, searchVal = '', filters = activeFilters, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      const data = await apiClient.get(buildQuery(pageNum, searchVal, filters));
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.bikes || data?.listings || data?.data || []);
      if (pageNum === 1) setBikes(items);
      else setBikes(prev => [...prev, ...items]);
      setHasMore(items.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (err) {
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [buildQuery, activeFilters]);

  useEffect(() => { fetchBikes(1); }, []);

  const handleSearch = useCallback((text) => {
    setSearch(text);
    fetchBikes(1, text, activeFilters);
  }, [fetchBikes, activeFilters]);

  const handleRefresh = useCallback(() => {
    fetchBikes(1, search, activeFilters, true);
  }, [fetchBikes, search, activeFilters]);

  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) fetchBikes(page + 1, search, activeFilters);
  }, [fetchBikes, page, search, loadingMore, hasMore, activeFilters]);

  const applyFilter = (key, value) => {
    const newFilters = { ...activeFilters, [key]: value };
    setActiveFilters(newFilters);
    setFilterModal(null);
    fetchBikes(1, search, newFilters);
  };

  const clearFilters = () => {
    const cleared = { brand: '', type: '', priceRange: null };
    setActiveFilters(cleared);
    setFilterModal(null);
    fetchBikes(1, search, cleared);
  };

  const hasActiveFilters = Object.values(activeFilters).some(v => v !== '' && v !== null);

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
    let selected = '';

    if (filterModal === 'brand') {
      title = 'Brand';
      selected = activeFilters.brand;
      options = ['All', ...BIKE_BRANDS];
    } else if (filterModal === 'type') {
      title = 'Type';
      selected = activeFilters.type;
      options = ['All', ...BIKE_TYPES];
    } else if (filterModal === 'priceRange') {
      title = 'Price Range';
      selected = activeFilters.priceRange?.label || 'Any';
      options = PRICE_RANGES.map(r => r.label);
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

  const renderBikeCard = ({ item }) => {
    const imageUri = getImageUri(item);
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('BikeDetail', { listingId: item.id })}
      >
        <View style={styles.imageContainer}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="bicycle" size={40} color="rgba(255,255,255,0.2)" />
            </View>
          )}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.bike_brand} {item.bike_model}
          </Text>
          <Text style={styles.cardSubtitle}>
            {item.make_year}{item.engine_capacity ? ` | ${item.engine_capacity}` : ''}{item.fuel_type ? ` | ${item.fuel_type}` : ' | Petrol'}
          </Text>
          <Text style={styles.cardPrice}>{formatPrice(item.expected_selling_price)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Browse Bikes</Text>
      </View>
      <View style={styles.searchContainer}>
        <SearchBar value={search} onChangeText={handleSearch} placeholder="Search bikes..." />
      </View>
      <View style={styles.filtersRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent}>
          {renderFilterChip('Brand', 'brand', !!activeFilters.brand)}
          {renderFilterChip('Type', 'type', !!activeFilters.type)}
          {renderFilterChip('Price Range', 'priceRange', !!activeFilters.priceRange)}
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
        <FlatList
          data={bikes}
          renderItem={renderBikeCard}
          keyExtractor={(item, idx) => String(item.id || idx)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.accent} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <View style={styles.footerLoader}><ActivityIndicator size="small" color={COLORS.accent} /></View> : null}
          ListEmptyComponent={
            <EmptyState icon="bicycle-outline" title="No bikes found" message="Try adjusting your filters" actionLabel="Clear Filters" onAction={clearFilters} />
          }
        />
      )}
      {renderFilterModal()}
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
  imageContainer: { height: 160 },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceDark },
  cardBody: { padding: SPACING.md },
  cardTitle: { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600', marginBottom: 4 },
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
