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
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import { resolveMediaUrl } from '../../utils/media';

const CONDITION_OPTIONS = ['New', 'Used', 'Refurbished'];
const PART_TYPES = [
  'Engine', 'Transmission', 'Brakes', 'Suspension', 'Exhaust', 'Electrical',
  'Body Parts', 'Interior', 'Wheels & Tires', 'Lighting', 'Performance',
  'Accessories', 'Tools', 'Other',
];

const PAGE_SIZE = 15;

const CONDITION_VARIANT = { New: 'success', Used: 'warning', Refurbished: 'info' };

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return resolveMediaUrl(item.images[0].url || item.images[0].image_url || item.images[0].display_url);
  }
  return resolveMediaUrl(item.image_url || item.display_url || null);
};

export default function PartListScreen({ navigation }) {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [filterModal, setFilterModal] = useState(null);
  const [activeFilters, setActiveFilters] = useState({ condition: '', partType: '' });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const buildQuery = useCallback((pageNum, searchVal, filters) => {
    let params = [`page=${pageNum}`, `per_page=${PAGE_SIZE}`];
    if (searchVal) params.push(`search=${encodeURIComponent(searchVal)}`);
    if (filters.condition) params.push(`condition=${encodeURIComponent(filters.condition)}`);
    if (filters.partType) params.push(`part_type=${encodeURIComponent(filters.partType)}`);
    return `/api/parts?${params.join('&')}`;
  }, []);

  const fetchParts = useCallback(async (pageNum = 1, searchVal = '', filters = activeFilters, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else if (pageNum === 1) setLoading(true);
      else setLoadingMore(true);

      const data = await apiClient.get(buildQuery(pageNum, searchVal, filters));
      if (!mountedRef.current) return;

      const items = Array.isArray(data) ? data : (data?.parts || data?.listings || data?.data || []);
      if (pageNum === 1) setParts(items);
      else setParts(prev => [...prev, ...items]);
      setHasMore(items.length >= PAGE_SIZE);
      setPage(pageNum);
    } catch (err) {
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); setLoadingMore(false); }
    }
  }, [buildQuery, activeFilters]);

  useEffect(() => { fetchParts(1); }, []);

  const handleSearch = useCallback((text) => {
    setSearch(text);
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
    fetchParts(1, search, newFilters);
  };

  const clearFilters = () => {
    const cleared = { condition: '', partType: '' };
    setActiveFilters(cleared);
    setFilterModal(null);
    fetchParts(1, search, cleared);
  };

  const hasActiveFilters = Object.values(activeFilters).some(v => v !== '');

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

    if (filterModal === 'condition') {
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

  const renderPartCard = ({ item }) => {
    const imageUri = getImageUri(item);
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('PartDetail', { listingId: item.id })}
      >
        <View style={styles.cardImageContainer}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.cardImage} resizeMode="cover" />
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
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Browse Parts</Text>
      </View>
      <View style={styles.searchContainer}>
        <SearchBar value={search} onChangeText={handleSearch} placeholder="Search parts..." />
      </View>
      <View style={styles.filtersRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersContent}>
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
        <FlatList
          data={parts}
          renderItem={renderPartCard}
          keyExtractor={(item, idx) => String(item.id || idx)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.accent} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <View style={styles.footerLoader}><ActivityIndicator size="small" color={COLORS.accent} /></View> : null}
          ListEmptyComponent={
            <EmptyState icon="construct-outline" title="No parts found" message="Try adjusting your filters" actionLabel="Clear Filters" onAction={clearFilters} />
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
