import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
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
import { formatPrice } from '../../utils/formatters';
import { PLATE_CITIES } from '../../utils/listingConstants';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import { resolveMediaUrl } from '../../utils/media';
import { useStaggeredEntrance } from '../../hooks/useStaggeredEntrance';
import ScreenEntrance from '../../components/ui/ScreenEntrance';
import PressableScale from '../../components/ui/PressableScale';
import { toastApiError } from '../../utils/toast';

const DIGIT_OPTIONS = ['Any', '1', '2', '3', '4', '5'];

const CITY_CODES = {
  'Abu Dhabi': 'أ',
  'Dubai': 'د',
  'Sharjah': 'ش',
  'Ajman': 'ع',
  'Umm Al Quwain': 'و',
  'Ras Al Khaimah': 'ر',
  'Fujairah': 'ف',
  'Al Ain': 'ك',
  'Other': 'م',
};

const SORT_OPTIONS = [
  { label: 'Newest', order: 'created_at.desc' },
  { label: 'Oldest', order: 'created_at.asc' },
  { label: 'Price: Low to High', order: 'price.asc' },
  { label: 'Price: High to Low', order: 'price.desc' },
];

const PAGE_SIZE = 15;

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

function PlateCard({ item, index, onPress }) {
  const { animatedStyle } = useStaggeredEntrance(index);
  const cityCode = CITY_CODES[item.city] || 'م';
  return (
    <Animated.View style={animatedStyle}>
      <PressableScale onPress={onPress}>
        <View style={styles.card}>
          <View style={styles.plateVisual}>
            <View style={styles.plateBox}>
              <Text style={styles.plateCityCode}>{cityCode}</Text>
              <View style={styles.plateDivider} />
              <Text style={styles.plateNumber}>{item.code || ''}{item.digits || item.number || ''}</Text>
            </View>
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
  const [activeFilters, setActiveFilters] = useState({ city: '', digits: '', sort: 'Newest' });
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
    return `/api/plates?${params.join('&')}`;
  }, []);

  const fetchPlates = useCallback(async (pageNum = 1, searchVal = '', filters = activeFilters, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      const data = await apiClient.get(buildQuery(pageNum, searchVal, filters));
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.plates || data?.listings || data?.data || []);
      if (pageNum === 1) setPlates(items);
      else setPlates(prev => [...prev, ...items]);
      setHasMore(items.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (err) {
      toastApiError(err);
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
    }
  }, [buildQuery, activeFilters]);

  useEffect(() => { fetchPlates(1); }, []);

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
    const cleared = { city: '', digits: '', sort: 'Newest' };
    setActiveFilters(cleared);
    setFilterModal(null);
    setPlates([]);
    setPage(1);
    setHasMore(true);
    fetchPlates(1, search, cleared);
  };

  const hasActiveFilters = Object.entries(activeFilters).some(([k, v]) => {
    if (k === 'sort') return v && v !== 'Newest';
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
      options = ['All', ...PLATE_CITIES];
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
      onPress={() => navigation.navigate('PlateDetail', { listingId: item.id })}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenEntrance>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Browse Plates</Text>
        </View>
        <View style={styles.searchContainer}>
          <SearchBar value={search} onChangeText={handleSearch} placeholder="Search plates..." />
        </View>
        <View style={styles.filtersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent}>
            {renderFilterChip(activeFilters.sort !== 'Newest' ? activeFilters.sort : 'Sort', 'sort', activeFilters.sort !== 'Newest')}
            {renderFilterChip('City', 'city', !!activeFilters.city)}
            {renderFilterChip('Digits', 'digits', !!activeFilters.digits)}
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
            data={plates}
            renderItem={renderPlateCard}
            keyExtractor={(item, idx) => String(item.id || idx)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.accent} />}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.3}
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
  card: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, marginBottom: SPACING.md, padding: SPACING.md, overflow: 'hidden',
  },
  plateVisual: { alignItems: 'center', marginBottom: SPACING.md },
  plateBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff',
    borderRadius: 8, borderWidth: 2, borderColor: '#333333',
    paddingHorizontal: 20, paddingVertical: 14, minWidth: 180,
  },
  plateCityCode: { color: '#1a1a1a', fontSize: 24, fontWeight: '900', marginHorizontal: 8 },
  plateDivider: { width: 2, height: 30, backgroundColor: '#333333', marginHorizontal: 8 },
  plateNumber: { color: '#1a1a1a', fontSize: 22, fontWeight: '700', letterSpacing: 2 },
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
