import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatNumber } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const CATEGORIES = [
  { key: 'all', label: 'All', icon: 'grid-outline' },
  { key: 'cars', label: 'Cars', icon: 'car-outline' },
  { key: 'bikes', label: 'Bikes', icon: 'bicycle-outline' },
  { key: 'plates', label: 'Plates', icon: 'key-outline' },
  { key: 'parts', label: 'Parts', icon: 'construct-outline' },
];

const SORT_OPTIONS = [
  { key: 'newest', label: 'Newest' },
  { key: 'price_low', label: 'Price: Low' },
  { key: 'price_high', label: 'Price: High' },
];

const getImageUri = (item) => {
  if (item.images && item.images.length > 0) {
    return item.images[0].url || item.images[0].image_url || item.images[0].display_url;
  }
  return item.image_url || item.display_url || null;
};

const normalizeItem = (category, item) => {
  if (category === 'cars') {
    return {
      id: item.id,
      category: 'cars',
      title: `${item.car_manufacturer || ''} ${item.car_model || ''}`.trim() || item.listing_title || 'Untitled Car',
      subtitle: `${item.make_year || ''} ${item.kilometer_driven ? formatNumber(item.kilometer_driven) + ' km' : ''} ${item.fuel_type || ''}`.trim(),
      price: item.expected_selling_price,
      location: item.car_city || item.area || '',
      image: getImageUri(item),
      is_featured: item.is_featured,
      raw: item,
    };
  }
  if (category === 'bikes') {
    return {
      id: item.id,
      category: 'bikes',
      title: `${item.bike_brand || ''} ${item.bike_model || ''}`.trim() || 'Untitled Bike',
      subtitle: `${item.make_year || ''} ${item.engine_capacity || ''} ${item.bike_category || ''}`.trim(),
      price: item.expected_selling_price,
      location: item.car_city || item.area || '',
      image: getImageUri(item),
      is_featured: item.featured,
      raw: item,
    };
  }
  if (category === 'plates') {
    const plateNum = [item.city, item.code, item.digits || item.number].filter(Boolean).join(' ');
    return {
      id: item.id,
      category: 'plates',
      title: plateNum || 'Untitled Plate',
      subtitle: item.plate_format || '',
      price: item.price,
      location: item.city || '',
      image: getImageUri(item),
      is_featured: item.featured,
      raw: item,
    };
  }
  if (category === 'parts') {
    return {
      id: item.id,
      category: 'parts',
      title: item.part_type || item.brand || 'Untitled Part',
      subtitle: [item.condition, item.brand].filter(Boolean).join(' • '),
      price: item.price,
      location: item.city || '',
      image: getImageUri(item),
      is_featured: item.featured,
      raw: item,
    };
  }
  return { id: item.id, category, title: 'Unknown', subtitle: '', price: 0, location: '', image: null, raw: item };
};

const DETAIL_SCREENS = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };
const CATEGORY_ICONS = { cars: 'car', bikes: 'bicycle', plates: 'key', parts: 'construct' };

export default function ExploreScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [allItems, setAllItems] = useState({ cars: [], bikes: [], plates: [], parts: [] });
  const [counts, setCounts] = useState({ cars: 0, bikes: 0, plates: 0, parts: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchAllListings = useCallback(async () => {
    try {
      const [carsRes, bikesRes, platesRes, partsRes] = await Promise.all([
        apiClient.get('/api/cars?per_page=60').catch(() => []),
        apiClient.get('/api/bikes?per_page=60').catch(() => []),
        apiClient.get('/api/plates?per_page=60').catch(() => []),
        apiClient.get('/api/parts?per_page=60').catch(() => []),
      ]);

      if (!mountedRef.current) return;

      const cars = Array.isArray(carsRes) ? carsRes : carsRes?.cars || [];
      const bikes = Array.isArray(bikesRes) ? bikesRes : bikesRes?.bikes || [];
      const plates = Array.isArray(platesRes) ? platesRes : platesRes?.plates || [];
      const parts = Array.isArray(partsRes) ? partsRes : partsRes?.parts || [];

      setAllItems({ cars, bikes, plates, parts });
      setCounts({ cars: cars.length, bikes: bikes.length, plates: plates.length, parts: parts.length });
    } catch (err) {
      // Failed to fetch
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAllListings(); }, [fetchAllListings]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAllListings();
  }, [fetchAllListings]);

  const normalizedItems = useMemo(() => {
    let items = [];
    if (activeTab === 'all') {
      items = [
        ...allItems.cars.map((i) => normalizeItem('cars', i)),
        ...allItems.bikes.map((i) => normalizeItem('bikes', i)),
        ...allItems.plates.map((i) => normalizeItem('plates', i)),
        ...allItems.parts.map((i) => normalizeItem('parts', i)),
      ];
    } else {
      items = allItems[activeTab]?.map((i) => normalizeItem(activeTab, i)) || [];
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.location.toLowerCase().includes(q)
      );
    }

    if (sortBy === 'price_low') {
      items.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sortBy === 'price_high') {
      items.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else {
      items.sort((a, b) => {
        if (a.is_featured && !b.is_featured) return -1;
        if (!a.is_featured && b.is_featured) return 1;
        return 0;
      });
    }

    return items;
  }, [allItems, activeTab, search, sortBy]);

  const totalCount = counts.cars + counts.bikes + counts.plates + counts.parts;

  const CATEGORY_COLORS = { cars: COLORS.accent, bikes: '#2196f3', plates: '#ff9800', parts: '#9c27b0' };

  const renderItem = useCallback(({ item }) => {
    const detailScreen = DETAIL_SCREENS[item.category];

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => navigation.navigate(detailScreen, { listingId: item.id })}
      >
        <View style={styles.cardImageContainer}>
          {item.image ? (
            <Image source={{ uri: item.image }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={styles.cardImagePlaceholder}>
              <Ionicons name={CATEGORY_ICONS[item.category] || 'cube'} size={32} color={COLORS.textMuted} />
            </View>
          )}
          {item.is_featured && (
            <View style={styles.featuredBadge}>
              <Text style={styles.badgeText}>Featured</Text>
            </View>
          )}
          <View style={[styles.categoryBadge, { backgroundColor: CATEGORY_COLORS[item.category] || COLORS.accent }]}>
            <Text style={styles.badgeText}>{item.category.charAt(0).toUpperCase() + item.category.slice(1)}</Text>
          </View>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          {item.subtitle ? <Text style={styles.cardSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
          <View style={styles.cardBottom}>
            <Text style={styles.cardPrice}>{item.price ? formatPrice(item.price) : 'Price on request'}</Text>
            {item.location ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={11} color={COLORS.textMuted} />
                <Text style={styles.cardLocation} numberOfLines={1}>{item.location}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [navigation]);

  const renderHeader = useCallback(() => (
    <View>
      <View style={styles.heroSection}>
        <Text style={styles.heroKicker}>Marketplace</Text>
        <Text style={styles.heroTitle}>
          {activeTab === 'all' && 'Explore Everything'}
          {activeTab === 'cars' && 'Browse Cars'}
          {activeTab === 'bikes' && 'Browse Bikes'}
          {activeTab === 'plates' && 'Browse Plates'}
          {activeTab === 'parts' && 'Browse Parts'}
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={COLORS.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search cars, bikes, plates, parts..."
            placeholderTextColor={COLORS.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close-circle" size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.tabsContainer}>
        <FlatList
          horizontal
          data={CATEGORIES}
          keyExtractor={(item) => item.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsList}
          renderItem={({ item }) => {
            const isActive = activeTab === item.key;
            const count = item.key === 'all' ? totalCount : counts[item.key] || 0;
            return (
              <TouchableOpacity
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveTab(item.key)}
                activeOpacity={0.7}
              >
                <Ionicons name={item.icon} size={15} color={isActive ? COLORS.accent : COLORS.textSecondary} />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{item.label}</Text>
                <Text style={[styles.tabCount, isActive && styles.tabCountActive]}>{count}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <View style={styles.sortRow}>
        <Text style={styles.resultsText}>
          {normalizedItems.length} {normalizedItems.length === 1 ? 'result' : 'results'}
        </Text>
        <View style={styles.sortOptions}>
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.sortChip, sortBy === opt.key && styles.sortChipActive]}
              onPress={() => setSortBy(opt.key)}
            >
              <Text style={[styles.sortChipText, sortBy === opt.key && styles.sortChipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  ), [activeTab, search, sortBy, normalizedItems.length, counts, totalCount]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading marketplace...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={normalizedItems}
        renderItem={renderItem}
        keyExtractor={(item, idx) => String(item.id || idx)}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderHeader}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} colors={[COLORS.accent]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={48} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No listings found</Text>
            <Text style={styles.emptySubtitle}>{search ? 'Try a different search term' : 'Check back later for new listings'}</Text>
            {search ? (
              <TouchableOpacity style={styles.clearButton} onPress={() => setSearch('')}>
                <Text style={styles.clearButtonText}>Clear Search</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.textSecondary, marginTop: SPACING.sm, fontSize: FONT_SIZES.md },

  heroSection: { paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.md },
  heroKicker: { color: COLORS.accent, fontSize: FONT_SIZES.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  heroTitle: { color: COLORS.white, fontSize: 28, fontWeight: '800', marginBottom: 4 },
  heroSubtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },

  searchContainer: { paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.pill, paddingHorizontal: 16, paddingVertical: 10, gap: 8,
  },
  searchInput: { flex: 1, color: COLORS.white, fontSize: FONT_SIZES.md },

  tabsContainer: { marginBottom: SPACING.sm },
  tabsList: { paddingHorizontal: SPACING.md, gap: 8 },
  tab: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: BORDER_RADIUS.pill, gap: 6,
  },
  tabActive: { backgroundColor: COLORS.primary },
  tabLabel: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  tabLabelActive: { color: COLORS.accent },
  tabCount: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  tabCountActive: { color: COLORS.accent },

  sortRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: SPACING.md, marginBottom: SPACING.sm,
  },
  resultsText: { color: COLORS.textSecondary, fontSize: FONT_SIZES.sm },
  sortOptions: { flexDirection: 'row', gap: 6 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.pill, backgroundColor: COLORS.surface },
  sortChipActive: { backgroundColor: COLORS.primary },
  sortChipText: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },
  sortChipTextActive: { color: COLORS.accent },

  listContent: { paddingBottom: SPACING.xxl * 2 },
  row: { paddingHorizontal: SPACING.md, gap: SPACING.sm },

  card: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden', marginBottom: SPACING.sm,
  },
  cardImageContainer: { height: 130, position: 'relative' },
  cardImage: { width: '100%', height: '100%' },
  cardImagePlaceholder: { width: '100%', height: '100%', backgroundColor: COLORS.surfaceDark, justifyContent: 'center', alignItems: 'center' },
  featuredBadge: {
    position: 'absolute', top: 8, left: 8, backgroundColor: COLORS.accent,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: BORDER_RADIUS.sm,
  },
  categoryBadge: {
    position: 'absolute', top: 8, right: 8,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: BORDER_RADIUS.sm,
  },
  badgeText: { color: COLORS.white, fontSize: 10, fontWeight: '700' },

  cardBody: { padding: 10 },
  cardTitle: { color: COLORS.white, fontSize: FONT_SIZES.sm, fontWeight: '600', marginBottom: 2 },
  cardSubtitle: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginBottom: 6 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  cardPrice: { color: COLORS.accent, fontSize: FONT_SIZES.md, fontWeight: '700' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  cardLocation: { color: COLORS.textMuted, fontSize: FONT_SIZES.xs },

  emptyContainer: { alignItems: 'center', paddingTop: SPACING.xxl * 2, paddingHorizontal: SPACING.lg },
  emptyTitle: { color: COLORS.white, fontSize: FONT_SIZES.lg, fontWeight: '600', marginTop: SPACING.md, marginBottom: SPACING.xs },
  emptySubtitle: { color: COLORS.textSecondary, fontSize: FONT_SIZES.md, textAlign: 'center' },
  clearButton: { marginTop: SPACING.md, backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: BORDER_RADIUS.pill },
  clearButtonText: { color: COLORS.accent, fontWeight: '600' },
});
